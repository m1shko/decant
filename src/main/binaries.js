// Where yt-dlp, ffmpeg and ffprobe live, and keeping yt-dlp up to date.
// The copies shipped inside the app are read-only (and signed on macOS), so
// yt-dlp is copied to the user's data folder the first time it needs updating.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./ytdlp');

const exe = process.platform === 'win32' ? '.exe' : '';

function bundledDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', '..', 'bin');
}

function userDir() {
  return path.join(app.getPath('userData'), 'bin');
}

function ytdlpPath() {
  const own = path.join(userDir(), `yt-dlp${exe}`);
  return fs.existsSync(own) ? own : path.join(bundledDir(), `yt-dlp${exe}`);
}

function ffmpegDir() {
  return bundledDir();
}

// yt-dlp needs a JavaScript runtime to read YouTube's player. Electron can act
// as Node.js, so it lends its own executable instead of shipping Deno.
function jsRuntime() {
  return {
    args: ['--js-runtimes', `node:${process.execPath}`],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

async function version() {
  const { stdout } = await run(ytdlpPath(), ['--version']).done;
  return stdout.trim();
}

async function update() {
  const own = path.join(userDir(), `yt-dlp${exe}`);
  if (!fs.existsSync(own)) {
    fs.mkdirSync(userDir(), { recursive: true });
    fs.copyFileSync(path.join(bundledDir(), `yt-dlp${exe}`), own);
    fs.chmodSync(own, 0o755);
  }
  const { code, stdout, stderr } = await run(own, ['--update-to', 'stable']).done;
  if (code !== 0) throw new Error((stderr || stdout).trim().split(/\r?\n/).at(-1));
  return version();
}

module.exports = { ytdlpPath, ffmpegDir, jsRuntime, version, update };
