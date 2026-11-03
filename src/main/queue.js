// The download queue: runs a few yt-dlp processes at a time and reports each
// job's state through the 'update' event.
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const ytdlp = require('./ytdlp');

const DESTINATION = /^\[download\] Destination: (.+)$/;

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

class Queue extends EventEmitter {
  // getEnv() -> { bin, ffmpegDir, cookiesBrowser, extraArgs, extraEnv }
  constructor({ getEnv, concurrency = 2 }) {
    super();
    this.getEnv = getEnv;
    this.concurrency = concurrency;
    this.jobs = [];
    this.running = new Map();
  }

  list() {
    return this.jobs;
  }

  add(specs) {
    for (const spec of specs) {
      this.jobs.push({
        id: crypto.randomUUID(),
        status: 'queued',
        percent: 0,
        speed: null,
        eta: null,
        filePath: null,
        error: null,
        ...spec,
      });
    }
    for (const job of this.jobs.slice(-specs.length)) this.emit('update', job);
    this.pump();
  }

  get(id) {
    return this.jobs.find((j) => j.id === id);
  }

  cancel(id) {
    const job = this.get(id);
    if (!job) return;
    if (job.status === 'queued') {
      this.patch(job, { status: 'canceled' });
    } else if (this.running.has(id)) {
      job.canceling = true;
      killTree(this.running.get(id));
    }
  }

  retry(id) {
    const job = this.get(id);
    if (!job || !['error', 'canceled'].includes(job.status)) return;
    this.patch(job, { status: 'queued', percent: 0, error: null, speed: null, eta: null });
    this.pump();
  }

  remove(id) {
    this.cancel(id);
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.emit('removed', id);
  }

  clearFinished() {
    for (const job of [...this.jobs]) {
      if (['done', 'canceled', 'error'].includes(job.status)) this.remove(job.id);
    }
  }

  patch(job, changes) {
    Object.assign(job, changes);
    this.emit('update', job);
  }

  pump() {
    while (this.running.size < this.concurrency) {
      const next = this.jobs.find((j) => j.status === 'queued');
      if (!next) return;
      this.start(next);
    }
  }

  start(job) {
    const env = this.getEnv();
    const args = [...env.extraArgs, ...ytdlp.downloadArgs(job, env)];
    const partials = new Set();
    let sawVideo = false;
    let lastEmit = 0;
    job.canceling = false;
    this.patch(job, { status: 'downloading', percent: 0, stage: null });

    const onLine = (line) => {
      const progress = ytdlp.parseProgressLine(line);
      if (progress) {
        // A video download is two files (picture then sound); weight them 90/10.
        if (!progress.audioOnly) sawVideo = true;
        let percent = progress.percent ?? job.percent;
        if (job.kind === 'video' && progress.percent != null) {
          percent = progress.audioOnly && sawVideo ? 90 + progress.percent * 0.1 : progress.percent * (sawVideo ? 0.9 : 1);
        }
        const now = Date.now();
        if (now - lastEmit > 150 || progress.percent === 100) {
          lastEmit = now;
          this.patch(job, { status: 'downloading', percent, speed: progress.speed, eta: progress.eta });
        }
        return;
      }
      const info = ytdlp.parseInfoLine(line);
      if (info) {
        // Keeps what the link already told us when yt-dlp has nothing better.
        for (const [key, value] of Object.entries(info)) if (value != null) job[key] = value;
        return;
      }
      const file = ytdlp.parseFileLine(line);
      if (file) {
        job.filePath = file;
        return;
      }
      const dest = DESTINATION.exec(line);
      if (dest) {
        partials.add(dest[1]);
        return;
      }
      if (ytdlp.isPostprocessLine(line) && job.status !== 'processing') {
        this.patch(job, { status: 'processing', percent: 100, speed: null, eta: null });
      }
    };

    let handle;
    try {
      handle = ytdlp.run(env.bin, args, { env: env.extraEnv, onLine });
    } catch (err) {
      this.patch(job, { status: 'error', error: err.message });
      return;
    }
    this.running.set(job.id, handle.child);

    handle.done
      .then(({ code, stderr }) => {
        if (job.canceling) {
          for (const p of partials) {
            for (const f of [p, `${p}.part`, `${p}.ytdl`]) fs.rm(f, { force: true }, () => {});
          }
          this.patch(job, { status: 'canceled', speed: null, eta: null });
        } else if (code === 0) {
          this.patch(job, { status: 'done', percent: 100, speed: null, eta: null });
          this.emit('done', job);
        } else {
          this.patch(job, { status: 'error', error: ytdlp.friendlyError(stderr, job.url), speed: null, eta: null });
        }
      })
      .catch((err) => this.patch(job, { status: 'error', error: err.message }))
      .finally(() => {
        this.running.delete(job.id);
        this.pump();
      });
  }
}

module.exports = { Queue };
