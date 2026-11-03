const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('decant', {
  platform: process.platform,
  probe: invoke('probe'),
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  folder: { choose: invoke('folder:choose'), open: invoke('folder:open') },
  queue: {
    list: invoke('queue:list'),
    add: invoke('queue:add'),
    cancel: invoke('queue:cancel'),
    retry: invoke('queue:retry'),
    remove: invoke('queue:remove'),
    clear: invoke('queue:clear'),
    onUpdate: listen('queue:update'),
    onRemoved: listen('queue:removed'),
  },
  history: {
    list: invoke('history:list'),
    remove: invoke('history:remove'),
    clear: invoke('history:clear'),
    onUpdate: listen('history:update'),
  },
  library: {
    list: invoke('library:list'),
    remove: invoke('library:remove'),
    progress: invoke('library:progress'),
    export: invoke('library:export'),
    refresh: invoke('library:refresh'),
    removeFromPlaylist: invoke('library:removeFromPlaylist'),
    removePlaylist: invoke('library:removePlaylist'),
    onUpdate: listen('library:update'),
  },
  file: { exists: invoke('file:exists'), reveal: invoke('file:reveal'), open: invoke('file:open') },
  openLink: invoke('link:open'),
  pip: { fit: invoke('pip:fit') },
  focusWindow: invoke('window:focus'),
  readClipboard: invoke('clipboard:read'),
  engine: { version: invoke('engine:version'), update: invoke('engine:update'), onVersion: listen('engine:version') },
});
