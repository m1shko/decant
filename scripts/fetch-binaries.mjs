// Fills bin/ with the tools Siphon drives: yt-dlp (downloaded from its GitHub
// releases) plus ffmpeg and ffprobe (taken from the ffmpeg-static packages).
// electron-builder then copies bin/ into the app's resources.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const binDir = path.join(root, 'bin');
const platform = process.platform;
const exe = platform === 'win32' ? '.exe' : '';

const YTDLP_ASSET = {
  darwin: 'yt-dlp_macos',
  win32: 'yt-dlp.exe',
  linux: 'yt-dlp_linux',
}[platform];

async function fetchYtDlp() {
  const target = path.join(binDir, `yt-dlp${exe}`);
  if (fs.existsSync(target) && !process.env.SIPHON_REFRESH_BINARIES) {
    console.log('[siphon] yt-dlp already present');
    return;
  }
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}`;
  console.log(`[siphon] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`yt-dlp: HTTP ${res.status}`);
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
}

function copyTool(name, source) {
  if (!source || !fs.existsSync(source)) throw new Error(`${name} not found (${source})`);
  const target = path.join(binDir, `${name}${exe}`);
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
}

fs.mkdirSync(binDir, { recursive: true });
copyTool('ffmpeg', require('ffmpeg-static'));
copyTool('ffprobe', require('ffprobe-static').path);
await fetchYtDlp();
console.log(`[siphon] binaries ready in ${binDir}`);
