// The browser extension, kept up to date by Decant. The app ships a copy and
// puts it in a folder of its own, the one the browser loads ("Load unpacked").
// When Decant updates and the extension changed, the files there are
// replaced and the manifest gets a new version_name: the extension notices
// and reloads itself (see extension/background.js).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FOLDER_NAME = 'Decant-Extension';
const IGNORED = /(^|[\\/])\.DS_Store$/;

// Every file under `dir`, as sorted paths relative to it.
function listFiles(dir, base = dir) {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listFiles(full, base));
    else if (entry.isFile() && !IGNORED.test(entry.name)) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

// The manifest without what Decant writes in it.
function plainManifest(text) {
  const { version, version_name, ...rest } = JSON.parse(text);
  return JSON.stringify(rest);
}

// A short hash of the extension's contents, versions left out, so the same
// files always give the same fingerprint.
function fingerprint(dir) {
  const files = listFiles(dir);
  if (!files.includes('manifest.json')) return null;
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const data = fs.readFileSync(path.join(dir, file));
    hash.update(file).update('\0').update(file === 'manifest.json' ? plainManifest(data.toString('utf8')) : data).update('\0');
  }
  return hash.digest('hex').slice(0, 10);
}

// Browsers want plain numbers in "version": "1.3.0-beta.1" -> "1.3.0".
const plainVersion = (v) => String(v).split(/[-+]/)[0];

// Copies `source` to `target` when its contents differ. The manifest is
// written last, so the extension never reloads a half-copied folder.
function sync({ source, target, version }) {
  const print = fingerprint(source);
  if (!print) throw new Error(`No extension in ${source}`);
  if (fingerprint(target) === print) return { changed: false, fingerprint: print };
  fs.mkdirSync(target, { recursive: true });
  const files = listFiles(source);
  for (const file of files) {
    if (file === 'manifest.json') continue;
    fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    fs.copyFileSync(path.join(source, file), path.join(target, file));
  }
  const keep = new Set(files);
  for (const file of listFiles(target)) if (!keep.has(file)) fs.rmSync(path.join(target, file), { force: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  manifest.version = plainVersion(version);
  manifest.version_name = `${version} (${print})`;
  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { changed: true, fingerprint: print };
}

module.exports = { FOLDER_NAME, listFiles, fingerprint, sync };
