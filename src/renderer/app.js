const api = window.decant;

const AUDIO_FORMATS = ['mp3', 'm4a', 'wav', 'flac'];
const MP3_BITRATES = ['320', '192', '128'];
const ALL_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];
// Links Decant fills in by itself when they show up in the clipboard.
const AUTO_PASTE = /^https?:\/\/([\w-]+\.)*(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|x\.com|twitter\.com|facebook\.com|fb\.watch|vimeo\.com|dailymotion\.com|twitch\.tv|soundcloud\.com)\//i;

const $ = (sel) => document.querySelector(sel);
const state = {
  settings: null,
  info: null,
  probedInput: null,
  jobs: new Map(),
  history: [],
  library: [],
  libraryFilter: 'all',
  librarySearch: '',
  lastClipboard: null,
};

// Builds DOM without innerHTML: titles come from the web.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  close: 'M6 6l12 12M18 6L6 18',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  play: 'M7 5v14l11-7z',
  retry: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  library: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 9v6l5-3z',
  export: 'M12 15V4M7 9l5-5 5 5M5 20h14',
  back: 'M15 5l-7 7 7 7',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

function iconButton(name, title, onclick) {
  return h('button', { class: 'icon-btn', title, 'aria-label': title, onclick }, icon(name));
}

function thumb(src, small = false) {
  return h('img', {
    class: small ? 'thumb small' : 'thumb',
    src: src || null,
    alt: '',
    referrerpolicy: 'no-referrer',
    onerror: (e) => e.target.removeAttribute('src'),
  });
}

function formatDuration(seconds) {
  if (seconds == null) return '';
  const s = Math.round(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

function parseTime(text) {
  const parts = String(text).trim().split(':');
  if (!text || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((t, p) => t * 60 + Number(p), 0);
}

function formatBytes(n) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${units[i]}`;
}

function formatLabel({ kind, format, quality }) {
  if (kind === 'audio') return format === 'mp3' ? `MP3 ${quality} kbps` : format.toUpperCase();
  return `MP4 ${quality === 'best' ? 'max' : `${quality}p`}`;
}

function sourceName(source) {
  if (!source) return null;
  return { Youtube: 'YouTube', YoutubeTab: 'YouTube', TikTok: 'TikTok', Instagram: 'Instagram', Twitter: 'X' }[source] || source;
}

// --- Notices ---------------------------------------------------------------

function notice(text, type = '') {
  const el = $('#notice');
  el.hidden = !text;
  el.className = `notice ${type}`;
  el.textContent = text || '';
}

// --- Probing a link or a search -------------------------------------------

function normalizeInput(raw) {
  const text = raw.trim();
  if (/^https?:\/\//i.test(text)) return { input: text, search: false };
  if (/^([\w-]+\.)+[a-z]{2,}\/\S*$/i.test(text)) return { input: `https://${text}`, search: false };
  return { input: text, search: true };
}

let probeToken = 0;

async function analyze(raw, { playlist = false } = {}) {
  const { input, search } = normalizeInput(raw);
  if (!input) return;
  const token = ++probeToken;
  state.info = null;
  state.probedInput = input;
  $('#preview').replaceChildren();
  $('#analyze-btn').disabled = true;
  notice(search ? `Searching for “${input}”…` : 'Reading the link…', 'loading');
  try {
    const info = await api.probe(input, { playlist, search });
    if (token !== probeToken) return;
    notice('');
    state.info = { ...info, isSearch: search, canExpand: info.type === 'video' && !playlist && /[?&]list=/.test(input) };
    // A new preview starts with no trim and every playlist entry selected.
    state.trim = { enabled: false, start: '', end: '' };
    state.selected = new Set(info.type === 'playlist' ? info.entries.map((_, i) => i) : []);
    renderPreview();
  } catch (err) {
    if (token !== probeToken) return;
    notice(cleanError(err), 'error');
  } finally {
    if (token === probeToken) $('#analyze-btn').disabled = false;
  }
}

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// --- Preview ----------------------------------------------------------------

function settingsFor(info) {
  const s = state.settings;
  const kind = info.type === 'video' && !info.hasVideo ? 'audio' : s.kind;
  return { kind, audioFormat: s.audioFormat, audioQuality: s.audioQuality, videoQuality: s.videoQuality };
}

function saveSetting(patch) {
  Object.assign(state.settings, patch);
  api.settings.set(patch);
  renderPreview();
}

function segmented(options, current, onPick) {
  return h(
    'div',
    { class: 'segmented' },
    options.map(([value, label, disabled]) =>
      h('button', { 'aria-pressed': String(value === current), disabled, onclick: () => onPick(value) }, label),
    ),
  );
}

function renderOptions(info, opts) {
  const rows = [];
  rows.push(
    h('span', { class: 'label' }, 'Type'),
    segmented(
      [
        ['audio', 'Audio'],
        ['video', 'Video', info.type === 'video' && !info.hasVideo],
      ],
      opts.kind,
      (kind) => saveSetting({ kind }),
    ),
  );

  if (opts.kind === 'audio') {
    rows.push(
      h('span', { class: 'label' }, 'Format'),
      segmented(
        AUDIO_FORMATS.map((f) => [f, f.toUpperCase()]),
        opts.audioFormat,
        (audioFormat) => saveSetting({ audioFormat }),
      ),
      h('span', { class: 'label' }, 'Quality'),
    );
    if (opts.audioFormat === 'mp3') {
      rows.push(
        segmented(
          MP3_BITRATES.map((b) => [b, `${b} kbps`]),
          opts.audioQuality,
          (audioQuality) => saveSetting({ audioQuality }),
        ),
      );
    } else {
      const hints = {
        m4a: 'Original audio (AAC), no re-encoding.',
        wav: 'Lossless, uncompressed (large file, no cover art).',
        flac: 'Lossless, compressed.',
      };
      rows.push(h('span', { class: 'hint' }, hints[opts.audioFormat]));
    }
  } else {
    const heights = info.type === 'video' ? info.heights : ALL_HEIGHTS;
    const quality = opts.videoQuality === 'best' || heights.includes(Number(opts.videoQuality)) ? opts.videoQuality : 'best';
    rows.push(
      h('span', { class: 'label' }, 'Format'),
      segmented([['mp4', 'MP4']], 'mp4', () => {}),
      h('span', { class: 'label' }, 'Quality'),
      h(
        'div',
        {},
        segmented(
          [['best', 'Best'], ...heights.map((x) => [String(x), x >= 2160 ? '4K' : x === 1440 ? '2K' : `${x}p`])],
          quality,
          (videoQuality) => saveSetting({ videoQuality }),
        ),
        Number(quality) > 1080 || (quality === 'best' && Math.max(...heights) > 1080)
          ? h('div', { class: 'hint' }, 'Above 1080p the video is VP9/AV1: plays in VLC or IINA, and in QuickTime on recent Macs.')
          : null,
      ),
    );
    opts.videoQuality = quality;
  }

  if (info.type === 'video' && info.duration) rows.push(h('span', { class: 'label' }, 'Clip'), renderTrim(info));
  return h('div', { class: 'options' }, rows);
}

function renderTrim(info) {
  const trim = state.trim;
  const toggle = h('input', {
    type: 'checkbox',
    checked: trim.enabled,
    onchange: (e) => {
      trim.enabled = e.target.checked;
      renderPreview();
    },
  });
  const field = (key, placeholder) =>
    h('input', {
      type: 'text',
      value: trim[key],
      placeholder,
      'aria-label': key === 'start' ? 'Start' : 'End',
      class: trim[key] && parseTime(trim[key]) == null ? 'invalid' : null,
      oninput: (e) => {
        trim[key] = e.target.value;
        e.target.classList.toggle('invalid', Boolean(e.target.value) && parseTime(e.target.value) == null);
        updateDownloadButton();
      },
    });
  return h(
    'div',
    { class: 'trim' },
    h('label', { class: 'toggle' }, toggle, 'Only part of it'),
    trim.enabled ? [h('span', { class: 'hint' }, 'from'), field('start', '0:00'), h('span', { class: 'hint' }, 'to'), field('end', formatDuration(info.duration))] : null,
  );
}

function trimValue() {
  const trim = state.trim;
  if (!trim.enabled) return null;
  const start = parseTime(trim.start || '0');
  const end = trim.end ? parseTime(trim.end) : null;
  if (start == null || (trim.end && end == null) || (end != null && end <= start)) return undefined;
  return { start: String(start), end: end == null ? null : String(end) };
}

function jobOptions(info) {
  const opts = settingsFor(info);
  if (opts.kind === 'audio') {
    return { kind: 'audio', format: opts.audioFormat, quality: opts.audioFormat === 'mp3' ? opts.audioQuality : null };
  }
  const heights = info.type === 'video' ? info.heights : ALL_HEIGHTS;
  const quality = opts.videoQuality === 'best' || heights.includes(Number(opts.videoQuality)) ? opts.videoQuality : 'best';
  return { kind: 'video', format: 'mp4', quality };
}

function updateDownloadButton() {
  const btn = $('#download-btn');
  const libraryBtn = $('#library-btn');
  if (!btn) return;
  const info = state.info;
  if (info.type === 'video') {
    const trim = trimValue();
    btn.disabled = libraryBtn.disabled = trim === undefined;
    btn.lastChild.textContent = `Download · ${formatLabel(jobOptions(info))}`;
    libraryBtn.lastChild.textContent = 'Save to library';
  } else {
    const count = state.selected.size;
    btn.disabled = libraryBtn.disabled = count === 0;
    btn.lastChild.textContent = `Add ${count} item${count === 1 ? '' : 's'} · ${formatLabel(jobOptions(info))}`;
    libraryBtn.lastChild.textContent = `Save ${count} to library`;
  }
}

function renderPreview() {
  const info = state.info;
  const root = $('#preview');
  if (!info) return root.replaceChildren();
  if (info.isSearch) return root.replaceChildren(renderSearch(info));

  const opts = settingsFor(info);
  const isPlaylist = info.type === 'playlist';
  const meta = isPlaylist
    ? [`${info.entries.length} item${info.entries.length === 1 ? '' : 's'}`, info.uploader].filter(Boolean).join(' · ')
    : [info.uploader, formatDuration(info.duration)].filter(Boolean).join(' · ');

  const card = h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'media' },
      thumb(isPlaylist ? info.entries[0]?.thumbnail : info.thumbnail),
      h(
        'div',
        { class: 'media-text' },
        sourceName(info.source) ? h('span', { class: 'chip-source' }, isPlaylist ? `${sourceName(info.source)} playlist` : sourceName(info.source)) : null,
        h('div', { class: 'media-title', title: info.title }, info.title),
        h('div', { class: 'muted' }, meta),
        info.canExpand
          ? h('button', { class: 'link', onclick: () => analyze(state.probedInput, { playlist: true }) }, 'This link is part of a playlist: show all of it')
          : null,
      ),
    ),
    isPlaylist ? renderEntries(info) : null,
    renderOptions(info, opts),
    h(
      'div',
      { class: 'card-actions' },
      h('button', { class: 'btn large', id: 'library-btn', onclick: () => enqueue({ library: true }) }, icon('library'), h('span', {}, '')),
      h('button', { class: 'btn large primary', id: 'download-btn', onclick: () => enqueue() }, icon('download'), h('span', {}, '')),
    ),
  );
  root.replaceChildren(card);
  updateDownloadButton();
}

function renderEntries(info) {
  const all = h('input', {
    type: 'checkbox',
    checked: state.selected.size === info.entries.length,
    onchange: (e) => {
      state.selected = new Set(e.target.checked ? info.entries.map((_, i) => i) : []);
      renderPreview();
    },
  });
  return h(
    'div',
    {},
    h('label', { class: 'toggle' }, all, 'Select all'),
    h(
      'ul',
      { class: 'entries' },
      info.entries.map((entry, i) =>
        h(
          'li',
          {},
          h('input', {
            type: 'checkbox',
            checked: state.selected.has(i),
            onchange: (e) => {
              if (e.target.checked) state.selected.add(i);
              else state.selected.delete(i);
              all.checked = state.selected.size === info.entries.length;
              updateDownloadButton();
            },
          }),
          h('span', { class: 'title', title: entry.title }, entry.title),
          h('span', { class: 'muted' }, formatDuration(entry.duration)),
        ),
      ),
    ),
  );
}

function renderSearch(info) {
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'muted' }, `YouTube results for “${state.probedInput}”`),
    h(
      'ul',
      { class: 'entries clickable' },
      info.entries.map((entry) =>
        h(
          'li',
          {
            onclick: () => {
              $('#url-input').value = entry.url;
              analyze(entry.url);
            },
          },
          thumb(entry.thumbnail, true),
          h('span', { class: 'title', title: entry.title }, entry.title),
          h('span', { class: 'muted' }, [entry.uploader, formatDuration(entry.duration)].filter(Boolean).join(' · ')),
        ),
      ),
    ),
  );
}

async function enqueue({ library = false } = {}) {
  const info = state.info;
  const opts = { ...jobOptions(info), library };
  let specs;
  if (info.type === 'video') {
    const trim = trimValue();
    if (trim === undefined) return;
    specs = [
      { ...opts, url: info.url || state.probedInput, title: info.title, uploader: info.uploader, duration: info.duration, thumbnail: info.thumbnail, trim },
    ];
  } else {
    specs = info.entries
      .filter((_, i) => state.selected.has(i))
      .map((e) => ({ ...opts, url: e.url, title: e.title, uploader: e.uploader, duration: e.duration, thumbnail: e.thumbnail, trim: null }));
  }
  await api.queue.add(specs);
  state.info = null;
  $('#url-input').value = '';
  renderPreview();
  if (library) notice(specs.length > 1 ? `${specs.length} items will show up in your library once downloaded.` : 'It will show up in your library once downloaded.');
  else notice(specs.length > 1 ? `${specs.length} items added to the queue.` : '');
  $('#url-input').focus();
}

// --- Queue ------------------------------------------------------------------

function jobStatus(job) {
  switch (job.status) {
    case 'queued':
      return 'Waiting';
    case 'downloading': {
      const parts = [`${Math.floor(job.percent || 0)}%`];
      if (job.speed) parts.push(`${formatBytes(job.speed)}/s`);
      if (job.eta != null) parts.push(`${formatDuration(job.eta)} left`);
      return parts.join(' · ');
    }
    case 'processing':
      return job.kind === 'audio' ? 'Converting…' : 'Finishing…';
    case 'done':
      return 'Done';
    case 'canceled':
      return 'Canceled';
    case 'error':
      return job.error || 'Error';
    default:
      return '';
  }
}

function renderJob(job) {
  const active = ['queued', 'downloading', 'processing'].includes(job.status);
  const actions = [];
  if (job.status === 'done' && job.library) {
    actions.push(iconButton('play', 'Play', () => playById(job.libraryId)));
  } else if (job.status === 'done') {
    actions.push(iconButton('play', 'Open', () => api.file.open(job.filePath)));
    actions.push(iconButton('folder', 'Show in folder', () => api.file.reveal(job.filePath)));
  }
  if (['error', 'canceled'].includes(job.status)) actions.push(iconButton('retry', 'Retry', () => api.queue.retry(job.id)));
  actions.push(
    active
      ? iconButton('close', 'Cancel', () => api.queue.cancel(job.id))
      : iconButton('close', 'Remove from list', () => api.queue.remove(job.id)),
  );

  return h(
    'li',
    { class: `row ${job.status}`, 'data-id': job.id },
    thumb(job.thumbnail, true),
    h(
      'div',
      { class: 'row-main' },
      h('div', { class: 'row-title', title: job.title }, job.title),
      h(
        'div',
        { class: 'row-sub' },
        h('span', { class: 'tag' }, formatLabel(job)),
        job.library ? h('span', { class: 'tag accent' }, 'Library') : null,
        job.trim ? h('span', {}, `${formatDuration(Number(job.trim.start))} → ${job.trim.end ? formatDuration(Number(job.trim.end)) : 'end'}`) : null,
        h('span', { class: 'status' }, jobStatus(job)),
      ),
      active ? h('div', { class: 'progress' }, h('div', { style: `width: ${job.percent || 0}%` })) : null,
    ),
    h('div', { class: 'row-actions' }, actions),
  );
}

function renderQueue() {
  const list = $('#queue-list');
  const jobs = [...state.jobs.values()];
  list.replaceChildren(...jobs.map(renderJob));
  $('#queue-empty').hidden = jobs.length > 0;
  $('#queue-clear').hidden = !jobs.some((j) => ['done', 'error', 'canceled'].includes(j.status));
}

// Progress events arrive many times a second: patch the row in place.
function updateJob(job) {
  const had = state.jobs.has(job.id);
  state.jobs.set(job.id, job);
  const row = document.querySelector(`.row[data-id="${job.id}"]`);
  if (had && row && row.classList.contains(job.status)) {
    row.querySelector('.status').textContent = jobStatus(job);
    const bar = row.querySelector('.progress > div');
    if (bar) bar.style.width = `${job.percent || 0}%`;
    return;
  }
  if (had && row) row.replaceWith(renderJob(job));
  else renderQueue();
  $('#queue-clear').hidden = ![...state.jobs.values()].some((j) => ['done', 'error', 'canceled'].includes(j.status));
}

// --- Library ----------------------------------------------------------------

const mediaUrl = (item) => `decant-media://${item.id}/media`;
const coverUrl = (item) => (item.cover ? `decant-media://${item.id}/cover` : item.thumbnail);

function libraryItems() {
  const query = state.librarySearch.trim().toLowerCase();
  return state.library.filter(
    (item) =>
      (state.libraryFilter === 'all' || item.kind === state.libraryFilter) &&
      (!query || `${item.title} ${item.uploader || ''}`.toLowerCase().includes(query)),
  );
}

function renderTile(item) {
  const progress = item.duration && item.position ? Math.min(100, (item.position / item.duration) * 100) : 0;
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };
  return h(
    'li',
    { class: 'tile', title: item.title, onclick: () => openPlayer(item) },
    h(
      'div',
      { class: 'tile-art' },
      thumb(coverUrl(item)),
      h('span', { class: 'tile-play' }, icon('play')),
      item.duration ? h('span', { class: 'badge' }, formatDuration(item.duration)) : null,
      progress ? h('div', { class: 'tile-progress' }, h('div', { style: `width: ${progress}%` })) : null,
    ),
    h(
      'div',
      { class: 'tile-body' },
      h(
        'div',
        { class: 'tile-text' },
        h('div', { class: 'tile-title' }, item.title),
        h('div', { class: 'row-sub' }, h('span', { class: 'tag' }, item.kind === 'audio' ? 'Audio' : 'Video'), item.uploader ? h('span', {}, item.uploader) : null),
      ),
      h(
        'div',
        { class: 'tile-actions' },
        iconButton('export', 'Save a copy…', stop(() => api.library.export(item.id))),
        iconButton(
          'trash',
          'Remove from library',
          stop(async () => {
            if (!confirm(`Remove “${item.title}” from your library? The file will be deleted.`)) return;
            state.library = await api.library.remove(item.id);
            renderLibrary();
          }),
        ),
      ),
    ),
  );
}

function renderLibrary() {
  const all = state.library;
  $('#library-count').textContent = all.length ? all.length : '';
  $('#library-filter').replaceChildren(
    segmented(
      [
        ['all', 'All'],
        ['video', 'Videos'],
        ['audio', 'Audio'],
      ],
      state.libraryFilter,
      (filter) => {
        state.libraryFilter = filter;
        renderLibrary();
      },
    ),
  );
  const items = libraryItems();
  $('#library-grid').replaceChildren(...items.map(renderTile));
  const empty = $('#library-empty');
  empty.hidden = items.length > 0;
  if (all.length && !items.length) empty.textContent = 'Nothing matches.';
  else empty.textContent = 'Your library is empty. Choose “Save to library” on a video to watch it here, even offline.';
  const size = all.reduce((total, i) => total + (i.size || 0), 0);
  $('#library-usage').textContent = all.length ? `${all.length} item${all.length === 1 ? '' : 's'} · ${formatBytes(size)} on this computer` : '';
}

// --- Player -----------------------------------------------------------------

let player = null;

function playById(id) {
  const item = state.library.find((i) => i.id === id);
  if (item) openPlayer(item);
}

function openPlayer(item) {
  closePlayer();
  const audio = item.kind === 'audio';
  const media = h(audio ? 'audio' : 'video', {
    class: 'player-media',
    src: mediaUrl(item),
    poster: audio ? null : coverUrl(item),
    controls: true,
    autoplay: true,
    preload: 'auto',
  });
  let lastSave = 0;
  const save = (position = media.currentTime) => {
    lastSave = Date.now();
    const duration = Number.isFinite(media.duration) ? media.duration : undefined;
    Object.assign(item, { position, ...(duration ? { duration } : {}) });
    api.library.progress(item.id, { position, duration });
  };
  // Picks up where it was left, unless that was the very end.
  media.addEventListener('loadedmetadata', () => {
    if (item.position && item.position < media.duration - 5) media.currentTime = item.position;
  });
  media.addEventListener('timeupdate', () => {
    if (Date.now() - lastSave > 5000) save();
  });
  media.addEventListener('pause', () => save());
  media.addEventListener('ended', () => save(0));
  media.addEventListener('error', () => {
    stage.replaceChildren(h('div', { class: 'player-error' }, 'This file can’t be played. It may have been deleted or use a format the player doesn’t support.'));
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.uploader || '' });
  }

  const stage = h(
    'div',
    { class: `player-stage${audio ? ' audio' : ''}` },
    audio ? h('img', { class: 'player-cover', src: coverUrl(item), alt: '', referrerpolicy: 'no-referrer' }) : null,
    media,
  );
  $('#player').replaceChildren(
    h('button', { class: 'link player-back', onclick: closePlayer }, icon('back'), 'Library'),
    stage,
    h(
      'div',
      { class: 'player-info' },
      h(
        'div',
        { class: 'media-text' },
        h('div', { class: 'player-title' }, item.title),
        h('div', { class: 'muted' }, [item.uploader, formatLabel(item)].filter(Boolean).join(' · ')),
      ),
      h(
        'div',
        { class: 'row-actions' },
        iconButton('export', 'Save a copy…', () => api.library.export(item.id)),
        item.url ? h('button', { class: 'btn small', onclick: () => api.openLink(item.url) }, 'Open original') : null,
      ),
    ),
  );
  player = { item, media, save };
  for (const tab of document.querySelectorAll('.tab')) tab.hidden = true;
  $('#player').hidden = false;
  for (const btn of document.querySelectorAll('.tabs button')) btn.setAttribute('aria-selected', String(btn.dataset.tab === 'library'));
  $('main').scrollTop = 0;
  media.focus();
}

function closePlayer() {
  if (!player) return;
  const { media, save } = player;
  if (media.currentTime && !media.ended) save();
  media.pause();
  media.removeAttribute('src');
  media.load();
  player = null;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  $('#player').replaceChildren();
  $('#player').hidden = true;
  selectTab('library');
}

function onPlayerKey(e) {
  if (!player || e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input, select, textarea')) return;
  const { media } = player;
  // The focused player handles space and arrows itself.
  const own = e.target === media;
  if (e.key === 'Escape' && !document.fullscreenElement) closePlayer();
  else if ((e.key === ' ' && !own) || e.key === 'k') media.paused ? media.play() : media.pause();
  else if (e.key === 'ArrowLeft' && !own) media.currentTime -= 5;
  else if (e.key === 'ArrowRight' && !own) media.currentTime += 5;
  else if (e.key === 'j') media.currentTime -= 10;
  else if (e.key === 'l') media.currentTime += 10;
  else if (e.key === 'f' && media.tagName === 'VIDEO') document.fullscreenElement ? document.exitFullscreen() : media.requestFullscreen();
  else if (e.key === 'm') media.muted = !media.muted;
  else return;
  e.preventDefault();
}

// --- History ----------------------------------------------------------------

async function renderHistory() {
  const items = state.history;
  $('#history-count').textContent = items.length ? items.length : '';
  $('#history-empty').hidden = items.length > 0;
  const exists = await Promise.all(items.map((i) => api.file.exists(i.filePath)));
  const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  $('#history-list').replaceChildren(
    ...items.map((item, i) =>
      h(
        'li',
        { class: `row${exists[i] ? '' : ' missing'}` },
        thumb(item.thumbnail, true),
        h(
          'div',
          { class: 'row-main' },
          h('div', { class: 'row-title', title: item.title }, item.title),
          h(
            'div',
            { class: 'row-sub' },
            h('span', { class: 'tag' }, formatLabel(item)),
            h('span', {}, dateFmt.format(item.date)),
            exists[i] ? null : h('span', {}, 'File moved or deleted'),
          ),
        ),
        h(
          'div',
          { class: 'row-actions' },
          exists[i] ? iconButton('play', 'Open', () => api.file.open(item.filePath)) : null,
          exists[i] ? iconButton('folder', 'Show in folder', () => api.file.reveal(item.filePath)) : null,
          iconButton('retry', 'Download again', () => {
            selectTab('download');
            $('#url-input').value = item.url;
            analyze(item.url);
          }),
          iconButton('trash', 'Remove from history', async () => {
            state.history = await api.history.remove(item.id);
            renderHistory();
          }),
        ),
      ),
    ),
  );
}

// --- Tabs, destination, footer ----------------------------------------------

function selectTab(name) {
  if (player) closePlayer();
  for (const btn of document.querySelectorAll('.tabs button')) btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  $('#tab-download').hidden = name !== 'download';
  $('#tab-library').hidden = name !== 'library';
  $('#tab-history').hidden = name !== 'history';
  if (name === 'history') renderHistory();
  if (name === 'library') renderLibrary();
}

function renderDestination() {
  const dir = state.settings.outputDir;
  const btn = $('#dest-path');
  // The button is right-to-left so long paths cut on the left; the LRM marks
  // keep the slashes where they belong.
  btn.textContent = `‎${dir}‎`;
  btn.title = `${dir}\nClick to open the folder`;
}

async function pasteFromClipboard() {
  const text = (await api.readClipboard()).trim();
  // Never interrupt something playing: the link is picked up after.
  if (!text || text === state.lastClipboard || !AUTO_PASTE.test(text) || player) return;
  state.lastClipboard = text;
  const input = $('#url-input');
  if (input.value.trim() === text || state.probedInput === text) return;
  if (input.value.trim() && document.activeElement === input) return;
  selectTab('download');
  input.value = text;
  analyze(text);
}

async function init() {
  if (api.platform === 'darwin') document.body.classList.add('mac');
  else for (const opt of document.querySelectorAll('[data-platform="darwin"]')) opt.remove();

  state.settings = await api.settings.get();
  state.trim = { enabled: false, start: '', end: '' };
  renderDestination();

  for (const job of await api.queue.list()) state.jobs.set(job.id, job);
  renderQueue();
  api.queue.onUpdate(updateJob);
  api.queue.onRemoved((id) => {
    state.jobs.delete(id);
    renderQueue();
  });

  state.library = await api.library.list();
  renderLibrary();
  api.library.onUpdate((items) => {
    state.library = items;
    if (!player) renderLibrary();
  });
  $('#library-search').addEventListener('input', (e) => {
    state.librarySearch = e.target.value;
    renderLibrary();
  });
  document.addEventListener('keydown', onPlayerKey);
  window.addEventListener('beforeunload', () => player && player.save());

  state.history = await api.history.list();
  renderHistory();
  api.history.onUpdate((items) => {
    state.history = items;
    renderHistory();
  });

  $('#url-form').addEventListener('submit', (e) => {
    e.preventDefault();
    analyze($('#url-input').value);
  });
  $('#url-input').addEventListener('paste', () => setTimeout(() => {
    const value = $('#url-input').value.trim();
    if (/^https?:\/\//i.test(value)) {
      state.lastClipboard = value;
      analyze(value);
    }
  }));

  for (const btn of document.querySelectorAll('.tabs button')) btn.addEventListener('click', () => selectTab(btn.dataset.tab));

  $('#dest-path').addEventListener('click', () => api.folder.open());
  $('#dest-change').addEventListener('click', async () => {
    const dir = await api.folder.choose();
    if (dir) {
      state.settings.outputDir = dir;
      renderDestination();
    }
  });

  $('#queue-clear').addEventListener('click', () => api.queue.clear());
  $('#history-clear').addEventListener('click', async () => {
    if (!confirm('Clear the whole history? Your files will not be deleted.')) return;
    state.history = await api.history.clear();
    renderHistory();
  });

  const cookies = $('#cookies-select');
  cookies.value = state.settings.cookiesBrowser || '';
  cookies.addEventListener('change', () => api.settings.set({ cookiesBrowser: cookies.value }));

  const showVersion = (v) => ($('#engine-version').textContent = v ? `yt-dlp ${v}` : 'yt-dlp not found');
  api.engine.version().then(showVersion);
  api.engine.onVersion(showVersion);
  $('#engine-update').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Updating…';
    try {
      showVersion(await api.engine.update());
      btn.textContent = 'Up to date';
    } catch (err) {
      btn.textContent = 'Update failed';
      btn.title = cleanError(err);
    } finally {
      btn.disabled = false;
    }
  });

  // Dropping a link (from a browser tab or address bar) analyzes it.
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('dragging');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const text = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n')[0].trim();
    if (text) {
      selectTab('download');
      $('#url-input').value = text;
      analyze(text);
    }
  });

  window.addEventListener('focus', pasteFromClipboard);
  pasteFromClipboard();
  $('#url-input').focus();
}

init();
