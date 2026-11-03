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
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    }, 200);
  };
  return {
    get: () => data,
    set(patch) {
      Object.assign(data, patch);
      save();
      return data;
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

module.exports = { settings, history };
