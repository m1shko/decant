const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { jsonFile, writeAtomic } = require('../src/main/jsonfile');

const fallback = { items: [], playlists: [] };

// A fresh folder per test, and a jsonFile that writes only on flush().
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decant-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'library.json');
  const logs = [];
  const open = () => jsonFile(file, fallback, { delay: 60_000, log: (m) => logs.push(m) });
  const read = (f = file) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const leftovers = () => fs.readdirSync(dir).filter((n) => n.includes('.corrupt-'));
  return { dir, file, backup: `${file}.bak`, logs, open, read, leftovers };
}

test('first launch starts from the defaults without writing anything', (t) => {
  const { dir, open, logs } = setup(t);
  const store = open();
  assert.equal(store.status, 'new');
  assert.deepEqual(store.get(), fallback);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(logs, []);
});

test('a save writes the file and leaves no temporary file', (t) => {
  const { dir, file, open, read } = setup(t);
  const store = open();
  store.set({ items: [{ id: 'a' }] });
  store.flush();
  assert.deepEqual(read(file).items, [{ id: 'a' }]);
  assert.deepEqual(fs.readdirSync(dir), ['library.json']);
  assert.equal(open().status, 'ok');
});

test('each save keeps the previous version as the backup', (t) => {
  const { file, backup, open, read } = setup(t);
  const store = open();
  store.set({ items: [{ id: 'a' }] });
  store.flush();
  store.set({ items: [{ id: 'a' }, { id: 'b' }] });
  store.flush();
  assert.deepEqual(read(file).items.map((i) => i.id), ['a', 'b']);
  assert.deepEqual(read(backup).items.map((i) => i.id), ['a']);
});

test('a corrupted file is restored from the backup and kept aside', (t) => {
  const { file, backup, open, read, leftovers, logs } = setup(t);
  const first = open();
  first.set({ items: [{ id: 'a' }] });
  first.flush();
  first.set({ items: [{ id: 'a' }, { id: 'b' }] });
  first.flush();
  fs.writeFileSync(file, '{"items": [{"id": "a"}, {"id": '); // cut off mid-write

  const store = open();
  assert.equal(store.status, 'recovered');
  assert.deepEqual(store.get().items, [{ id: 'a' }]);
  assert.equal(leftovers().length, 1);
  assert.match(logs.join('\n'), /restored from library\.json\.bak/);

  // The next save must not replace the good backup with the broken file.
  store.set({ items: [...store.get().items, { id: 'c' }] });
  store.flush();
  assert.deepEqual(read(file).items.map((i) => i.id), ['a', 'c']);
  assert.deepEqual(read(backup).items.map((i) => i.id), ['a']);
});

test('an empty file (power cut) is treated as corrupted, not as an empty library', (t) => {
  const { file, open, read } = setup(t);
  const first = open();
  first.set({ items: [{ id: 'a' }] });
  first.flush();
  first.set({ items: [{ id: 'a' }, { id: 'b' }] });
  first.flush();
  fs.writeFileSync(file, '');
  const store = open();
  assert.equal(store.status, 'recovered');
  assert.deepEqual(store.get().items, [{ id: 'a' }]);
  store.set({ playlists: [] });
  store.flush();
  assert.deepEqual(read(file).items, [{ id: 'a' }]);
});

test('a missing file is restored from the backup', (t) => {
  const { file, open } = setup(t);
  const first = open();
  first.set({ items: [{ id: 'a' }] });
  first.flush();
  first.set({ items: [{ id: 'b' }] });
  first.flush();
  fs.unlinkSync(file);
  const store = open();
  assert.equal(store.status, 'recovered');
  assert.deepEqual(store.get().items, [{ id: 'a' }]);
});

test('JSON that is not an object counts as corrupted', (t) => {
  const { file, backup, open } = setup(t);
  fs.writeFileSync(backup, JSON.stringify({ items: [{ id: 'a' }] }));
  for (const text of ['null', '[]', '42']) {
    fs.writeFileSync(file, text);
    assert.equal(open().status, 'recovered', text);
  }
});

test('when both files are unreadable, they are kept aside and the app starts empty', (t) => {
  const { file, backup, open, read, leftovers } = setup(t);
  fs.writeFileSync(file, '{oops');
  fs.writeFileSync(backup, '{oops too');
  const store = open();
  assert.equal(store.status, 'lost');
  assert.deepEqual(store.get(), fallback);
  assert.equal(leftovers().length, 1);
  assert.equal(fs.readFileSync(backup, 'utf8'), '{oops too');
  store.set({ items: [{ id: 'new' }] });
  store.flush();
  assert.deepEqual(read(file).items, [{ id: 'new' }]);
});

test('defaults fill keys missing from the file', (t) => {
  const { file, open } = setup(t);
  fs.writeFileSync(file, JSON.stringify({ items: [{ id: 'a' }] }));
  assert.deepEqual(open().get(), { items: [{ id: 'a' }], playlists: [] });
});

test('a failed save keeps the data in memory and does not throw', (t) => {
  const { dir, file, open, read, logs } = setup(t);
  const store = open();
  fs.mkdirSync(`${file}.tmp`); // the temporary file cannot be created
  store.set({ items: [{ id: 'a' }] });
  assert.doesNotThrow(() => store.flush());
  assert.match(logs.join('\n'), /could not save library\.json/);
  assert.deepEqual(store.get().items, [{ id: 'a' }]);
  assert.equal(fs.existsSync(file), false);
  fs.rmdirSync(`${file}.tmp`);
  store.set({});
  store.flush();
  assert.deepEqual(read(file).items, [{ id: 'a' }]);
  assert.ok(fs.readdirSync(dir).includes('library.json'));
});

test('writeAtomic replaces the file in one step', (t) => {
  const { file, read } = setup(t);
  fs.writeFileSync(file, '{"v": 1}');
  writeAtomic(file, '{"v": 2}');
  assert.deepEqual(read(file), { v: 2 });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('saves are grouped until the delay passes', async (t) => {
  const { file, read } = setup(t);
  const store = jsonFile(file, fallback, { delay: 20, log: () => {} });
  store.set({ items: [{ id: 'a' }] });
  store.set({ items: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(fs.existsSync(file), false);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(read(file).items.map((i) => i.id), ['a', 'b']);
});
