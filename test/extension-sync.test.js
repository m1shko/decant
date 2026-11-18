const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fingerprint, listFiles, sync } = require('../src/main/extension');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decant-ext-test-'));
}

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}

const manifest = (extra = {}) => JSON.stringify({ manifest_version: 3, name: 'x', version: '1.0.0', ...extra });

test('the fingerprint ignores versions and .DS_Store, not contents', () => {
  const a = tmp();
  const b = tmp();
  write(a, { 'manifest.json': manifest(), 'background.js': 'one' });
  write(b, { 'manifest.json': manifest({ version: '9.9.9', version_name: 'whatever' }), 'background.js': 'one', '.DS_Store': 'junk' });
  assert.equal(fingerprint(a), fingerprint(b));
  write(b, { 'background.js': 'two' });
  assert.notEqual(fingerprint(a), fingerprint(b));
  assert.equal(fingerprint(tmp()), null);
});

test('sync copies once, stamps the version, and removes files that went away', () => {
  const source = tmp();
  const target = path.join(tmp(), 'Decant-Extension');
  write(source, { 'manifest.json': manifest(), 'background.js': 'one', '_locales/fr/messages.json': '{}' });

  const first = sync({ source, target, version: '1.3.0' });
  assert.equal(first.changed, true);
  assert.deepEqual(listFiles(target), ['_locales/fr/messages.json', 'background.js', 'manifest.json']);
  const stamped = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
  assert.equal(stamped.version, '1.3.0');
  assert.equal(stamped.version_name, `1.3.0 (${first.fingerprint})`);

  // Same files, newer app: nothing to do, so the extension does not reload.
  assert.equal(sync({ source, target, version: '1.4.0' }).changed, false);

  write(source, { 'background.js': 'two' });
  fs.rmSync(path.join(source, '_locales'), { recursive: true });
  const second = sync({ source, target, version: '1.4.0-beta.1' });
  assert.equal(second.changed, true);
  assert.deepEqual(listFiles(target), ['background.js', 'manifest.json']);
  assert.equal(fs.readFileSync(path.join(target, 'background.js'), 'utf8'), 'two');
  const again = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
  assert.equal(again.version, '1.4.0');
  assert.equal(again.version_name, `1.4.0-beta.1 (${second.fingerprint})`);
});
