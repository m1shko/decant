const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, protocol, screen, net } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const ytdlp = require('./ytdlp');
const binaries = require('./binaries');
const { settings, history, library, sameMedia } = require('./store');
const i18n = require('../renderer/i18n.js');
const { t } = i18n;
const { Queue } = require('./queue');
const links = require('./links');
const cleanup = require('./cleanup');
const updates = require('./updates');
const extension = require('./extension');

// One Decant at a time: a decant:// link opened while it runs goes to the
// window already open (see 'second-instance').
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

// The player reads library files through decant-media://<id>/media (and
// /cover, /subs/<lang>). Subtitle tracks are fetched with CORS, hence corsEnabled.
protocol.registerSchemesAsPrivileged([
  { scheme: 'decant-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

const DAY = 24 * 60 * 60 * 1000;
const PIP_NAME = 'decant-pip';
let win = null;
let pipWin = null;

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
    key: job.key || null,
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
    description: job.description || '',
    chapters: clipChapters(job.chapters, job.trim),
    subtitles,
    size,
    date: Date.now(),
    position: 0,
  });
  send('library:update', library.snapshot());
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

// The name a library item gets once copied out of the library.
function exportName(item) {
  const base = item.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 150).trim() || 'video';
  return `${base}${path.extname(item.file)}`;
}

async function exportLibraryItem(id) {
  const item = library.get(id);
  if (!item) return null;
  const result = await dialog.showSaveDialog(win, {
    title: t('Save a copy'),
    defaultPath: path.join(outputDir(), exportName(item)),
  });
  if (result.canceled || !result.filePath) return null;
  await fs.promises.copyFile(path.join(library.dir(id), item.file), result.filePath);
  return result.filePath;
}

// Copies several items into a folder, without replacing files already there,
// then shows the folder.
async function exportLibraryItems(ids) {
  const result = await dialog.showOpenDialog(win, {
    title: t('Save copies to…'),
    defaultPath: outputDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  const dir = result.filePaths?.[0];
  if (result.canceled || !dir) return 0;
  let count = 0;
  for (const id of ids) {
    const item = library.get(id);
    if (!item) continue;
    const { name, ext } = path.parse(exportName(item));
    let target = path.join(dir, `${name}${ext}`);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${name} (${n})${ext}`);
    await fs.promises.copyFile(path.join(library.dir(id), item.file), target);
    count++;
  }
  shell.openPath(dir);
  return count;
}

async function probe(_event, input, { playlist = false, search = false } = {}) {
  const env = engineEnv();
  const args = [...env.extraArgs, ...ytdlp.probeArgs(input, { playlist, search, ...env })];
  const { code, stdout, stderr } = await ytdlp.run(env.bin, args, { env: env.extraEnv }).done;
  if (code !== 0) throw new Error(ytdlp.friendlyError(stderr, input));
  const info = ytdlp.summarizeInfo(JSON.parse(stdout));
  if (info.type === 'playlist' && !info.entries.length) throw new Error(t('No videos found.'));
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
  ipcMain.handle('settings:set', (_e, patch) => {
    if ('language' in patch) i18n.setLanguage(patch.language, app.getLocale());
    const saved = settings.set(patch);
    if (['autoCleanup', 'cleanupDelayDays', 'cleanupAudio'].some((key) => key in patch)) runCleanup();
    return saved;
  });

  ipcMain.handle('folder:choose', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('Where should downloads go?'),
      defaultPath: outputDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    settings.set({ outputDir: result.filePaths[0] });
    return result.filePaths[0];
  });
  ipcMain.handle('folder:open', () => shell.openPath(outputDir()));

  ipcMain.handle('queue:list', () => queue.list());
  ipcMain.handle('queue:add', (_e, specs, { playlist } = {}) => {
    const target = playlist ? library.savePlaylist(playlist) : null;
    const fresh = [];
    let existing = 0;
    for (const spec of specs) {
      if (!spec.library) {
        fresh.push({ ...spec, outputDir: outputDir() });
        continue;
      }
      // Already in the library, or on its way there: no second download.
      const job = queue.list().find((j) => j.library && !['error', 'canceled'].includes(j.status) && sameMedia(j, spec));
      const libraryId = library.find(spec)?.id || job?.libraryId;
      if (libraryId) {
        existing++;
        if (target) library.addToPlaylist(target.id, libraryId, spec.playlistIndex ?? 0);
        continue;
      }
      const id = crypto.randomUUID();
      if (target) library.addToPlaylist(target.id, id, spec.playlistIndex ?? 0);
      fresh.push({ ...spec, libraryId: id, outputDir: library.dir(id), subtitles: subtitleLanguages() });
    }
    if (fresh.length) queue.add(fresh);
    if (target) send('library:update', library.snapshot());
    return { added: fresh.length, existing, playlistId: target?.id || null };
  });
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

  ipcMain.handle('library:list', () => library.snapshot());
  ipcMain.handle('library:remove', (_e, ids) => {
    for (const id of [ids].flat()) library.remove(id);
    return library.snapshot();
  });
  ipcMain.handle('library:removeFromPlaylist', (_e, playlistId, id) => {
    library.removeFromPlaylist(playlistId, id);
    return library.snapshot();
  });
  ipcMain.handle('library:removePlaylist', (_e, playlistId) => {
    library.removePlaylist(playlistId);
    return library.snapshot();
  });
  ipcMain.handle('library:progress', (_e, id, patch) => {
    const { position, duration, ended } = patch;
    const item = library.get(id);
    if (!item) return;
    const length = Number.isFinite(duration) ? duration : item.duration;
    // Watched to the end: remembered, since the player then goes back to 0.
    const finished = !item.finishedAt && (ended || cleanup.isFinished(position, length));
    library.update(id, {
      position: Number.isFinite(position) ? position : 0,
      ...(Number.isFinite(duration) ? { duration } : {}),
      ...(finished ? { finishedAt: Date.now() } : {}),
      watched: Date.now(),
    });
    if (finished) runCleanup();
  });
  ipcMain.handle('library:playing', (_e, id) => {
    playingId = id || null;
  });
  // Back from "To delete": videos, or a playlist with its videos.
  ipcMain.handle('library:restore', (_e, { items = [], playlists = [] } = {}) => {
    const { items: all, playlists: lists } = library.snapshot();
    const back = new Set([...items, ...all.filter((i) => playlists.includes(i.trashedWith)).map((i) => i.id)]);
    library.replace({
      items: all.map((i) => (back.has(i.id) ? cleanup.restoreItem(i) : i)),
      playlists: lists.map((p) => (playlists.includes(p.id) ? cleanup.clean(p) : p)),
    });
    return library.snapshot();
  });
  ipcMain.handle('library:keep', (_e, id, keep) => {
    const item = library.get(id);
    if (item) library.update(id, keep ? { ...cleanup.clean(item), keep: true } : { keep: false });
    runCleanup();
    return library.snapshot();
  });
  // "Delete now" from "To delete": the videos, and playlists with theirs.
  ipcMain.handle('library:deleteNow', (_e, { items = [], playlists = [] } = {}) => {
    const { items: all, playlists: lists } = library.snapshot();
    const gone = new Set([...items, ...all.filter((i) => playlists.includes(i.trashedWith)).map((i) => i.id)]);
    library.replace(
      {
        items: all.filter((i) => !gone.has(i.id)),
        playlists: lists.filter((p) => !playlists.includes(p.id)).map((p) => ({ ...p, entries: p.entries.filter((e) => !gone.has(e.id)) })),
      },
      [...gone],
    );
    return library.snapshot();
  });
  ipcMain.handle('library:export', (_e, id) => exportLibraryItem(id));
  ipcMain.handle('library:exportMany', (_e, ids) => exportLibraryItems(ids));
  // Fills in what items saved by older versions lack (needs the internet).
  ipcMain.handle('library:refresh', async (_e, id) => {
    const item = library.get(id);
    if (!item?.url) return null;
    const info = await probe(null, item.url);
    const patch = { description: info.description || '', key: item.key || info.key || null };
    if (!item.chapters) patch.chapters = clipChapters(info.chapters, item.trim);
    library.update(id, patch);
    return library.get(id);
  });

  ipcMain.handle('file:exists', (_e, file) => Boolean(file) && fs.existsSync(file));
  ipcMain.handle('file:reveal', (_e, file) => {
    if (file && fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(outputDir());
  });
  ipcMain.handle('file:open', (_e, file) => file && shell.openPath(file));
  ipcMain.handle('link:open', (_e, url) => /^https?:\/\//.test(url) && shell.openExternal(url));

  ipcMain.handle('clipboard:read', () => clipboard.readText());

  ipcMain.handle('pip:fit', (_e, ratio) => fitPip(ratio));
  ipcMain.on('pip:drag', (_e, phase) => dragPip(phase));
  ipcMain.handle('window:focus', focusWindow);
  ipcMain.handle('links:ready', () => {
    linksReady = true;
    return pendingLinks.splice(0);
  });

  ipcMain.handle('update:get', () => ({ current: app.getVersion(), update }));
  ipcMain.handle('update:check', async () => ({ current: app.getVersion(), update: await checkForUpdate() }));
  ipcMain.handle('update:download', () => downloadUpdate());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('update:page', () => update?.page && shell.openExternal(update.page));

  ipcMain.handle('extension:info', () => ({ folder: extensionFolder(), ...extensionState }));
  ipcMain.handle('extension:reveal', () => shell.openPath(extensionFolder()));
  ipcMain.handle('extension:copyPath', () => clipboard.writeText(extensionFolder()));

  ipcMain.handle('engine:version', () => binaries.version().catch(() => null));
  ipcMain.handle('engine:update', async () => {
    const version = await binaries.update();
    settings.set({ lastEngineUpdate: Date.now() });
    return version;
  });
}

// --- Auto cleanup ---------------------------------------------------------------
// Runs at launch, every hour, and when a video ends or the settings change.

let playingId = null;

function runCleanup() {
  const result = cleanup.sweep(library.snapshot(), settings.get(), Date.now(), { playing: playingId });
  if (!result.changed) return;
  library.replace(result, result.deleted);
  send('library:update', library.snapshot());
}

// --- New versions of Decant -----------------------------------------------------
// Checked at launch (unless turned off in the settings), then once a day, or
// when asked from the settings. "Update" downloads the new version next to
// the old one; "Restart" puts it in place and opens it (see updates.js).

let update = null;

// The .app bundle Decant runs from, on macOS.
const macBundle = () => path.resolve(process.execPath, '..', '..', '..');

// macOS: Decant can replace itself only where it may write, and not from the
// disk image or a quarantined copy that macOS moved aside ("App Translocation").
function canReplaceSelf() {
  if (process.platform !== 'darwin') return true;
  const bundle = macBundle();
  if (!bundle.endsWith('.app') || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return false;
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    fs.accessSync(bundle, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function updateSystem() {
  const kind = updates.updateKind({
    platform: process.platform,
    packaged: app.isPackaged,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    appImage: Boolean(process.env.APPIMAGE),
    canReplace: canReplaceSelf(),
  });
  return { kind, arch: process.arch };
}

function setUpdate(patch) {
  update = { ...update, ...patch };
  send('update:state', update);
}

async function checkForUpdate() {
  const found = await updates.check({ current: app.getVersion(), fetch: net.fetch, system: updateSystem() });
  if (!found) return null;
  // Already known (maybe downloading): left as it is.
  if (update?.version !== found.version) update = { ...found, status: 'available', percent: 0, file: null, error: null };
  send('update:state', update);
  return update;
}

function autoCheckForUpdate() {
  if (settings.get().checkUpdates === false) return;
  checkForUpdate().catch((err) => console.warn('[decant] could not check for updates:', err.message));
}

const updateDir = () => path.join(app.getPath('temp'), 'decant-update');

async function fetchTo(url, file, expected) {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || expected || 0;
  const out = fs.createWriteStream(file);
  try {
    const reader = res.body.getReader();
    let received = 0;
    let shown = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(value)) await new Promise((resolve) => out.once('drain', resolve));
      received += value.length;
      const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : 0;
      if (percent !== shown) setUpdate({ percent: (shown = percent) });
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    if (total && received !== total) throw new Error(t('The download was cut off.'));
  } catch (err) {
    out.destroy();
    throw err;
  }
}

function execFileAsync(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout))));
}

// Downloads the new version and gets it ready to be put in place.
async function downloadUpdate() {
  if (!update) return null;
  if (update.kind === 'manual' || !update.asset) {
    shell.openExternal(update.page);
    return update;
  }
  if (update.status === 'downloading' || update.status === 'ready') return update;
  setUpdate({ status: 'downloading', percent: 0, error: null });
  const dir = updateDir();
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, update.asset.name);
    await fetchTo(update.asset.url, file, update.asset.size);
    let ready = file;
    if (update.kind === 'mac-zip') {
      // ditto keeps the app's signature and symlinks intact.
      const out = path.join(dir, 'app');
      await execFileAsync('/usr/bin/ditto', ['-x', '-k', file, out]);
      const name = (await fs.promises.readdir(out)).find((n) => n.endsWith('.app'));
      if (!name) throw new Error(t('The download is not a Decant app.'));
      ready = path.join(out, name);
      await execFileAsync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', ready]).catch(() => {});
    } else if (process.platform !== 'win32') {
      await fs.promises.chmod(file, 0o755);
    }
    setUpdate({ status: 'ready', percent: 100, file: ready });
  } catch (err) {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    setUpdate({ status: 'error', error: err.message });
  }
  return update;
}

// Keeps running once Decant has quit.
function runDetached(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

// Waits for Decant to quit, puts the new version in place and opens it. The
// old version stays if the new one cannot be moved in.
const MAC_SWAP = `
pid="$1"; new="$2"; app="$3"; dir="$4"
while kill -0 "$pid" 2>/dev/null; do sleep 0.3; done
old="$app.old-$$"
if mv "$app" "$old"; then
  if mv "$new" "$app"; then rm -rf "$old"; else mv "$old" "$app"; fi
fi
rm -rf "$dir"
open "$app"
`;

const WIN_SWAP = [
  '@echo off',
  'set tries=0',
  ':retry',
  'timeout /t 1 /nobreak >nul',
  'set /a tries+=1',
  'move /y "%~1" "%~2" >nul 2>&1 && goto done',
  'if %tries% lss 30 goto retry',
  ':done',
  'start "" "%~2"',
  '(goto) 2>nul & del "%~f0"',
  '',
].join('\r\n');

// Puts the downloaded version in place and restarts Decant.
async function installUpdate() {
  if (update?.status !== 'ready' || !fs.existsSync(update.file)) return false;
  const { kind, file } = update;
  if (kind === 'mac-zip') {
    runDetached('/bin/sh', ['-c', MAC_SWAP, 'sh', String(process.pid), file, macBundle(), updateDir()]);
  } else if (kind === 'win-setup') {
    // The installer replaces the app where it is installed, then opens it.
    runDetached(file, ['/S', '--updated', '--force-run']);
  } else if (kind === 'win-portable') {
    const script = path.join(updateDir(), 'swap.cmd');
    await fs.promises.writeFile(script, WIN_SWAP);
    runDetached('cmd.exe', ['/d', '/c', script, file, process.env.PORTABLE_EXECUTABLE_FILE]);
  } else if (kind === 'appimage') {
    // Linux lets a running file be replaced.
    const target = process.env.APPIMAGE;
    await fs.promises.copyFile(file, `${target}.new`);
    await fs.promises.chmod(`${target}.new`, 0o755);
    await fs.promises.rename(`${target}.new`, target);
    app.relaunch({ execPath: target, args: [] });
  } else if (kind === 'deb') {
    try {
      // Asks for the password in a system window.
      await execFileAsync('pkexec', ['dpkg', '-i', file]);
    } catch (err) {
      setUpdate({ status: 'error', error: err.code === 'ENOENT' ? t('pkexec is missing: install the .deb yourself.') : t('The update was not installed.') });
      return false;
    }
    app.relaunch();
  } else {
    return false;
  }
  setTimeout(() => app.quit(), 300);
  return true;
}

// --- The browser extension ------------------------------------------------------
// Kept in Decant's data folder and refreshed at launch when this version of
// Decant ships a different one: the browser loads it from there.

const extensionFolder = () => path.join(app.getPath('userData'), extension.FOLDER_NAME);
const extensionSource = () => (app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, '..', '..', 'extension'));
let extensionState = { error: null };

function syncExtension() {
  try {
    extension.sync({ source: extensionSource(), target: extensionFolder(), version: app.getVersion() });
    extensionState = { error: null };
  } catch (err) {
    extensionState = { error: err.message };
    console.warn('[decant] could not refresh the browser extension:', err.message);
  }
}

function focusWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
}

// --- decant:// links ----------------------------------------------------------
// Links that arrive before the interface is listening wait in pendingLinks.

let pendingLinks = [];
let linksReady = false;

function receiveLink(raw) {
  const link = links.parseDecantUrl(raw);
  if (!link) return;
  if (linksReady && win && !win.isDestroyed()) send('link:incoming', link);
  else pendingLinks.push(link);
  if (!app.isReady()) return;
  if (!win || win.isDestroyed()) createWindow();
  // Saving happens in the background: only "open" needs the window.
  else if (link.action === 'open') focusWindow();
}

// macOS hands links over with an event, also while launching.
app.on('open-url', (event, url) => {
  event.preventDefault();
  receiveLink(url);
});

// Windows and Linux start a second Decant with the link as an argument.
app.on('second-instance', (_event, argv) => {
  const raw = links.findDecantUrl(argv);
  if (raw) receiveLink(raw);
  else if (!win || win.isDestroyed()) createWindow();
  else focusWindow();
});

// The installed app answers decant:// links. macOS and the Linux .deb learn it
// from the package (see "protocols" in package.json); Windows from this call.
// Not from `npm start`, which would take the links from an installed Decant.
function registerLinkHandler() {
  if (process.defaultApp) return;
  app.setAsDefaultProtocolClient(links.SCHEME);
  if (process.platform === 'linux' && process.env.APPIMAGE) registerAppImageLinkHandler(process.env.APPIMAGE);
}

// An AppImage is not installed: tell the desktop which file opens decant:// links.
function registerAppImageLinkHandler(appImage) {
  const dir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications');
  const name = 'decant-url-handler.desktop';
  const exec = `"${appImage.replace(/["`$\\]/g, '\\$&')}" %u`;
  const entry = ['[Desktop Entry]', 'Type=Application', 'Name=Decant', `Exec=${exec}`, 'NoDisplay=true', 'MimeType=x-scheme-handler/decant;', ''].join('\n');
  try {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === entry) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, entry);
    execFile('xdg-mime', ['default', name, 'x-scheme-handler/decant'], () => {});
  } catch (err) {
    console.warn('[decant] could not register decant:// links:', err.message);
  }
}

// The picture-in-picture window: a small frameless window the player opens
// with window.open() and moves its video into. It floats above other apps
// (full-screen ones too on a Mac) without taking the focus from them.
function pipBounds() {
  const saved = settings.get().pipBounds;
  const onScreen = (b) =>
    screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
  if (saved && onScreen(saved)) return saved;
  const area = screen.getPrimaryDisplay().workArea;
  const width = 400;
  const height = 225;
  return { width, height, x: area.x + area.width - width - 24, y: area.y + area.height - height - 24 };
}

function pipOptions() {
  return {
    ...pipBounds(),
    title: 'Decant',
    frame: false,
    show: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    minWidth: 200,
    minHeight: 112,
    backgroundColor: '#000000',
    // A non-activating panel on macOS: on every Space, over full-screen apps.
    type: process.platform === 'darwin' ? 'panel' : 'toolbar',
  };
}

// A window that is not in front may not learn that the pointer left it, so
// that is watched from here.
function watchPipPointer(child) {
  let inside = false;
  const timer = setInterval(() => {
    if (child.isDestroyed()) return clearInterval(timer);
    const p = screen.getCursorScreenPoint();
    const b = child.getBounds();
    const over = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (!over && inside) send('pip:pointer', 'leave');
    inside = over;
  }, 100);
  child.on('closed', () => clearInterval(timer));
}

function setupPip(child) {
  pipWin = child;
  watchPipPointer(child);
  child.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') child.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  child.showInactive();
  const remember = () => !child.isDestroyed() && settings.set({ pipBounds: child.getBounds() });
  child.on('moved', remember);
  child.on('resized', remember);
  child.on('closed', () => {
    if (pipWin === child) pipWin = null;
  });
}

// The page moves the window itself: a drag region would keep clicks from it.
// It follows the pointer as the screen sees it, not as the moving page does.
let pipDragFrom = null;
function dragPip(phase) {
  if (!pipWin || pipWin.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  if (phase === 'start') {
    const [x, y] = pipWin.getPosition();
    pipDragFrom = { x: x - p.x, y: y - p.y };
  } else if (phase === 'move' && pipDragFrom) pipWin.setPosition(p.x + pipDragFrom.x, p.y + pipDragFrom.y);
  else if (phase === 'end') {
    pipDragFrom = null;
    settings.set({ pipBounds: pipWin.getBounds() });
  }
}

// Fits the window to the video: same long side, bottom-right corner kept.
function fitPip(ratio) {
  if (!pipWin || pipWin.isDestroyed() || !(ratio > 0)) return;
  const b = pipWin.getBounds();
  const long = Math.max(b.width, b.height);
  const width = Math.round(ratio >= 1 ? long : long * ratio);
  const height = Math.round(ratio >= 1 ? long / ratio : long);
  pipWin.setAspectRatio(ratio);
  pipWin.setBounds({ x: b.x + b.width - width, y: b.y + b.height - height, width, height });
}

function createWindow() {
  linksReady = false;
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
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === PIP_NAME && url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: pipOptions() };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child, { frameName }) => {
    if (frameName === PIP_NAME) setupPip(child);
  });
  win.webContents.on('did-start-loading', () => (linksReady = false));
  win.on('closed', () => {
    linksReady = false;
    if (pipWin && !pipWin.isDestroyed()) pipWin.close();
  });
}

app.whenReady().then(() => {
  if (!singleInstance) return;
  i18n.setLanguage(settings.get().language, app.getLocale());
  library.prune();
  syncExtension();
  runCleanup();
  setInterval(runCleanup, 60 * 60 * 1000);
  protocol.handle('decant-media', serveLibrary);
  registerIpc();
  registerLinkHandler();
  const launchLink = links.parseDecantUrl(links.findDecantUrl(process.argv));
  if (launchLink) pendingLinks.push(launchLink);
  // A link opened on macOS right as Decant started may have opened it already.
  if (!win) createWindow();
  autoUpdateEngine();
  setTimeout(autoCheckForUpdate, 5000);
  setInterval(autoCheckForUpdate, DAY);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => library.flush());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
