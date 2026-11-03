// Fills bin/ with the tools Siphon drives: yt-dlp (from its GitHub releases),
// ffmpeg (from the ffmpeg-static package) and ffprobe (from the same
// ffmpeg-static release, which the package itself does not install).
// electron-builder then copies bin/ into the app's resources.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const binDir = path.join(root, 'bin');
const platform = process.platform;
const exe = platform === 'win32' ? '.exe' : '';
const refresh = Boolean(process.env.SIPHON_REFRESH_BINARIES);

const YTDLP_ASSET = {
  darwin: 'yt-dlp_macos',
  win32: 'yt-dlp.exe',
  linux: 'yt-dlp_linux',
}[platform];

async function download(url) {
  console.log(`[siphon] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function write(name, bytes) {
  fs.writeFileSync(path.join(binDir, `${name}${exe}`), bytes, { mode: 0o755 });
}

function present(name) {
  return !refresh && fs.existsSync(path.join(binDir, `${name}${exe}`));
}

async function fetchYtDlp() {
  if (present('yt-dlp')) return;
  write('yt-dlp', await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}`));
}

function copyFfmpeg() {
  const source = require('ffmpeg-static');
  if (!source || !fs.existsSync(source)) throw new Error(`ffmpeg not found (${source})`);
  write('ffmpeg', fs.readFileSync(source));
}

// ffprobe must match this machine's architecture: the ffprobe-static package
// ships an Intel binary even in its arm64 folder.
async function fetchFfprobe() {
  if (present('ffprobe')) return;
  const tag = require('ffmpeg-static/package.json')['ffmpeg-static']['binary-release-tag'];
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}/ffprobe-${platform}-${process.arch}.gz`;
  write('ffprobe', zlib.gunzipSync(await download(url)));
}

fs.mkdirSync(binDir, { recursive: true });
copyFfmpeg();
await Promise.all([fetchYtDlp(), fetchFfprobe()]);
console.log(`[siphon] binaries ready in ${binDir}`);
