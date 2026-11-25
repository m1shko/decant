// New versions of Decant: asks GitHub for the latest release and picks the
// file this copy of Decant can update itself from. Installing is in main.js.
const fs = require('node:fs');
const crypto = require('node:crypto');

const RELEASES_API = 'https://api.github.com/repos/m1shko/decant/releases/latest';
// Published with every release by the Build workflow: one "<sha256>  <file>"
// line per file. A download must match its line before it is installed.
const CHECKSUMS = 'SHA256SUMS.txt';

// "1.10.0" > "1.9.2"; a leading "v" and pre-release suffixes are ignored.
function parseVersion(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
}

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// How this copy updates itself:
//   mac-zip       the .app is replaced by the one in the -mac.zip
//   win-setup     the installer runs silently over the installed app
//   win-portable  the .exe is replaced
//   appimage      the .AppImage is replaced
//   deb           the package is installed with pkexec dpkg -i
//   manual        none of these: the release page opens in the browser
// `canReplace`: Decant may write where it lives (macOS: not run from the
// disk image or a read-only folder).
function updateKind({ platform, packaged = true, portable = false, appImage = false, canReplace = true } = {}) {
  if (!packaged) return 'manual';
  if (platform === 'darwin') return canReplace ? 'mac-zip' : 'manual';
  if (platform === 'win32') return portable ? 'win-portable' : 'win-setup';
  if (platform === 'linux') return appImage ? 'appimage' : 'deb';
  return 'manual';
}

// The file for that kind, named as electron-builder names them (see the
// release's Download table). null when none fits, e.g. an Intel Mac.
function pickAsset(assets = [], kind, arch) {
  const find = (test) => assets.find((a) => test(a.name)) || null;
  switch (kind) {
    case 'mac-zip':
      return find((n) => n.endsWith(`-${arch}-mac.zip`)) || (arch === 'x64' ? find((n) => /^Decant-[\d.]+-mac\.zip$/.test(n)) : null);
    case 'win-setup':
      return arch === 'x64' ? find((n) => /^Decant\.Setup\.[\d.]+\.exe$/.test(n)) : null;
    case 'win-portable':
      return arch === 'x64' ? find((n) => /^Decant\.[\d.]+\.exe$/.test(n)) : null;
    case 'appimage':
      return arch === 'x64' ? find((n) => n.endsWith('.AppImage')) : null;
    case 'deb': {
      const debArch = { x64: 'amd64', arm64: 'arm64' }[arch];
      return debArch ? find((n) => n.endsWith(`_${debArch}.deb`)) : null;
    }
    default:
      return null;
  }
}

// "<sha256>  <name>" lines (sha256sum's format, "*" for binary mode too) as
// a Map of name -> lowercase hash. Other lines are ignored.
function parseChecksums(text) {
  const sums = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line.trim());
    if (m) sums.set(m[2].trim(), m[1].toLowerCase());
  }
  return sums;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// 'ok' when `file` matches the line for `name` in the checksums text,
// 'missing' when there is no such line, 'mismatch' when the hash differs.
async function verifyDownload({ file, name, checksums }) {
  const expected = parseChecksums(checksums).get(name);
  if (!expected) return 'missing';
  return (await sha256File(file)) === expected ? 'ok' : 'mismatch';
}

// The latest release, or null when it is not newer than `current`.
// `system`: { arch, kind } — see updateKind.
async function check({ current, fetch, system }) {
  const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const release = await res.json();
  const version = String(release.tag_name || '').replace(/^v/i, '');
  if (!version || release.draft || release.prerelease || !isNewer(version, current)) return null;
  // Without a checksums file the download cannot be checked: the release
  // page opens instead, as for a system Decant cannot update itself on.
  const sums = (release.assets || []).find((a) => a.name === CHECKSUMS) || null;
  const asset = sums ? pickAsset(release.assets, system.kind, system.arch) : null;
  return {
    version,
    page: release.html_url,
    notes: release.body || '',
    kind: asset ? system.kind : 'manual',
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size || 0 } : null,
    checksums: asset ? sums.browser_download_url : null,
  };
}

module.exports = { RELEASES_API, CHECKSUMS, isNewer, updateKind, pickAsset, parseChecksums, sha256File, verifyDownload, check };
