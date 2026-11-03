// Small JSON files in the user's data folder for settings and history.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
  subtitleLang: '',
  captionStyle: {},
  playerVolume: 1,
  playerMuted: false,
  theater: false,
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
// Playlists only point at items: a video in two playlists is stored once.
const LIBRARY_DIR = path.join(app.getPath('userData'), 'Library');
const libraryFile = jsonFile('library.json', { items: [], playlists: [] });

// Whether two downloads are the same media: same video (by id, or by link
// for items saved before ids were kept), same kind, and neither is a clip.
function sameMedia(a, b) {
  if (a.kind !== b.kind || a.trim || b.trim) return false;
  return Boolean((a.key && a.key === b.key) || (a.url && a.url === b.url));
}

const library = {
  dir: (id) => path.join(LIBRARY_DIR, id),
  list: () => libraryFile.get().items,
  playlists: () => libraryFile.get().playlists,
  snapshot: () => ({ items: library.list(), playlists: library.playlists() }),
  get: (id) => libraryFile.get().items.find((i) => i.id === id),
  find: (spec) => library.list().find((i) => sameMedia(i, spec)),
  add(entry) {
    libraryFile.set({ items: [entry, ...libraryFile.get().items] });
  },
  update(id, patch) {
    libraryFile.set({ items: libraryFile.get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  },
  remove(id) {
    const { items, playlists } = libraryFile.get();
    libraryFile.set({
      items: items.filter((i) => i.id !== id),
      playlists: playlists.map((p) => ({ ...p, entries: p.entries.filter((e) => e.id !== id) })),
    });
    fs.rm(library.dir(id), { recursive: true, force: true }, () => {});
  },
  // The playlist saved from this source (same key), created if new.
  savePlaylist({ key, title, uploader, url, thumbnail }) {
    const playlists = libraryFile.get().playlists;
    const found = key && playlists.find((p) => p.key === key);
    if (found) {
      Object.assign(found, { title, uploader, url, thumbnail: thumbnail || found.thumbnail });
      libraryFile.set({ playlists });
      return found;
    }
    const playlist = { id: crypto.randomUUID(), key, title, uploader, url, thumbnail, date: Date.now(), entries: [] };
    libraryFile.set({ playlists: [playlist, ...playlists] });
    return playlist;
  },
  // Entries keep the order of the source playlist.
  addToPlaylist(playlistId, id, index) {
    const playlists = libraryFile.get().playlists;
    const playlist = playlists.find((p) => p.id === playlistId);
    if (!playlist || playlist.entries.some((e) => e.id === id)) return;
    playlist.entries = [...playlist.entries, { id, index }].sort((a, b) => a.index - b.index);
    libraryFile.set({ playlists });
  },
  removeFromPlaylist(playlistId, id) {
    const playlists = libraryFile.get().playlists.map((p) => (p.id === playlistId ? { ...p, entries: p.entries.filter((e) => e.id !== id) } : p));
    libraryFile.set({ playlists });
  },
  removePlaylist(playlistId) {
    libraryFile.set({ playlists: libraryFile.get().playlists.filter((p) => p.id !== playlistId) });
  },
  // At startup: deletes folders left by downloads that never finished, and
  // drops them from playlists (and playlists left empty).
  prune() {
    let names = [];
    try {
      names = fs.readdirSync(LIBRARY_DIR);
    } catch {}
    for (const name of names) {
      if (!library.get(name)) fs.rm(library.dir(name), { recursive: true, force: true }, () => {});
    }
    const playlists = libraryFile
      .get()
      .playlists.map((p) => ({ ...p, entries: p.entries.filter((e) => library.get(e.id)) }))
      .filter((p) => p.entries.length);
    libraryFile.set({ playlists });
  },
  flush: () => libraryFile.flush(),
};

module.exports = { settings, history, library, sameMedia };
