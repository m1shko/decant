// Everything that knows how to talk to yt-dlp: building command lines,
// reading its output, and turning its JSON into what the interface shows.
const { spawn } = require('node:child_process');

const AUDIO_FORMATS = ['mp3', 'm4a', 'wav', 'flac'];
const VIDEO_FORMATS = ['mp4'];
const MP3_BITRATES = ['320', '192', '128'];
const VIDEO_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];
const PROGRESS_PREFIX = '[siphon]';
const FILE_PREFIX = 'SIPHONFILE|';

// "1:20", "01:02:03", "80" or "80.5" -> seconds. Returns null for anything else.
function parseTime(text) {
  if (text == null) return null;
  const parts = String(text).trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

// 80 -> "1:20", 3723 -> "1:02:03"
function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function commonArgs({ ffmpegDir, cookiesBrowser }) {
  const args = ['--ignore-config', '--no-warnings', '--ffmpeg-location', ffmpegDir];
  if (cookiesBrowser) args.push('--cookies-from-browser', cookiesBrowser);
  return args;
}

function probeArgs(input, { playlist = false, search = false, ...env }) {
  const args = [...commonArgs(env), '--dump-single-json', '--flat-playlist'];
  if (search) return [...args, `ytsearch10:${input}`];
  args.push(playlist ? '--yes-playlist' : '--no-playlist');
  return [...args, '--', input];
}

function downloadArgs(job, env) {
  const args = [
    ...commonArgs(env),
    '--no-playlist',
    '--newline',
    '--progress',
    '--progress-template',
    `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.vcodec)s`,
    '--print',
    `after_move:${FILE_PREFIX}%(filepath)s`,
    '--no-quiet',
    '--no-mtime',
    '--windows-filenames',
    '--paths',
    job.outputDir,
  ];

  let name = '%(title).150B';
  const trim = job.trim;
  if (trim) {
    const start = parseTime(trim.start) ?? 0;
    const end = parseTime(trim.end);
    const range = `${start}-${end ?? 'inf'}`;
    args.push('--download-sections', `*${range}`, '--force-keyframes-at-cuts');
    name += ` (${formatTime(start).replace(/:/g, '.')}-${end == null ? 'fin' : formatTime(end).replace(/:/g, '.')})`;
  }
  args.push('--output', `${name}.%(ext)s`);

  if (job.kind === 'audio') {
    args.push('--format', job.format === 'm4a' ? 'ba[ext=m4a]/ba/b' : 'ba/b');
    args.push('--extract-audio', '--audio-format', job.format);
    if (job.format === 'mp3') args.push('--audio-quality', `${job.quality || '320'}K`);
  } else {
    const height = Number(job.quality) || null;
    // Prefer H.264/AAC so the file plays everywhere (QuickTime, Windows, phones);
    // above 1080p sites only offer VP9/AV1 and those get picked instead.
    const sort = [height ? `res:${height}` : 'res', 'vcodec:h264', 'acodec:aac'];
    args.push('--format', 'bv*+ba/b', '--format-sort', sort.join(','), '--merge-output-format', 'mp4');
  }

  if (job.format !== 'wav') {
    args.push('--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg');
  }
  args.push('--', job.url);
  return args;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// One "[siphon] a|b|c|d|e|f" line from --progress-template.
function parseProgressLine(line) {
  const at = line.indexOf(PROGRESS_PREFIX);
  if (at === -1) return null;
  const [downloaded, total, estimate, speed, eta, vcodec] = line
    .slice(at + PROGRESS_PREFIX.length)
    .trim()
    .split('|');
  const size = num(total) ?? num(estimate);
  const done = num(downloaded);
  return {
    downloaded: done,
    total: size,
    percent: size && done != null ? Math.min(100, (done / size) * 100) : null,
    speed: num(speed),
    eta: num(eta),
    audioOnly: vcodec === 'none',
  };
}

function parseFileLine(line) {
  return line.startsWith(FILE_PREFIX) ? line.slice(FILE_PREFIX.length).trim() : null;
}

// Lines yt-dlp prints while ffmpeg converts, merges or tags the file.
function isPostprocessLine(line) {
  return /^\[(ExtractAudio|Merger|EmbedThumbnail|Metadata|VideoConvertor|VideoRemuxer|FixupM3u8|FixupM4a|FixupStretched|FixupDuplicateMoov|ThumbnailsConvertor|ffmpeg|SplitChapters|ModifyChapters)\]/.test(
    line,
  );
}

function friendlyError(stderr, url = '') {
  const lines = String(stderr).split(/\r?\n/).filter((l) => l.startsWith('ERROR:'));
  const raw = (lines.at(-1) || String(stderr).trim().split(/\r?\n/).at(-1) || 'Erreur inconnue').replace(/^ERROR:\s*/, '');
  const lower = raw.toLowerCase();
  if (/login required|log in|logged-in|rate-limit reached|requested content is not available/.test(lower) && /instagram/.test(url + lower)) {
    return "Instagram demande d'être connecté. Choisis ton navigateur dans « Cookies » (en bas) puis réessaie.";
  }
  if (/sign in to confirm|not a bot/.test(lower)) {
    return 'YouTube demande une vérification. Choisis ton navigateur dans « Cookies » (en bas) puis réessaie.';
  }
  if (/private/.test(lower)) return 'Cette vidéo est privée.';
  if (/unsupported url/.test(lower)) return "Ce lien n'est pas pris en charge.";
  if (/video unavailable|not available|removed|404/.test(lower)) return "Cette vidéo n'est pas (ou plus) disponible.";
  if (/age/.test(lower) && /restrict|confirm your age/.test(lower)) {
    return 'Vidéo soumise à une limite d\'âge : choisis ton navigateur dans « Cookies » (en bas).';
  }
  if (/could not copy .* cookie|cookies? database|keychain|operation not permitted/.test(lower)) {
    return `Impossible de lire les cookies du navigateur : ${raw}`;
  }
  if (/getaddrinfo|network|timed out|connection/.test(lower)) return 'Problème de connexion internet.';
  return raw;
}

function pickThumbnail(info) {
  if (info.thumbnail) return info.thumbnail;
  const thumbs = Array.isArray(info.thumbnails) ? info.thumbnails : [];
  return thumbs.at(-1)?.url || null;
}

function entryUrl(entry) {
  if (entry.url && /^https?:/.test(entry.url)) return entry.url;
  if (entry.webpage_url) return entry.webpage_url;
  if (entry.ie_key === 'Youtube' || entry.extractor_key === 'Youtube') return `https://www.youtube.com/watch?v=${entry.id}`;
  return entry.url;
}

// Whether a [width, height] frame counts as "1080p" (etc.). Like yt-dlp's `res`,
// the short side decides, so portrait 1080x1920 is 1080p; the long side also
// counts so a letterboxed 1920x800 film still shows as 1080p.
function reaches([w, h], step) {
  return Math.min(w, h) >= step * 0.95 || Math.max(w, h) >= ((step * 16) / 9) * 0.95;
}

// Reduces the (huge) yt-dlp JSON to what the interface needs.
function summarizeInfo(info) {
  if (info._type === 'playlist') {
    const entries = (info.entries || []).filter(Boolean).map((e) => ({
      url: entryUrl(e),
      title: e.title || e.id,
      duration: e.duration ?? null,
      uploader: e.uploader || e.channel || null,
      thumbnail: pickThumbnail(e),
    }));
    return {
      type: 'playlist',
      title: info.title || 'Playlist',
      uploader: info.uploader || info.channel || null,
      source: info.extractor_key || info.ie_key || null,
      entries,
    };
  }
  const sizes = (info.formats?.length ? info.formats : [info])
    .filter((f) => f.vcodec !== 'none' && (f.height || f.width))
    .map((f) => [f.width || f.height, f.height || f.width]);
  return {
    type: 'video',
    url: info.webpage_url || info.original_url,
    title: info.title || info.id,
    uploader: info.uploader || info.channel || info.creator || null,
    duration: info.duration ?? null,
    thumbnail: pickThumbnail(info),
    source: info.extractor_key || null,
    hasVideo: sizes.length > 0,
    heights: VIDEO_HEIGHTS.filter((h) => sizes.some((size) => reaches(size, h))),
  };
}

// Runs yt-dlp, calling onLine for each output line. Resolves with the exit code.
function run(binPath, args, { env, onLine } = {}) {
  const child = spawn(binPath, args, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...env },
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  const split = (stream, append) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      append(chunk);
      buffer += chunk;
      const lines = buffer.split(/\r?\n|\r/);
      buffer = lines.pop();
      for (const line of lines) if (line && onLine) onLine(line);
    });
    stream.on('end', () => {
      if (buffer && onLine) onLine(buffer);
    });
  };
  split(child.stdout, (c) => (stdout += c));
  split(child.stderr, (c) => (stderr += c));
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done };
}

module.exports = {
  AUDIO_FORMATS,
  VIDEO_FORMATS,
  MP3_BITRATES,
  VIDEO_HEIGHTS,
  parseTime,
  formatTime,
  probeArgs,
  downloadArgs,
  parseProgressLine,
  parseFileLine,
  isPostprocessLine,
  friendlyError,
  summarizeInfo,
  run,
};
