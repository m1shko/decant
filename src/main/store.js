// Small JSON files in the user's data folder for settings and history.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// The app used to be called Siphon: carry its settings and history over.
const oldDir = path.join(app.getPath('appData'), 'Siphon');
if (!fs.existsSync(app.getPath('userData')) && fs.existsSync(oldDir)) {
  try {
    fs.renameSync(oldDir, app.getPath('userData'));
  } catch {}
}

function jsonFile(name, fallback) {
  const file = path.join(app.getPath('userData'), name);
  let data;
  try {
    data = { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    data = { ...fallback };
  }
  let timer = null;
  const write = () => {
    timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  };
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(write, 200);
  };
  return {
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

const settings = jsonFile('settings.json', {
  outputDir: null,
  kind: 'audio',
  audioFormat: 'mp3',
  audioQuality: '320',
  videoQuality: '1080',
  cookiesBrowser: '',
  lastEngineUpdate: 0,
});

const HISTORY_LIMIT = 300;
const historyFile = jsonFile('history.json', { items: [] });

const history = {
  list: () => historyFile.get().items,
  add(entry) {
    const items = [entry, ...historyFile.get().items].slice(0, HISTORY_LIMIT);
    historyFile.set({ items });
  },
  remove(id) {
    historyFile.set({ items: historyFile.get().items.filter((i) => i.id !== id) });
  },
  clear() {
    historyFile.set({ items: [] });
  },
};

// Videos and songs saved inside the app: each one gets its own folder in
// Library/ holding the media file and its cover, so they play offline.
const LIBRARY_DIR = path.join(app.getPath('userData'), 'Library');
const libraryFile = jsonFile('library.json', { items: [] });

const library = {
  dir: (id) => path.join(LIBRARY_DIR, id),
  list: () => libraryFile.get().items,
  get: (id) => libraryFile.get().items.find((i) => i.id === id),
  add(entry) {
    libraryFile.set({ items: [entry, ...libraryFile.get().items] });
  },
  update(id, patch) {
    libraryFile.set({ items: libraryFile.get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  },
  remove(id) {
    libraryFile.set({ items: libraryFile.get().items.filter((i) => i.id !== id) });
    fs.rm(library.dir(id), { recursive: true, force: true }, () => {});
  },
  // Deletes folders left by downloads that never finished.
  prune() {
    let names = [];
    try {
      names = fs.readdirSync(LIBRARY_DIR);
    } catch {}
    for (const name of names) {
      if (!library.get(name)) fs.rm(library.dir(name), { recursive: true, force: true }, () => {});
    }
  },
  flush: () => libraryFile.flush(),
};

module.exports = { settings, history, library };
