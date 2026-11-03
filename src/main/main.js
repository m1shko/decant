const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const ytdlp = require('./ytdlp');
const binaries = require('./binaries');
const { settings, history, library } = require('./store');
const { Queue } = require('./queue');

// The player reads library files through decant-media://<id>/media (and
// /cover, /subs/<lang>). Subtitle tracks are fetched with CORS, hence corsEnabled.
protocol.registerSchemesAsPrivileged([
  { scheme: 'decant-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

const DAY = 24 * 60 * 60 * 1000;
let win = null;

function outputDir() {
  const dir = settings.get().outputDir;
  return dir && fs.existsSync(dir) ? dir : app.getPath('downloads');
}

function engineEnv() {
  const runtime = binaries.jsRuntime();
  return {
    bin: binaries.ytdlpPath(),
    ffmpegDir: binaries.ffmpegDir(),
    cookiesBrowser: settings.get().cookiesBrowser || null,
    extraArgs: runtime.args,
    extraEnv: runtime.env,
  };
}

const queue = new Queue({ getEnv: engineEnv, concurrency: 2 });

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

queue.on('update', (job) => send('queue:update', job));
queue.on('removed', (id) => send('queue:removed', id));
queue.on('done', (job) => {
  if (job.library) {
    addToLibrary(job);
    return;
  }
  history.add({
    id: job.id,
    title: job.title,
    url: job.url,
    thumbnail: job.thumbnail,
    kind: job.kind,
    format: job.format,
    quality: job.quality,
    filePath: job.filePath,
    date: Date.now(),
  });
  send('history:update', history.list());
});

// Subtitle languages to fetch: the system's, then English.
function subtitleLanguages() {
  const langs = [...app.getPreferredSystemLanguages(), 'en'].map((l) => l.split('-')[0].toLowerCase());
  return [...new Set(langs)].slice(0, 3);
}

// Chapters are timed against the whole video: shift them to fit a clip.
function clipChapters(chapters = [], trim) {
  if (!trim) return chapters;
  const start = Number(trim.start) || 0;
  const end = trim.end == null ? Infinity : Number(trim.end);
  return chapters
    .filter((c) => (c.end ?? Infinity) > start && c.start < end)
    .map((c) => ({ ...c, start: Math.max(0, c.start - start), end: c.end == null ? null : Math.min(c.end, end) - start }));
}

function addToLibrary(job) {
  const dir = library.dir(job.libraryId);
  const file = job.filePath && path.basename(job.filePath);
  let size = 0;
  let names = [];
  try {
    size = fs.statSync(path.join(dir, file)).size;
    names = fs.readdirSync(dir);
  } catch {}
  const subtitles = names
    .map((name) => /^subs\.(.+)\.vtt$/.exec(name))
    .filter(Boolean)
    .map(([name, lang]) => ({ lang, file: name }));
  library.add({
    id: job.libraryId,
    url: job.url,
    title: job.title,
    uploader: job.uploader || null,
    duration: job.duration ?? null,
    thumbnail: job.thumbnail,
    kind: job.kind,
    format: job.format,
    quality: job.quality,
    trim: job.trim || null,
    file,
    cover: names.includes('cover.jpg') ? 'cover.jpg' : null,
    chapters: clipChapters(job.chapters, job.trim),
    subtitles,
    size,
    date: Date.now(),
    position: 0,
  });
  send('library:update', library.list());
}

const MIME = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  jpg: 'image/jpeg',
  vtt: 'text/vtt',
};

// Serves library files with byte ranges, which the player needs to seek.
// Only files the library knows about can be reached.
function serveLibrary(request) {
  const { host: id, pathname } = new URL(request.url);
  const item = library.get(id);
  const name = !item
    ? null
    : pathname.startsWith('/subs/')
      ? item.subtitles?.find((s) => s.lang === pathname.slice('/subs/'.length))?.file
      : { '/media': item.file, '/cover': item.cover }[pathname];
  if (!name) return new Response(null, { status: 404 });
  const file = path.join(library.dir(id), name);
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return new Response(null, { status: 404 });
  }
  const headers = {
    'Content-Type': MIME[path.extname(file).slice(1)] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  if (!range) {
    return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { ...headers, 'Content-Length': String(size) } });
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
  });
}

async function exportLibraryItem(id) {
  const item = library.get(id);
  if (!item) return null;
  const ext = path.extname(item.file);
  const base = item.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 150).trim() || 'video';
  const result = await dialog.showSaveDialog(win, {
    title: 'Save a copy',
    defaultPath: path.join(outputDir(), `${base}${ext}`),
  });
  if (result.canceled || !result.filePath) return null;
  await fs.promises.copyFile(path.join(library.dir(id), item.file), result.filePath);
  return result.filePath;
}

async function probe(_event, input, { playlist = false, search = false } = {}) {
  const env = engineEnv();
  const args = [...env.extraArgs, ...ytdlp.probeArgs(input, { playlist, search, ...env })];
  const { code, stdout, stderr } = await ytdlp.run(env.bin, args, { env: env.extraEnv }).done;
  if (code !== 0) throw new Error(ytdlp.friendlyError(stderr, input));
  const info = ytdlp.summarizeInfo(JSON.parse(stdout));
  if (info.type === 'playlist' && !info.entries.length) throw new Error('No videos found.');
  return info;
}

// Keeps yt-dlp fresh: sites change often and old versions stop working.
async function autoUpdateEngine() {
  if (Date.now() - settings.get().lastEngineUpdate < DAY) return;
  try {
    const version = await binaries.update();
    settings.set({ lastEngineUpdate: Date.now() });
    send('engine:version', version);
  } catch (err) {
    console.warn('[decant] could not update yt-dlp:', err.message);
  }
}

function registerIpc() {
  ipcMain.handle('probe', probe);

  ipcMain.handle('settings:get', () => ({ ...settings.get(), outputDir: outputDir() }));
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch));

  ipcMain.handle('folder:choose', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Where should downloads go?',
      defaultPath: outputDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    settings.set({ outputDir: result.filePaths[0] });
    return result.filePaths[0];
  });
  ipcMain.handle('folder:open', () => shell.openPath(outputDir()));

  ipcMain.handle('queue:list', () => queue.list());
  ipcMain.handle('queue:add', (_e, specs) =>
    queue.add(
      specs.map((s) => {
        if (!s.library) return { ...s, outputDir: outputDir() };
        const libraryId = crypto.randomUUID();
        return { ...s, libraryId, outputDir: library.dir(libraryId), subtitles: subtitleLanguages() };
      }),
    ),
  );
  ipcMain.handle('queue:cancel', (_e, id) => queue.cancel(id));
  ipcMain.handle('queue:retry', (_e, id) => queue.retry(id));
  ipcMain.handle('queue:remove', (_e, id) => queue.remove(id));
  ipcMain.handle('queue:clear', () => queue.clearFinished());

  ipcMain.handle('history:list', () => history.list());
  ipcMain.handle('history:remove', (_e, id) => {
    history.remove(id);
    return history.list();
  });
  ipcMain.handle('history:clear', () => {
    history.clear();
    return [];
  });

  ipcMain.handle('library:list', () => library.list());
  ipcMain.handle('library:remove', (_e, id) => {
    library.remove(id);
    return library.list();
  });
  ipcMain.handle('library:progress', (_e, id, patch) => {
    const { position, duration } = patch;
    library.update(id, {
      position: Number.isFinite(position) ? position : 0,
      ...(Number.isFinite(duration) ? { duration } : {}),
      watched: Date.now(),
    });
  });
  ipcMain.handle('library:export', (_e, id) => exportLibraryItem(id));

  ipcMain.handle('file:exists', (_e, file) => Boolean(file) && fs.existsSync(file));
  ipcMain.handle('file:reveal', (_e, file) => {
    if (file && fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(outputDir());
  });
  ipcMain.handle('file:open', (_e, file) => file && shell.openPath(file));
  ipcMain.handle('link:open', (_e, url) => /^https?:\/\//.test(url) && shell.openExternal(url));

  ipcMain.handle('clipboard:read', () => clipboard.readText());

  ipcMain.handle('engine:version', () => binaries.version().catch(() => null));
  ipcMain.handle('engine:update', async () => {
    const version = await binaries.update();
    settings.set({ lastEngineUpdate: Date.now() });
    return version;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    title: 'Decant',
    backgroundColor: '#111114',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  library.prune();
  protocol.handle('decant-media', serveLibrary);
  registerIpc();
  createWindow();
  autoUpdateEngine();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => library.flush());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
