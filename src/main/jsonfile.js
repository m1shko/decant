// A small JSON file that survives crashes and power cuts.
//
// Writing: the data goes to `<file>.tmp` first, is flushed to disk, then
// renamed over `<file>`. A rename is atomic, so `<file>` is always either the
// old version or the new one, never half written. Before each write, the
// current version (known to be good) is copied to `<file>.bak`.
//
// Reading: if `<file>` is missing or unreadable, `<file>.bak` is used. A
// broken `<file>` is kept aside as `<file>.corrupt-<time>` so nothing is lost,
// and the next save cannot overwrite the backup with bad data.
const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not a JSON object');
  return value;
}

// What is in `file`, or its backup. `status` is 'ok', 'new' (neither file
// exists), 'recovered' (the backup was used) or 'lost' (both are unreadable).
function load(file, log) {
  const backup = `${file}.bak`;
  let error;
  try {
    return { status: 'ok', value: readJson(file) };
  } catch (e) {
    error = e;
  }
  const missing = error.code === 'ENOENT';
  if (!missing) {
    // Keep the broken file for later inspection, out of the way of saves.
    const aside = `${file}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(file, aside);
      log(`${path.basename(file)} is unreadable (${error.message}), kept as ${path.basename(aside)}`);
    } catch {}
  }
  try {
    const value = readJson(backup);
    if (!missing) log(`${path.basename(file)} restored from ${path.basename(backup)}`);
    else if (fs.existsSync(backup)) log(`${path.basename(file)} is missing, restored from ${path.basename(backup)}`);
    return { status: 'recovered', value };
  } catch (e) {
    if (missing && e.code === 'ENOENT') return { status: 'new', value: {} };
    log(`${path.basename(file)} and its backup are unreadable, starting empty`);
    return { status: 'lost', value: {} };
  }
}

// Replaces `file` with `text` in one step.
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // On Windows an antivirus or indexer can hold the file for a moment.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      const until = Date.now() + 20 * (attempt + 1);
      while (Date.now() < until);
    }
  }
}

function jsonFile(file, fallback, { delay = 200, log = (m) => console.warn(`[store] ${m}`) } = {}) {
  const backup = `${file}.bak`;
  const loaded = load(file, log);
  const data = { ...fallback, ...loaded.value };
  // Whether `file` holds good data that may become the backup.
  let fileIsGood = loaded.status === 'ok';
  let timer = null;

  const write = () => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fileIsGood) fs.copyFileSync(file, backup);
      writeAtomic(file, JSON.stringify(data, null, 2));
      fileIsGood = true;
    } catch (e) {
      // The data stays in memory; the next change tries again.
      log(`could not save ${path.basename(file)}: ${e.message}`);
    }
  };
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(write, delay);
  };
  return {
    status: loaded.status,
    get: () => data,
    set(patch) {
      Object.assign(data, patch);
      save();
      return data;
    },
    // Writes a pending change now (the app is about to quit).
    flush() {
      if (timer) {
        clearTimeout(timer);
        write();
      }
    },
  };
}

module.exports = { jsonFile, load, writeAtomic };
