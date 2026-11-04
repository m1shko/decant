// Zips the browser extension for a GitHub release, with the app's version:
//   node scripts/pack-extension.mjs  ->  dist/Decant-Extension-x.y.z.zip
// The zip holds one Decant-Extension folder, the one to pick in the browser's
// "Load unpacked".
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'decant-extension-'));
const folder = path.join(work, 'Decant-Extension');
fs.cpSync(path.join(root, 'extension'), folder, { recursive: true, filter: (src) => !/\.DS_Store$/.test(src) });

// Browsers want plain numbers ("1.2.0"); a pre-release keeps its full name for display.
const manifestFile = path.join(folder, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
manifest.version = version.split(/[-+]/)[0];
if (manifest.version !== version) manifest.version_name = version;
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

const out = path.join(root, 'dist', `Decant-Extension-${version}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
if (process.platform === 'win32') execFileSync('tar', ['-a', '-c', '-f', out, 'Decant-Extension'], { cwd: work });
else execFileSync('zip', ['-r', '-X', '-q', out, 'Decant-Extension'], { cwd: work });
fs.rmSync(work, { recursive: true, force: true });
console.log(path.relative(root, out));
