const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const ytdlp = require('./ytdlp');
const binaries = require('./binaries');
const { settings, history } = require('./store');
const { Queue } = require('./queue');

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
  ipcMain.handle('queue:add', (_e, specs) => queue.add(specs.map((s) => ({ ...s, outputDir: outputDir() }))));
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
  registerIpc();
  createWindow();
  autoUpdateEngine();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
