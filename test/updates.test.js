const test = require('node:test');
const assert = require('node:assert/strict');
const { isNewer, updateKind, pickAsset, check } = require('../src/main/updates');

// Named like the files of every release.
const assets = [
  'Decant-1.3.0-arm64-mac.zip',
  'Decant-1.3.0-arm64.dmg',
  'Decant-1.3.0.AppImage',
  'Decant-Extension-1.3.0.zip',
  'Decant.1.3.0.exe',
  'Decant.Setup.1.3.0.exe',
  'decant_1.3.0_amd64.deb',
].map((name) => ({ name, browser_download_url: `https://example.test/${name}`, size: 100 }));
const pick = (kind, arch) => pickAsset(assets, kind, arch)?.name ?? null;

test('versions compare number by number', () => {
  assert.equal(isNewer('1.3.0', '1.2.0'), true);
  assert.equal(isNewer('v1.10.0', '1.9.9'), true);
  assert.equal(isNewer('1.2.0', '1.2.0'), false);
  assert.equal(isNewer('1.1.9', '1.2.0'), false);
  assert.equal(isNewer('2', '1.9.9'), true);
  assert.equal(isNewer('1.2.1-beta', '1.2.0'), true);
});

test('each kind of install updates its own way', () => {
  assert.equal(updateKind({ platform: 'darwin' }), 'mac-zip');
  assert.equal(updateKind({ platform: 'darwin', canReplace: false }), 'manual');
  assert.equal(updateKind({ platform: 'win32' }), 'win-setup');
  assert.equal(updateKind({ platform: 'win32', portable: true }), 'win-portable');
  assert.equal(updateKind({ platform: 'linux' }), 'deb');
  assert.equal(updateKind({ platform: 'linux', appImage: true }), 'appimage');
  assert.equal(updateKind({ platform: 'darwin', packaged: false }), 'manual');
});

test('each kind gets its own file', () => {
  assert.equal(pick('mac-zip', 'arm64'), 'Decant-1.3.0-arm64-mac.zip');
  assert.equal(pick('mac-zip', 'x64'), null);
  assert.equal(pick('win-setup', 'x64'), 'Decant.Setup.1.3.0.exe');
  assert.equal(pick('win-portable', 'x64'), 'Decant.1.3.0.exe');
  assert.equal(pick('deb', 'x64'), 'decant_1.3.0_amd64.deb');
  assert.equal(pick('appimage', 'x64'), 'Decant-1.3.0.AppImage');
  assert.equal(pick('deb', 'arm64'), null);
  assert.equal(pick('manual', 'x64'), null);
});

const answer = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 403, json: async () => body });

test('check returns the newer release with the file for this install', async () => {
  const release = { tag_name: 'v1.3.0', html_url: 'https://example.test/r', body: 'notes', assets: [...assets, { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt' }] };
  const found = await check({ current: '1.2.0', fetch: answer(release), system: { kind: 'mac-zip', arch: 'arm64' } });
  assert.deepEqual(found, {
    version: '1.3.0',
    page: 'https://example.test/r',
    notes: 'notes',
    kind: 'mac-zip',
    asset: { name: 'Decant-1.3.0-arm64-mac.zip', url: 'https://example.test/Decant-1.3.0-arm64-mac.zip', size: 100 },
    checksums: 'https://example.test/SHA256SUMS.txt',
  });
  const intel = await check({ current: '1.2.0', fetch: answer(release), system: { kind: 'mac-zip', arch: 'x64' } });
  assert.equal(intel.kind, 'manual');
  assert.equal(intel.asset, null);
});

test('check returns null when up to date, and throws when GitHub refuses', async () => {
  const release = { tag_name: 'v1.2.0', assets };
  assert.equal(await check({ current: '1.2.0', fetch: answer(release), system: { kind: 'deb', arch: 'x64' } }), null);
  await assert.rejects(check({ current: '1.2.0', fetch: answer({}, false), system: { kind: 'deb', arch: 'x64' } }), /403/);
});

// --- Checksums ---------------------------------------------------------------
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseChecksums, sha256File, verifyDownload } = require('../src/main/updates');

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sumsAsset = { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt', size: 10 };

test('checksums are read as sha256sum writes them', () => {
  const a = 'a'.repeat(64);
  const b = 'B'.repeat(64);
  const sums = parseChecksums(`${a}  Decant-1.3.0-arm64-mac.zip\r\n${b} *Decant.Setup.1.3.0.exe\nnot a line\n\n`);
  assert.equal(sums.get('Decant-1.3.0-arm64-mac.zip'), a);
  assert.equal(sums.get('Decant.Setup.1.3.0.exe'), 'b'.repeat(64));
  assert.equal(sums.size, 2);
  assert.equal(parseChecksums('').size, 0);
});

test('a download is installed only when it matches its checksum', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decant-sums-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'Decant-1.3.0.AppImage');
  fs.writeFileSync(file, 'the real app');
  assert.equal(await sha256File(file), sha('the real app'));

  const good = `${sha('the real app')}  Decant-1.3.0.AppImage\n`;
  assert.equal(await verifyDownload({ file, name: 'Decant-1.3.0.AppImage', checksums: good }), 'ok');
  assert.equal(await verifyDownload({ file, name: 'Decant-1.3.0.AppImage', checksums: good.toUpperCase().replace('DECANT-1.3.0.APPIMAGE', 'Decant-1.3.0.AppImage') }), 'ok');

  // Same size, different bytes: refused.
  fs.writeFileSync(file, 'the fake app');
  assert.equal(await verifyDownload({ file, name: 'Decant-1.3.0.AppImage', checksums: good }), 'mismatch');
  // No line for this file, or no checksums at all: refused.
  assert.equal(await verifyDownload({ file, name: 'Decant-1.3.0.AppImage', checksums: `${sha('x')}  other.zip\n` }), 'missing');
  assert.equal(await verifyDownload({ file, name: 'Decant-1.3.0.AppImage', checksums: '' }), 'missing');
});

test('check points to the checksums, and falls back to the release page without them', async () => {
  const withSums = { tag_name: 'v1.3.0', html_url: 'https://example.test/r', assets: [...assets, sumsAsset] };
  const found = await check({ current: '1.2.0', fetch: answer(withSums), system: { kind: 'deb', arch: 'x64' } });
  assert.equal(found.kind, 'deb');
  assert.equal(found.checksums, 'https://example.test/SHA256SUMS.txt');

  const without = { tag_name: 'v1.3.0', html_url: 'https://example.test/r', assets };
  const manual = await check({ current: '1.2.0', fetch: answer(without), system: { kind: 'deb', arch: 'x64' } });
  assert.equal(manual.kind, 'manual');
  assert.equal(manual.asset, null);
  assert.equal(manual.checksums, null);
});
