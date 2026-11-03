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
  playlists: [],
  openPlaylist: null,
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
  pause: 'M9 5v14M15 5v14',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  prevChapter: 'M6 5v14M18 6l-9 6 9 6z',
  nextChapter: 'M18 5v14M6 6l9 6-9 6z',
  volume: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  volumeLow: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 0 1 0 6',
  muted: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM16 10l4 4M20 10l-4 4',
  captions: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 11.5h3M13 11.5h4M7 15h6M15.5 15H17',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  mini: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12.5 13H18v4h-5.5z',
  theater: 'M2.5 8.5a1.5 1.5 0 0 1 1.5-1.5h16a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z',
  pip: 'M21 11V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M13.5 14H21v6h-7.5z',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  exitFullscreen: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  back10: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4M10 10v5M13 10h2v5h-2z',
  forward10: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4M9 10v5M12 10h2v5h-2z',
  playlist: 'M4 6h12M4 11h12M4 16h7M15 14.5v6l5-3z',
  shuffle: 'M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M14.3 8.4c.8-.9 1.8-1.4 3.2-1.4H21M18 4l3 3-3 3M18 14l3 3-3 3',
  chevron: 'M9 6l6 6-6 6',
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

// A dialog takes the focus from the window: that is not the app going to the
// background, so no picture-in-picture meanwhile.
async function withDialog(fn) {
  state.dialog = true;
  try {
    return await fn();
  } finally {
    setTimeout(() => (state.dialog = false), 400);
  }
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

// The library item that already holds this media (same video, same kind, not a
// clip), like sameMedia() in the main process.
function findInLibrary(spec) {
  if (spec.trim) return null;
  return state.library.find((i) => i.kind === spec.kind && !i.trim && ((spec.key && i.key === spec.key) || (spec.url && i.url === spec.url))) || null;
}

function videoSpec(info) {
  return { ...jobOptions(info), key: info.key, url: info.url || state.probedInput, trim: trimValue() };
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
    libraryBtn.lastChild.textContent = trim !== undefined && findInLibrary(videoSpec(info)) ? 'Play from library' : 'Save to library';
  } else {
    const count = state.selected.size;
    btn.disabled = libraryBtn.disabled = count === 0;
    btn.lastChild.textContent = `Add ${count} item${count === 1 ? '' : 's'} · ${formatLabel(jobOptions(info))}`;
    libraryBtn.lastChild.textContent = `Save ${count} to library`;
    const known = info.entries.filter((e, i) => state.selected.has(i) && findInLibrary({ ...jobOptions(info), key: e.key, url: e.url })).length;
    const hint = $('#library-hint');
    hint.hidden = !known;
    hint.textContent = `${known} of these ${known === 1 ? 'is' : 'are'} already in your library: saving adds ${known === 1 ? 'it' : 'them'} to the playlist without downloading again.`;
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
    isPlaylist ? h('div', { class: 'hint', id: 'library-hint', hidden: true }) : null,
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
          findInLibrary({ ...jobOptions(info), key: entry.key, url: entry.url }) ? h('span', { class: 'in-library' }, 'In library') : null,
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
  let playlist = null;
  if (info.type === 'video') {
    const trim = trimValue();
    if (trim === undefined) return;
    const spec = { ...opts, ...videoSpec(info), library, title: info.title, uploader: info.uploader, duration: info.duration, thumbnail: info.thumbnail };
    const owned = library && findInLibrary(spec);
    if (owned) return openPlayer(owned);
    specs = [spec];
  } else {
    specs = info.entries
      .map((e, i) => ({ ...opts, key: e.key, url: e.url, title: e.title, uploader: e.uploader, duration: e.duration, thumbnail: e.thumbnail, trim: null, playlistIndex: i }))
      .filter((_, i) => state.selected.has(i));
    if (library) playlist = { key: info.key, title: info.title, uploader: info.uploader, url: state.probedInput, thumbnail: info.entries[0]?.thumbnail || null };
  }
  const result = await api.queue.add(specs, { playlist });
  state.info = null;
  $('#url-input').value = '';
  renderPreview();
  if (playlist) {
    const parts = [result.added && `${result.added} downloading`, result.existing && `${result.existing} already in your library, not downloaded again`];
    notice(`Playlist “${playlist.title}” saved to your library: ${parts.filter(Boolean).join(', ')}.`);
  } else if (library) {
    notice(specs.length > 1 ? `${specs.length} items will show up in your library once downloaded.` : 'It will show up in your library once downloaded.');
  } else {
    notice(specs.length > 1 ? `${specs.length} items added to the queue.` : '');
  }
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
        iconButton('export', 'Save a copy…', stop(() => withDialog(() => api.library.export(item.id)))),
        iconButton(
          'trash',
          'Remove from library',
          stop(async () => {
            if (!(await withDialog(() => confirm(`Remove “${item.title}” from your library? The file will be deleted.`)))) return;
            if (player?.item.id === item.id) stopPlayer();
            applyLibrary(await api.library.remove(item.id));
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
        ['playlists', state.playlists.length ? `Playlists ${state.playlists.length}` : 'Playlists'],
      ],
      state.libraryFilter,
      (filter) => {
        state.libraryFilter = filter;
        state.openPlaylist = null;
        renderLibrary();
      },
    ),
  );
  const grid = $('#library-grid');
  const view = $('#library-playlist');
  const empty = $('#library-empty');
  const open = state.libraryFilter === 'playlists' && state.playlists.find((p) => p.id === state.openPlaylist);
  if (!open) state.openPlaylist = null;
  grid.hidden = Boolean(open);
  view.hidden = !open;

  if (open) {
    view.replaceChildren(...renderPlaylistView(open));
    empty.hidden = true;
  } else if (state.libraryFilter === 'playlists') {
    const query = state.librarySearch.trim().toLowerCase();
    const lists = state.playlists.filter((p) => !query || `${p.title} ${p.uploader || ''}`.toLowerCase().includes(query));
    grid.replaceChildren(...lists.map(renderPlaylistTile));
    empty.hidden = lists.length > 0;
    empty.textContent = state.playlists.length ? 'Nothing matches.' : 'No playlists yet. Open a playlist link and choose “Save to library”.';
  } else {
    const items = libraryItems();
    grid.replaceChildren(...items.map(renderTile));
    empty.hidden = items.length > 0;
    if (all.length && !items.length) empty.textContent = 'Nothing matches.';
    else empty.textContent = 'Your library is empty. Choose “Save to library” on a video to watch it here, even offline.';
  }
  const size = all.reduce((total, i) => total + (i.size || 0), 0);
  $('#library-usage').textContent = all.length ? `${all.length} item${all.length === 1 ? '' : 's'} · ${formatBytes(size)} on this computer` : '';
}

function applyLibrary({ items, playlists }) {
  state.library = items;
  state.playlists = playlists;
  renderLibrary();
}

// --- Library: playlists ---

// The playlist's items that are in the library (some may still be downloading).
function playlistItems(playlist) {
  return playlist.entries.map((e) => state.library.find((i) => i.id === e.id)).filter(Boolean);
}

function playlistCover(playlist) {
  const first = playlistItems(playlist)[0];
  return first ? coverUrl(first) : playlist.thumbnail;
}

// "3 h 20 min", "45 min", "40 s"
function formatTotal(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`;
}

function renderPlaylistTile(playlist) {
  const count = playlistItems(playlist).length;
  return h(
    'li',
    {
      class: 'tile playlist-tile',
      title: playlist.title,
      onclick: () => {
        state.openPlaylist = playlist.id;
        renderLibrary();
        $('main').scrollTop = 0;
      },
    },
    h(
      'div',
      { class: 'tile-art' },
      thumb(playlistCover(playlist)),
      h('span', { class: 'tile-play' }, icon('playlist')),
      h('span', { class: 'playlist-count' }, icon('playlist'), `${count} item${count === 1 ? '' : 's'}`),
    ),
    h(
      'div',
      { class: 'tile-body' },
      h(
        'div',
        { class: 'tile-text' },
        h('div', { class: 'tile-title' }, playlist.title),
        h('div', { class: 'row-sub' }, h('span', { class: 'tag' }, 'Playlist'), playlist.uploader ? h('span', {}, playlist.uploader) : null),
      ),
    ),
  );
}

function renderPlaylistView(playlist) {
  const query = state.librarySearch.trim().toLowerCase();
  const items = playlistItems(playlist);
  const pending = playlist.entries.length - items.length;
  const total = items.reduce((t, i) => t + (i.duration || 0), 0);
  const meta = [
    playlist.uploader,
    `${items.length} item${items.length === 1 ? '' : 's'}`,
    total ? formatTotal(total) : null,
    pending ? `${pending} still downloading` : null,
  ].filter(Boolean);

  const head = h(
    'div',
    { class: 'playlist-head' },
    thumb(playlistCover(playlist)),
    h(
      'div',
      { class: 'media-text' },
      h('div', { class: 'playlist-title' }, playlist.title),
      h('div', { class: 'muted' }, meta.join(' · ')),
      h(
        'div',
        { class: 'playlist-actions' },
        h('button', { class: 'btn primary', disabled: !items.length, onclick: () => playPlaylist(playlist, 0) }, icon('play'), 'Play all'),
        h('button', { class: 'btn', disabled: items.length < 2, onclick: () => playPlaylist(playlist, 0, { shuffle: true }) }, icon('shuffle'), 'Shuffle'),
        playlist.url ? h('button', { class: 'btn', onclick: () => api.openLink(playlist.url) }, 'Open original') : null,
        iconButton('trash', 'Delete playlist', async () => {
          if (!(await withDialog(() => confirm(`Delete the playlist “${playlist.title}”? Its videos stay in your library.`)))) return;
          state.openPlaylist = null;
          applyLibrary(await api.library.removePlaylist(playlist.id));
        }),
      ),
    ),
  );

  const rows = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !query || `${item.title} ${item.uploader || ''}`.toLowerCase().includes(query))
    .map(({ item, index }) => {
      const progress = item.duration && item.position ? Math.min(100, (item.position / item.duration) * 100) : 0;
      return h(
        'li',
        { class: 'row clickable', onclick: () => playPlaylist(playlist, index) },
        h('span', { class: 'row-index' }, index + 1),
        thumb(coverUrl(item), true),
        h(
          'div',
          { class: 'row-main' },
          h('div', { class: 'row-title', title: item.title }, item.title),
          h('div', { class: 'row-sub' }, item.uploader ? h('span', {}, item.uploader) : null, h('span', {}, formatDuration(item.duration))),
          progress ? h('div', { class: 'progress' }, h('div', { style: `width: ${progress}%` })) : null,
        ),
        h(
          'div',
          { class: 'row-actions' },
          iconButton('close', 'Remove from this playlist', async (e) => {
            e.stopPropagation();
            applyLibrary(await api.library.removeFromPlaylist(playlist.id, item.id));
          }),
        ),
      );
    });

  return [
    h(
      'button',
      {
        class: 'link player-back',
        onclick: () => {
          state.openPlaylist = null;
          renderLibrary();
        },
      },
      icon('back'),
      'Playlists',
    ),
    head,
    h('ol', { class: 'rows playlist-rows' }, rows),
  ];
}

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function playPlaylist(playlist, start = 0, { shuffle = false } = {}) {
  let order = playlistItems(playlist).map((i) => i.id);
  if (!order.length) return;
  if (shuffle) {
    order = shuffled(order);
    start = 0;
  }
  const item = state.library.find((i) => i.id === order[start]);
  openPlayer(item, { queue: { playlistId: playlist.id, title: playlist.title, order, index: start, shuffle } });
}

// --- Player -----------------------------------------------------------------

// What is playing. It shows full size in #player, or in the mini player at the
// bottom while you browse the rest of the app: the same <video> moves between
// the two, so playback carries on.
let player = null;

const subtitleUrl = (item, lang) => `decant-media://${item.id}/subs/${lang}`;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const isMac = api.platform === 'darwin';
const CHAPTER_KEY = isMac ? '⌥' : 'Ctrl';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const CAPTION_DEFAULTS = { size: 1, font: 'sans', color: '#ffffff', background: '#000000', opacity: 0.75 };
const CAPTION_SIZES = [0.5, 0.75, 1, 1.5, 2, 3];
const CAPTION_FONTS = [
  ['sans', 'Sans-serif'],
  ['serif', 'Serif'],
  ['mono', 'Monospace'],
  ['rounded', 'Rounded'],
];
const CAPTION_COLORS = [
  ['#ffffff', 'White'],
  ['#ffe066', 'Yellow'],
  ['#7cf0b0', 'Green'],
  ['#66d9ff', 'Cyan'],
  ['#b9a6ff', 'Lavender'],
  ['#ff8f8f', 'Red'],
  ['#000000', 'Black'],
];
const CAPTION_OPACITIES = [0, 0.25, 0.5, 0.75, 1];

const SHORTCUTS = [
  ['Space / K', 'Play or pause'],
  ['J / L', 'Back / forward 10 s'],
  ['← / →', 'Back / forward 5 s'],
  ['↑ / ↓', 'Volume'],
  ['M', 'Mute'],
  ['F / double-click', 'Full screen'],
  ['T', 'Theater mode'],
  ['I', 'Mini player'],
  ['C', 'Subtitles on / off'],
  ['+ / −', 'Subtitle size'],
  ['B', 'Subtitle background'],
  ['< / >', 'Slower / faster'],
  [', / .', 'Previous / next frame (paused)'],
  ['0 – 9', 'Jump to 0 % – 90 %'],
  ['Home / End', 'Start / end'],
  [`${CHAPTER_KEY} ← / →`, 'Previous / next chapter'],
  ['Shift N / Shift P', 'Next / previous in a playlist'],
  ['Esc', 'Close a menu, leave the player'],
  ['?', 'This list'],
];

function languageName(lang) {
  try {
    // In English, like the rest of the interface.
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) || lang;
  } catch {
    return lang;
  }
}

const speedLabel = (rate) => (rate === 1 ? 'Normal' : `${Number(rate.toFixed(2))}×`);

function playById(id) {
  const item = state.library.find((i) => i.id === id);
  if (item) openPlayer(item);
}

const chaptersOf = (item) => (item.chapters?.length > 1 ? item.chapters : []);

// Index of the chapter playing at `time`, or -1.
function chapterAt(chapters, time) {
  let index = -1;
  for (const [i, c] of chapters.entries()) if (c.start <= time + 0.25) index = i;
  return index;
}

function seekChapter(step) {
  if (!player) return;
  const { media, item } = player;
  const chapters = chaptersOf(item);
  if (!chapters.length) return;
  const current = chapterAt(chapters, media.currentTime);
  // "Previous" first goes back to the start of the chapter playing.
  let target = current + step;
  if (step < 0 && current >= 0 && media.currentTime - chapters[current].start > 3) target = current;
  if (target >= chapters.length) return;
  media.currentTime = chapters[Math.max(0, target)].start;
  flash(null, chapters[Math.max(0, target)].title);
}

// queue: playing from a playlist ({ playlistId, title, order, index }).
// mini: start in the mini player (the next song while browsing).
function openPlayer(item, { queue = null, mini = false } = {}) {
  if (player?.item.id === item.id) {
    if (queue) player.queue = queue;
    player.mini = false;
    return pip ? leavePip() : expandPlayer();
  }
  // The next video of a playlist goes on in the picture-in-picture window.
  const keepPip = Boolean(pip) && item.kind !== 'audio';
  stopPlayer({ keepPip });
  const audio = item.kind === 'audio';
  const media = h(
    audio ? 'audio' : 'video',
    {
      class: 'player-media',
      src: mediaUrl(item),
      poster: audio ? null : coverUrl(item),
      crossorigin: 'anonymous',
      autoplay: true,
      preload: 'auto',
    },
    (item.subtitles || []).map((s) => h('track', { kind: 'subtitles', src: subtitleUrl(item, s.lang), srclang: s.lang, label: languageName(s.lang) })),
  );
  media.volume = clamp(state.settings.playerVolume ?? 1, 0, 1);
  media.muted = Boolean(state.settings.playerMuted);
  media.defaultPlaybackRate = media.playbackRate = state.speed || 1;

  // Dropped all at once when the player stops, so a late 'pause' cannot save position 0.
  const listeners = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: listeners.signal });
  let lastSave = 0;
  const save = (position = media.currentTime) => {
    // While the video moves to or from the PiP window it briefly reads 0 s.
    if (player?.media === media && player.moving) return;
    lastSave = Date.now();
    const duration = Number.isFinite(media.duration) ? media.duration : undefined;
    Object.assign(item, { position, ...(duration ? { duration } : {}) });
    api.library.progress(item.id, { position, duration });
  };
  player = { item, media, save, listeners, queue, mini: false, chapter: null, track: null, segments: [] };

  on(media, 'loadedmetadata', () => {
    // Picks up where it was left, unless that was the very end.
    if (item.position && item.position < media.duration - 5) media.currentTime = item.position;
    // Subtitles are drawn by the player itself (so they can be styled), from a
    // 'hidden' track. Chromium may switch a track on while loading, hence now.
    setSubtitles(state.settings.subtitleLang, { remember: false });
    buildSegments();
  });
  on(media, 'durationchange', buildSegments);
  on(media, 'timeupdate', () => {
    if (Date.now() - lastSave > 5000) save();
    updateTime();
  });
  on(media, 'progress', updateTime);
  on(media, 'pause', () => {
    save();
    updateControls();
    poke();
  });
  on(media, 'play', () => {
    updateControls();
    poke();
    requestAnimationFrame(tick);
  });
  on(media, 'playing', () => {
    // Plays by itself only the first time: moving to the PiP window reloads it.
    media.autoplay = false;
    // Started while the app is in the background (a media key): PiP as well.
    // Not when it only resumes after moving between windows.
    if (!document.hasFocus() && Date.now() - (player.movedAt || 0) > 1500) setTimeout(autoPip, 200);
  });
  on(media, 'ended', () => {
    save(0);
    playAdjacent(1);
  });
  on(media, 'ratechange', () => (state.speed = media.playbackRate));
  on(media, 'volumechange', () => {
    updateControls();
    state.settings.playerVolume = media.volume;
    state.settings.playerMuted = media.muted;
    api.settings.set({ playerVolume: media.volume, playerMuted: media.muted });
  });
  on(media, 'error', () => {
    const text = 'This file can’t be played. It may have been deleted or use a format the player doesn’t support.';
    if (player.mini) player.miniSub.textContent = text;
    else player.stage.replaceChildren(h('div', { class: 'player-error' }, text));
  });
  // Keeps Chromium from drawing subtitles on top of ours.
  on(media.textTracks, 'change', () => {
    for (const t of media.textTracks) if (t.mode === 'showing') t.mode = t === player.track ? 'hidden' : 'disabled';
  });

  if ('mediaSession' in navigator) {
    const cover = coverUrl(item);
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.uploader || '', artwork: cover ? [{ src: cover }] : [] });
    // In a playlist these move between videos, otherwise between chapters.
    const chapters = chaptersOf(item).length > 0;
    navigator.mediaSession.setActionHandler('previoustrack', queue ? previousInQueue : chapters ? () => seekChapter(-1) : null);
    navigator.mediaSession.setActionHandler('nexttrack', queue ? () => playAdjacent(1) : chapters ? () => seekChapter(1) : null);
  }
  if (mini) minimizePlayer();
  else expandPlayer();
  if (keepPip && pip) renderPip();

  // Items saved by older versions have no description: fetch it once.
  if (item.description === undefined && item.url) {
    api.library
      .refresh(item.id)
      .then((fresh) => {
        if (!fresh) return;
        const gotChapters = !chaptersOf(item).length && chaptersOf(fresh).length > 0;
        const { position, ...rest } = fresh;
        Object.assign(item, rest);
        if (player?.item !== item || player.mini) return;
        if (gotChapters) return expandPlayer();
        const box = renderDescription(item);
        if (!box) return;
        if (player.chapterBox) player.chapterBox.before(box);
        else $('#player').append(box);
        player.descriptionBox = box;
      })
      .catch(() => {});
  }
}

// The description under the player: links open in the browser, timestamps seek.
function renderDescription(item) {
  const text = (item.description || '').trim();
  if (!text) return null;
  const body = h('div', { class: 'description-text' });
  let last = 0;
  for (const m of text.matchAll(/(https?:\/\/[^\s<>"]+)|(\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/g)) {
    body.append(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      const url = m[1].replace(/[).,;:!?'"]+$/, '');
      body.append(h('a', { href: url, onclick: (e) => (e.preventDefault(), api.openLink(url)) }, url), m[1].slice(url.length));
    } else {
      const time = parseTime(m[2]);
      body.append(
        h(
          'a',
          {
            href: '#',
            class: 'timestamp',
            onclick: (e) => {
              e.preventDefault();
              if (!player) return;
              player.media.currentTime = time;
              player.media.play();
              $('main').scrollTo({ top: 0, behavior: 'smooth' });
            },
          },
          m[2],
        ),
      );
    }
  }
  body.append(text.slice(last));
  const long = text.split('\n').length > 4 || text.length > 320;
  const box = h('section', { class: `description${long ? ' collapsed' : ''}` }, body);
  if (long) {
    const toggle = h(
      'button',
      {
        class: 'link',
        onclick: () => {
          const collapsed = box.classList.toggle('collapsed');
          toggle.textContent = collapsed ? 'Show more' : 'Show less';
        },
      },
      'Show more',
    );
    box.append(toggle);
  }
  return box;
}

// Smooth progress while playing (timeupdate only fires a few times a second).
function tick() {
  if (!player || player.media.paused) return;
  updateTime();
  // The app's window may be hidden behind others, and its frames slowed down.
  (pip && !pip.win.closed ? pip.win : window).requestAnimationFrame(tick);
}

// --- Player: full view ---

function ctl(name, label, onclick, cls = '') {
  // Clicking does not focus the button, so Space keeps meaning play/pause.
  return h('button', { class: `ctl ${cls}`, title: label, 'aria-label': label, onclick, onmousedown: (e) => e.preventDefault() }, icon(name));
}

function setCtl(button, name, label) {
  button.replaceChildren(icon(name));
  button.title = label;
  button.setAttribute('aria-label', label);
}

function expandPlayer() {
  const { item, media } = player;
  const audio = item.kind === 'audio';
  const chapters = chaptersOf(item);
  player.mini = false;
  media.controls = false;

  // Seek bar: one segment per chapter.
  player.seekTrack = h('div', { class: 'seek-track' });
  player.thumb = h('div', { class: 'seek-thumb' });
  player.tip = h('div', { class: 'seek-tip', hidden: true });
  player.seek = h('div', { class: 'seek' }, player.seekTrack, player.thumb, player.tip);
  setupSeek(player.seek);

  const c = (player.ctl = {});
  c.play = ctl('play', 'Play (k)', togglePlay, 'filled');
  // In a playlist the skip buttons move between videos, otherwise between chapters.
  if (player.queue) {
    c.prev = ctl('prevChapter', 'Previous (Shift P)', previousInQueue, 'filled');
    c.next = ctl('nextChapter', 'Next (Shift N)', () => playAdjacent(1), 'filled');
  } else if (chapters.length) {
    c.prev = ctl('prevChapter', `Previous chapter (${CHAPTER_KEY} ←)`, () => seekChapter(-1), 'filled');
    c.next = ctl('nextChapter', `Next chapter (${CHAPTER_KEY} →)`, () => seekChapter(1), 'filled');
  }
  c.mute = ctl('volume', 'Mute (m)', toggleMute);
  c.volume = h('input', {
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    'aria-label': 'Volume',
    oninput: (e) => setVolume(Number(e.target.value)),
    onchange: (e) => e.target.blur(),
  });
  const volume = h('div', { class: 'volume', onwheel: (e) => {
    e.preventDefault();
    changeVolume(e.deltaY < 0 ? 0.05 : -0.05);
  } }, c.mute, c.volume);
  c.time = h('span', { class: 'ctl-time' });
  c.chapter = chapters.length
    ? h('button', { class: 'ctl-chapter', title: 'Chapters', onmousedown: (e) => e.preventDefault(), onclick: () => player.chapterBox?.scrollIntoView({ behavior: 'smooth', block: 'center' }) })
    : null;
  c.captions = item.subtitles?.length ? ctl('captions', 'Subtitles (c)', toggleSubtitles) : null;
  c.settings = ctl('settings', 'Settings', () => (player.menuOpen ? closeMenu() : openMenu('main')));
  c.mini = ctl('mini', 'Mini player (i)', toMini);
  c.theater = audio ? null : ctl('theater', 'Theater mode (t)', toggleTheater);
  c.pip = audio ? null : ctl('pip', 'Picture in picture', () => (pip ? leavePip() : enterPip({ manual: true })));
  c.fullscreen = audio ? null : ctl('fullscreen', 'Full screen (f)', toggleFullscreen);

  player.controls = h(
    'div',
    {
      class: 'player-controls',
      onmouseenter: () => (player.overControls = true),
      onmouseleave: () => {
        player.overControls = false;
        poke();
      },
    },
    player.seek,
    h(
      'div',
      { class: 'ctl-row' },
      c.play,
      c.prev,
      c.next,
      volume,
      c.time,
      c.chapter,
      h('span', { class: 'spacer' }),
      c.captions,
      c.settings,
      c.mini,
      c.theater,
      c.pip,
      c.fullscreen,
    ),
  );
  player.captions = h('div', { class: 'captions' });
  player.flashEl = h('div', { class: 'player-flash' });
  player.bubble = h('div', { class: 'player-bubble' });
  player.menu = h('div', { class: 'player-menu', hidden: true, onclick: (e) => e.stopPropagation() });
  player.help = h(
    'div',
    { class: 'player-help', hidden: true, onclick: () => toggleHelp(false) },
    h(
      'div',
      { class: 'help-box' },
      h('div', { class: 'help-title' }, 'Keyboard and mouse'),
      h('div', { class: 'help-grid' }, SHORTCUTS.map(([keys, action]) => [h('kbd', {}, keys), h('span', {}, action)])),
      h('div', { class: 'help-foot' }, 'Click the video to pause, scroll over the volume to change it.'),
    ),
  );

  const surface = audio ? h('img', { class: 'player-cover', src: coverUrl(item), alt: '', referrerpolicy: 'no-referrer', onclick: () => togglePlay() }) : null;
  player.stage = h(
    'div',
    {
      class: `player-stage ${audio ? 'audio' : 'video'}`,
      onmousemove: poke,
      onmouseleave: () => player && !player.media.paused && player.stage.classList.add('idle'),
    },
    surface,
    pip ? pipPlaceholder() : media,
    player.captions,
    player.flashEl,
    player.bubble,
    player.controls,
    player.menu,
    player.help,
  );
  if (!audio) {
    media.onclick = () => (player.menuOpen ? closeMenu() : togglePlay());
    media.ondblclick = toggleFullscreen;
  }

  player.chapterList = h(
    'ol',
    { class: 'chapters' },
    chapters.map((ch) =>
      h(
        'li',
        {},
        h(
          'button',
          {
            onclick: () => {
              media.currentTime = ch.start;
              media.play();
            },
          },
          h('span', { class: 'chapter-time' }, formatDuration(ch.start)),
          h('span', { class: 'chapter-title' }, ch.title),
        ),
      ),
    ),
  );
  player.chapterBox = chapters.length ? h('section', { class: 'chapters-box' }, h('h2', {}, 'Chapters'), player.chapterList) : null;

  $('#player').classList.toggle('theater', Boolean(state.settings.theater) && !audio);
  player.descriptionBox = renderDescription(item);
  player.queueBox = renderQueueBox();
  $('#player').replaceChildren(...[
    h('button', { class: 'link player-back', onclick: () => selectTab('library') }, icon('back'), 'Library'),
    player.stage,
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
        iconButton('export', 'Save a copy…', () => withDialog(() => api.library.export(item.id))),
        item.url ? h('button', { class: 'btn small', onclick: () => api.openLink(item.url) }, 'Open original') : null,
      ),
    ),
    player.queueBox,
    player.descriptionBox,
    player.chapterBox,
  ].filter(Boolean));
  $('#mini-player').replaceChildren();
  $('#mini-player').hidden = true;
  for (const tab of document.querySelectorAll('.tab')) tab.hidden = true;
  $('#player').hidden = false;
  for (const btn of document.querySelectorAll('.tabs button')) btn.setAttribute('aria-selected', String(btn.dataset.tab === 'library'));
  $('main').scrollTop = 0;
  document.activeElement?.blur();

  const current = player.queueBox?.querySelector('li.current');
  if (current) current.parentElement.scrollTop = current.offsetTop - 4;
  player.chapter = null;
  applyCaptionStyle();
  renderCaptions();
  buildSegments();
  updateControls();
  updateTime();
  poke();
}

// --- Player: playlists ---

// Plays the next (step 1) or previous (-1) item of the playlist, in the same
// view (full or mini). Returns false at either end.
function playAdjacent(step) {
  const queue = player?.queue;
  if (!queue) return false;
  for (let index = queue.index + step; index >= 0 && index < queue.order.length; index += step) {
    const item = state.library.find((i) => i.id === queue.order[index]);
    if (item) {
      openPlayer(item, { queue: { ...queue, index }, mini: player.mini });
      return true;
    }
  }
  return false;
}

// "Previous" restarts the video first, like a music player.
function previousInQueue() {
  if (!player) return;
  if (player.media.currentTime > 3 || !playAdjacent(-1)) player.media.currentTime = 0;
}

// What is coming up, under the player.
function renderQueueBox() {
  const queue = player.queue;
  if (!queue) return null;
  const rows = queue.order.map((id, index) => {
    const item = state.library.find((i) => i.id === id);
    if (!item) return null;
    const current = index === queue.index;
    return h(
      'li',
      { class: current ? 'current' : null },
      h(
        'button',
        { onclick: () => !current && openPlayer(item, { queue: { ...queue, index } }) },
        h('span', { class: 'queue-index' }, current ? icon('play') : index + 1),
        thumb(coverUrl(item), true),
        h('span', { class: 'queue-item' }, h('span', { class: 'queue-item-title' }, item.title), h('span', { class: 'muted' }, item.uploader || '')),
        h('span', { class: 'muted' }, formatDuration(item.duration)),
      ),
    );
  });
  return h(
    'section',
    { class: 'queue-box' },
    h(
      'div',
      { class: 'queue-head' },
      h('span', { class: 'queue-title' }, queue.shuffle ? `${queue.title} · shuffled` : queue.title),
      h('span', { class: 'muted' }, `${queue.index + 1} / ${queue.order.length}`),
    ),
    h('ol', { class: 'queue-list' }, rows.filter(Boolean)),
  );
}

function setupSeek(seek) {
  const move = (e) => {
    if (!player?.segments.length) return;
    const time = timeAt(e.clientX);
    if (player.dragging) player.media.currentTime = time;
    showHover(time, e.clientX);
  };
  seek.addEventListener('pointermove', move);
  seek.addEventListener('pointerleave', () => !player?.dragging && showHover(null));
  seek.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !player?.segments.length) return;
    player.dragging = true;
    seek.classList.add('dragging');
    seek.setPointerCapture(e.pointerId);
    move(e);
  });
  const end = (e) => {
    if (!player?.dragging) return;
    player.dragging = false;
    seek.classList.remove('dragging');
    if (!seek.matches(':hover')) showHover(null);
    updateTime();
  };
  seek.addEventListener('pointerup', end);
  seek.addEventListener('pointercancel', end);
}

// Chapter boundaries, measured once the duration is known.
function buildSegments() {
  if (!player?.seekTrack) return;
  const { media, item } = player;
  const duration = media.duration;
  if (!Number.isFinite(duration) || !duration) return;
  const starts = chaptersOf(item)
    .map((c) => c.start)
    .filter((s) => s > 0.5 && s < duration - 0.5);
  const bounds = [0, ...starts, duration];
  player.segments = bounds.slice(0, -1).map((start, i) => {
    const fill = (cls) => h('div', { class: cls });
    const seg = { start, end: bounds[i + 1], buffer: fill('seg-buffer'), hover: fill('seg-hover'), play: fill('seg-play') };
    seg.el = h('div', { class: 'seg', style: `flex-grow: ${seg.end - start}` }, seg.buffer, seg.hover, seg.play);
    return seg;
  });
  player.seekTrack.replaceChildren(...player.segments.map((s) => s.el));
  updateTime();
}

// The time under a point of the seek bar (segments are separated by gaps).
function timeAt(clientX) {
  const segs = player.segments;
  for (const s of segs) {
    const box = s.el.getBoundingClientRect();
    if (clientX <= box.right + 1) return s.start + clamp((clientX - box.left) / box.width, 0, 1) * (s.end - s.start);
  }
  return segs.at(-1).end;
}

function fill(part, time) {
  for (const s of player.segments) {
    const ratio = time == null ? 0 : clamp((time - s.start) / (s.end - s.start), 0, 1);
    s[part].style.transform = `scaleX(${ratio})`;
  }
}

function showHover(time, clientX) {
  if (!player?.tip) return;
  fill('hover', time);
  for (const s of player.segments) s.el.classList.toggle('hovered', time != null && time >= s.start && time < s.end);
  if (time == null) {
    player.tip.hidden = true;
    return;
  }
  const chapters = chaptersOf(player.item);
  const index = chapterAt(chapters, time);
  player.tip.replaceChildren(
    index >= 0 ? h('div', { class: 'tip-chapter' }, chapters[index].title) : '',
    h('div', { class: 'tip-time' }, formatDuration(time)),
  );
  player.tip.hidden = false;
  const box = player.seek.getBoundingClientRect();
  const half = player.tip.offsetWidth / 2;
  player.tip.style.left = `${clamp(clientX - box.left, half, box.width - half)}px`;
}

// Everything that moves with the playhead.
function updateTime() {
  if (!player) return;
  updatePip();
  const { media, item } = player;
  const time = media.currentTime;
  const duration = Number.isFinite(media.duration) ? media.duration : 0;
  const chapters = chaptersOf(item);
  const index = chapterAt(chapters, time);

  if (player.mini) {
    player.miniBar.style.width = `${duration ? (time / duration) * 100 : 0}%`;
  } else if (player.segments.length) {
    fill('play', time);
    let buffered = time;
    for (let i = 0; i < media.buffered.length; i++) {
      if (media.buffered.start(i) <= time + 0.5) buffered = Math.max(buffered, media.buffered.end(i));
    }
    fill('buffer', buffered);
    const seg = player.segments.find((s) => time < s.end) || player.segments.at(-1);
    const x = seg.el.offsetLeft + clamp((time - seg.start) / (seg.end - seg.start), 0, 1) * seg.el.offsetWidth;
    player.thumb.style.left = `${x}px`;
  }
  if (!player.mini) player.ctl.time.textContent = `${formatDuration(time)} / ${formatDuration(duration)}`;

  if (index === player.chapter) return;
  player.chapter = index;
  const title = index >= 0 ? chapters[index].title : '';
  if (player.mini) {
    player.miniSub.textContent = title || item.uploader || '';
    return;
  }
  if (player.ctl.chapter) {
    player.ctl.chapter.textContent = title ? `• ${title}` : '';
    player.ctl.chapter.hidden = !title;
  }
  for (const [i, li] of [...player.chapterList.children].entries()) li.classList.toggle('current', i === index);
  // Scrolls the list only (scrollIntoView would move the whole page).
  const list = player.chapterList;
  const li = list.children[index];
  if (li && (li.offsetTop < list.scrollTop || li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight)) {
    list.scrollTop = li.offsetTop - 4;
  }
}

// Button states: play/pause, volume, subtitles, theater, full screen.
function updateControls() {
  updatePip();
  if (!player || player.mini) {
    updatePlayState();
    return;
  }
  const { media } = player;
  const c = player.ctl;
  setCtl(c.play, media.paused ? 'play' : 'pause', media.paused ? 'Play (k)' : 'Pause (k)');
  const level = media.muted || media.volume === 0 ? 'muted' : media.volume < 0.5 ? 'volumeLow' : 'volume';
  setCtl(c.mute, level, media.muted ? 'Unmute (m)' : 'Mute (m)');
  c.volume.value = media.muted ? 0 : media.volume;
  c.volume.style.setProperty('--level', `${(media.muted ? 0 : media.volume) * 100}%`);
  c.captions?.classList.toggle('on', Boolean(player.track));
  c.theater?.classList.toggle('on', $('#player').classList.contains('theater'));
  if (c.fullscreen) {
    const full = document.fullscreenElement === player.stage;
    setCtl(c.fullscreen, full ? 'exitFullscreen' : 'fullscreen', full ? 'Exit full screen (f)' : 'Full screen (f)');
  }
}

// Shows the controls, then hides them (and the pointer) after 3 s still.
function poke() {
  if (!player?.stage || player.mini) return;
  player.stage.classList.remove('idle');
  clearTimeout(player.idleTimer);
  player.idleTimer = setTimeout(() => {
    if (player && !player.mini && !player.media.paused && !player.menuOpen && !player.dragging && !player.overControls && player.item.kind !== 'audio') {
      player.stage.classList.add('idle');
    }
  }, 3000);
}

// A short icon or text in the middle of the picture.
function flash(name, text) {
  if (!player?.flashEl || player.mini) return;
  const el = player.flashEl;
  el.replaceChildren(...[name && icon(name), text && h('span', {}, text)].filter(Boolean));
  el.classList.toggle('text-only', !name);
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function togglePlay() {
  const { media } = player;
  if (media.paused || media.ended) media.play();
  else media.pause();
  flash(media.paused ? 'pause' : 'play');
}

function skip(seconds) {
  const { media } = player;
  media.currentTime = clamp(media.currentTime + seconds, 0, media.duration || 0);
  if (player.mini) return;
  const el = player.bubble;
  el.textContent = `${seconds > 0 ? '+' : '−'}${Math.abs(seconds)} s`;
  el.className = `player-bubble ${seconds > 0 ? 'right' : 'left'}`;
  void el.offsetWidth;
  el.classList.add('show');
}

function setVolume(value) {
  const { media } = player;
  media.volume = clamp(value, 0, 1);
  media.muted = media.volume === 0;
}

function changeVolume(delta) {
  const { media } = player;
  setVolume((media.muted ? 0 : media.volume) + delta);
  flash(media.muted ? 'muted' : media.volume < 0.5 ? 'volumeLow' : 'volume', `${Math.round(media.muted ? 0 : media.volume * 100)}%`);
}

function toggleMute() {
  const { media } = player;
  if (media.muted && media.volume === 0) media.volume = 0.5;
  media.muted = !media.muted;
  flash(media.muted ? 'muted' : 'volume');
}

function setSpeed(rate) {
  const { media } = player;
  media.playbackRate = media.defaultPlaybackRate = clamp(Math.round(rate * 100) / 100, 0.25, 4);
}

function changeSpeed(step) {
  const rate = player.media.playbackRate;
  const next = step > 0 ? SPEEDS.find((s) => s > rate + 0.001) : [...SPEEDS].reverse().find((s) => s < rate - 0.001);
  if (next == null) return;
  setSpeed(next);
  flash(null, speedLabel(next));
}

function stepFrame(direction) {
  const { media } = player;
  if (!media.paused) return;
  media.currentTime = clamp(media.currentTime + direction / 30, 0, media.duration || 0);
}

function toggleFullscreen() {
  if (!player || player.item.kind === 'audio') return;
  if (document.fullscreenElement) document.exitFullscreen();
  else player.stage.requestFullscreen();
}

function toggleTheater() {
  if (player.item.kind === 'audio') return;
  const on = !$('#player').classList.contains('theater');
  $('#player').classList.toggle('theater', on);
  state.settings.theater = on;
  api.settings.set({ theater: on });
  updateControls();
  updateTime();
}

// --- Player: picture in picture ---

// The PiP window ({ win, manual, root, ctl, bar, time }), opened by enterPip().
// The video element itself moves there, so the player keeps working as is.
let pip = null;

// Moves the video to another place, in this window or the PiP one. Chromium
// reloads a video that changes windows: put it back where it was.
function moveMedia(place) {
  const { media } = player;
  const from = media.ownerDocument;
  if (media.readyState === 0) return place();
  const time = media.currentTime;
  const playing = !media.paused;
  player.save();
  place();
  if (media.ownerDocument === from) return;
  player.moving = true;
  player.movedAt = Date.now();
  media.addEventListener(
    'loadedmetadata',
    () => {
      media.currentTime = time;
      if (playing) media.play();
    },
    { once: true },
  );
  media.addEventListener('canplay', () => player?.media === media && (player.moving = false), { once: true });
}

// manual: opened with the button, so coming back to the app keeps it open.
function enterPip({ manual = false } = {}) {
  if (pip || !player || player.item.kind === 'audio' || player.media.error) return;
  if (document.fullscreenElement) document.exitFullscreen();
  const win = window.open('about:blank', 'decant-pip');
  if (!win) return;
  pip = { win, manual };
  const doc = win.document;
  doc.documentElement.className = 'pip-window';
  doc.head.append(h('meta', { charset: 'utf-8' }), h('link', { rel: 'stylesheet', href: new URL('styles.css', location.href).href }));
  win.addEventListener('pagehide', () => leavePip());
  // The app shows a placeholder where the video was.
  if (player.mini) minimizePlayer();
  else expandPlayer();
  renderPip();
}

function pipPlaceholder() {
  return h(
    'div',
    { class: 'pip-placeholder' },
    icon('pip'),
    h('div', {}, 'Playing in picture-in-picture'),
    h('button', { class: 'btn small', onclick: () => leavePip() }, 'Bring it back'),
  );
}

function pipButton(name, label, onclick, cls = '') {
  return h('button', { class: `pip-btn ${cls}`, title: label, 'aria-label': label, onclick }, icon(name));
}

// Fills the PiP window for the video playing (again for each playlist item).
function renderPip() {
  const { media, item } = player;
  const doc = pip.win.document;
  doc.title = item.title;
  const c = (pip.ctl = {});
  c.play = pipButton('play', 'Play', togglePlay, 'big filled');
  pip.bar = h('div', { class: 'pip-fill' });
  pip.time = h('span', { class: 'pip-time' });
  pip.captions = h('div', { class: 'captions' });
  const seek = h('div', { class: 'pip-seek' }, h('div', { class: 'pip-track' }, pip.bar));
  const seekTo = (e) => {
    const box = seek.getBoundingClientRect();
    if (media.duration) media.currentTime = clamp((e.clientX - box.left) / box.width, 0, 1) * media.duration;
  };
  seek.addEventListener('pointerdown', (e) => {
    seek.setPointerCapture(e.pointerId);
    seekTo(e);
  });
  seek.addEventListener('pointermove', (e) => seek.hasPointerCapture(e.pointerId) && seekTo(e));
  pip.root = h(
    'div',
    { class: 'pip' },
    pip.captions,
    h(
      'div',
      { class: 'pip-overlay' },
      h(
        'div',
        { class: 'pip-top' },
        h('span', { class: 'pip-title' }, item.title),
        pipButton('expand', 'Back to Decant', () => leavePip({ focus: true })),
        pipButton('close', 'Close', () => leavePip({ pause: true })),
      ),
      h(
        'div',
        { class: 'pip-center' },
        player.queue ? pipButton('prevChapter', 'Previous', previousInQueue, 'filled') : pipButton('back10', 'Back 10 s', () => skip(-10)),
        c.play,
        player.queue ? pipButton('nextChapter', 'Next', () => playAdjacent(1), 'filled') : pipButton('forward10', 'Forward 10 s', () => skip(10)),
      ),
      h('div', { class: 'pip-bottom' }, pip.time, seek),
    ),
  );
  doc.body.replaceChildren(pip.root);
  moveMedia(() => pip.root.prepend(media));
  media.controls = false;
  media.onclick = media.ondblclick = null;
  player.captions = pip.captions;
  applyCaptionStyle();
  renderCaptions();
  const fit = () => media.videoWidth && api.pip.fit(media.videoWidth / media.videoHeight);
  fit();
  media.addEventListener('loadedmetadata', fit, { once: true });
  updatePip();
}

function updatePip() {
  if (!pip?.ctl || !player) return;
  const { media } = player;
  const duration = Number.isFinite(media.duration) ? media.duration : 0;
  pip.bar.style.transform = `scaleX(${duration ? media.currentTime / duration : 0})`;
  pip.time.textContent = `${formatDuration(media.currentTime)} / ${formatDuration(duration)}`;
  setCtl(pip.ctl.play, media.paused ? 'play' : 'pause', media.paused ? 'Play' : 'Pause');
  pip.root.classList.toggle('paused', media.paused);
}

// Brings the video back into the app. pause: the PiP window was closed;
// focus: "Back to Decant" also brings the app to the front.
function leavePip({ pause = false, focus = false } = {}) {
  if (!pip) return;
  const { win } = pip;
  pip = null;
  if (player && player.media.ownerDocument !== document) {
    if (pause) player.media.pause();
    moveMedia(() => (player.mini ? minimizePlayer() : expandPlayer()));
  }
  if (!win.closed) win.close();
  if (focus) api.focusWindow();
}

// Closes the window without bringing the video back (the player is stopping).
function closePip() {
  const { win } = pip;
  pip = null;
  if (!win.closed) win.close();
}

// The app went to the background (another app in front, or minimized) while
// a video plays: it goes on in the PiP window.
function autoPip() {
  if (pip || document.hasFocus() || state.dialog || state.settings.autoPip === false) return;
  if (!player || player.item.kind === 'audio' || player.media.paused) return;
  enterPip();
}

// The mini player, then the library behind it.
function toMini() {
  if (document.fullscreenElement) document.exitFullscreen();
  minimizePlayer();
  selectTab('library');
}

// --- Player: subtitles ---

function setSubtitles(lang, { remember = true } = {}) {
  const { media } = player;
  player.track?.removeEventListener('cuechange', renderCaptions);
  player.track = null;
  for (const t of media.textTracks) {
    const pick = Boolean(lang) && t.language === lang;
    t.mode = pick ? 'hidden' : 'disabled';
    if (pick) player.track = t;
  }
  player.track?.addEventListener('cuechange', renderCaptions);
  renderCaptions();
  updateControls();
  if (remember) {
    state.settings.subtitleLang = lang || '';
    api.settings.set({ subtitleLang: lang || '' });
  }
}

function toggleSubtitles() {
  const tracks = [...player.media.textTracks];
  if (!tracks.length) return;
  if (player.track) {
    setSubtitles('');
    flash('captions', 'Subtitles off');
    return;
  }
  const own = navigator.language.split('-')[0];
  const track = tracks.find((t) => t.language === own) || tracks[0];
  setSubtitles(track.language);
  flash('captions', track.label);
}

function renderCaptions() {
  if (!player?.captions) return;
  const cues = player.track ? [...(player.track.activeCues || [])] : [];
  // getCueAsHTML() parses WebVTT markup (italics, colors) into safe nodes.
  player.captions.replaceChildren(...cues.map((cue) => h('span', { class: 'cue' }, cue.getCueAsHTML ? cue.getCueAsHTML() : cue.text)));
}

function captionStyle() {
  return { ...CAPTION_DEFAULTS, ...state.settings.captionStyle };
}

function setCaptionStyle(patch) {
  const style = { ...captionStyle(), ...patch };
  state.settings.captionStyle = style;
  api.settings.set({ captionStyle: style });
  applyCaptionStyle();
}

function applyCaptionStyle() {
  if (!player?.captions) return;
  const s = captionStyle();
  const n = parseInt(s.background.slice(1), 16);
  const el = player.captions;
  el.style.setProperty('--cap-scale', s.size);
  el.style.setProperty('--cap-color', s.color);
  el.style.setProperty('--cap-bg', `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${s.opacity * 100}%)`);
  el.dataset.font = s.font;
}

function changeCaptionSize(step) {
  const sizes = CAPTION_SIZES;
  const i = clamp(sizes.indexOf(captionStyle().size) + step, 0, sizes.length - 1);
  setCaptionStyle({ size: sizes[i] });
  flash(null, `Subtitle size ${sizes[i] * 100}%`);
}

function cycleCaptionBackground() {
  const list = CAPTION_OPACITIES;
  const next = list[(list.indexOf(captionStyle().opacity) + 1) % list.length];
  setCaptionStyle({ opacity: next });
  flash(null, `Subtitle background ${next * 100}%`);
}

// --- Player: settings menu ---

function openMenu(panel) {
  player.menuOpen = true;
  player.menu.hidden = false;
  player.ctl.settings.classList.add('on');
  renderMenu(panel);
  poke();
}

function closeMenu() {
  if (!player?.menu) return;
  player.menuOpen = false;
  player.menu.hidden = true;
  player.ctl.settings.classList.remove('on');
}

function renderMenu(name) {
  const { media } = player;
  const tracks = [...media.textTracks];
  const style = captionStyle();
  const labelOf = (list, value) => list.find(([v]) => v === value)?.[1] || '';
  const swatch = (color) => h('span', { class: 'swatch', style: `background: ${color}` });
  const choices = (title, list, current, key, extra) => ({
    title,
    back: 'style',
    rows: list.map(([value, label]) => ({
      label,
      lead: extra?.(value),
      checked: value === current,
      pick: () => setCaptionStyle({ [key]: value }),
    })),
  });
  const panels = {
    main: {
      rows: [
        { label: 'Speed', value: speedLabel(media.playbackRate), go: 'speed' },
        tracks.length ? { label: 'Subtitles', value: player.track ? player.track.label : 'Off', go: 'subtitles' } : null,
        tracks.length ? { label: 'Subtitle style', go: 'style' } : null,
        player.item.kind !== 'audio'
          ? {
              label: 'Auto picture-in-picture',
              value: state.settings.autoPip === false ? 'Off' : 'On',
              stay: true,
              pick: () => {
                state.settings.autoPip = state.settings.autoPip === false;
                api.settings.set({ autoPip: state.settings.autoPip });
              },
            }
          : null,
        { label: 'Keyboard shortcuts', value: '?', pick: () => toggleHelp(true) },
      ].filter(Boolean),
    },
    speed: {
      title: 'Speed',
      back: 'main',
      custom: true,
      rows: SPEEDS.map((s) => ({ label: speedLabel(s), checked: Math.abs(media.playbackRate - s) < 0.001, pick: () => setSpeed(s) })),
    },
    subtitles: {
      title: 'Subtitles',
      back: 'main',
      rows: [
        { label: 'Off', checked: !player.track, pick: () => setSubtitles('') },
        ...tracks.map((t) => ({ label: t.label, checked: player.track === t, pick: () => setSubtitles(t.language) })),
      ],
    },
    style: {
      title: 'Subtitle style',
      back: 'main',
      rows: [
        { label: 'Size', value: `${style.size * 100}%`, go: 'size' },
        { label: 'Font', value: labelOf(CAPTION_FONTS, style.font), go: 'font' },
        { label: 'Text color', value: labelOf(CAPTION_COLORS, style.color), go: 'color' },
        { label: 'Background', value: labelOf(CAPTION_COLORS, style.background), go: 'background' },
        { label: 'Background opacity', value: `${style.opacity * 100}%`, go: 'opacity' },
        { label: 'Reset', pick: () => setCaptionStyle(CAPTION_DEFAULTS), stay: true },
      ],
    },
    size: choices('Size', CAPTION_SIZES.map((s) => [s, `${s * 100}%`]), style.size, 'size'),
    font: choices('Font', CAPTION_FONTS, style.font, 'font'),
    color: choices('Text color', CAPTION_COLORS, style.color, 'color', swatch),
    background: choices('Background', CAPTION_COLORS, style.background, 'background', swatch),
    opacity: choices('Background opacity', CAPTION_OPACITIES.map((o) => [o, `${o * 100}%`]), style.opacity, 'opacity'),
  };
  const panel = panels[name];
  const row = (r) =>
    h(
      'button',
      {
        class: 'menu-row',
        onmousedown: (e) => e.preventDefault(),
        onclick: () => {
          if (r.go) return renderMenu(r.go);
          r.pick();
          if (player?.menuOpen && player.help.hidden) renderMenu(r.stay ? name : panel.back || name);
          else closeMenu();
        },
      },
      'checked' in r ? h('span', { class: 'menu-check' }, r.checked ? icon('check') : null) : null,
      r.lead || null,
      h('span', { class: 'menu-label' }, r.label),
      r.value ? h('span', { class: 'menu-value' }, r.value) : null,
      r.go ? icon('chevron') : null,
    );
  let custom = null;
  if (panel.custom) {
    const label = h('span', { class: 'menu-value' }, speedLabel(media.playbackRate));
    custom = h(
      'label',
      { class: 'menu-custom' },
      h('span', {}, 'Custom'),
      h('input', {
        type: 'range',
        min: 0.25,
        max: 4,
        step: 0.05,
        value: media.playbackRate,
        oninput: (e) => {
          setSpeed(Number(e.target.value));
          label.textContent = speedLabel(media.playbackRate);
        },
        onchange: (e) => e.target.blur(),
      }),
      label,
    );
  }
  const head = panel.title
    ? h('button', { class: 'menu-head', onmousedown: (e) => e.preventDefault(), onclick: () => renderMenu(panel.back) }, icon('back'), panel.title)
    : null;
  player.menu.replaceChildren(...[head, custom].filter(Boolean), ...panel.rows.map(row));
}

function toggleHelp(show = player.help.hidden) {
  player.help.hidden = !show;
  if (show) closeMenu();
}

// --- Player: mini player ---

function minimizePlayer() {
  const { item, media } = player;
  const expand = () => expandPlayer();
  clearTimeout(player.idleTimer);
  player.mini = true;
  player.menuOpen = false;
  media.controls = false;
  media.onclick = media.ondblclick = null;
  player.toggle = iconButton('play', 'Play', () => (media.paused ? media.play() : media.pause()));
  player.miniBar = h('div');
  player.miniSub = h('div', { class: 'mini-sub' });
  // An <audio> stays in the page (hidden) or it would stop.
  $('#mini-player').replaceChildren(
    h(
      'div',
      {
        class: 'mini-progress',
        onclick: (e) => {
          const box = e.currentTarget.getBoundingClientRect();
          if (media.duration) media.currentTime = ((e.clientX - box.left) / box.width) * media.duration;
        },
      },
      player.miniBar,
    ),
    h('div', { class: 'mini-art', onclick: expand }, item.kind === 'audio' ? thumb(coverUrl(item)) : null, pip ? h('div', { class: 'mini-pip' }, icon('pip')) : media),
    h('div', { class: 'mini-text', onclick: expand }, h('div', { class: 'mini-title' }, item.title), player.miniSub),
    h('div', { class: 'row-actions' }, player.toggle, iconButton('expand', 'Open player', expand), iconButton('close', 'Stop', stopPlayer)),
  );
  $('#mini-player').hidden = false;
  $('#player').replaceChildren();
  $('#player').hidden = true;
  player.chapter = null;
  updatePlayState();
  updateTime();
}

function stopPlayer({ keepPip = false } = {}) {
  if (!player) return;
  const { media, save, listeners } = player;
  if (document.fullscreenElement) document.exitFullscreen();
  if (pip && !keepPip) closePip();
  if (media.currentTime && !media.ended) save();
  listeners.abort();
  clearTimeout(player.idleTimer);
  player.track?.removeEventListener('cuechange', renderCaptions);
  media.pause();
  media.removeAttribute('src');
  media.load();
  player = null;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  for (const id of ['#player', '#mini-player']) {
    $(id).replaceChildren();
    $(id).hidden = true;
  }
}

// Leaving the full player: keep playing in the mini player, or stop if paused.
function leavePlayer() {
  if (document.fullscreenElement) document.exitFullscreen();
  if (player.media.paused) stopPlayer();
  else minimizePlayer();
}

function updatePlayState() {
  if (!player?.mini) return;
  const paused = player.media.paused;
  player.toggle.replaceChildren(icon(paused ? 'play' : 'pause'));
  player.toggle.title = paused ? 'Play' : 'Pause';
  player.toggle.setAttribute('aria-label', player.toggle.title);
}

// --- Player: keyboard ---

function onPlayerKey(e) {
  if (!player || player.mini || e.metaKey || e.target.matches('input:not([type="range"]), select, textarea')) return;
  const { media } = player;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // Chapters: ⌥ ←/→ on a Mac, Ctrl ←/→ elsewhere (either works).
  const chapterKey = (e.altKey || e.ctrlKey) && (key === 'ArrowLeft' || key === 'ArrowRight');
  if ((e.altKey || e.ctrlKey) && !chapterKey) return;

  if (key === 'Escape') {
    if (!player.help.hidden) toggleHelp(false);
    else if (player.menuOpen) closeMenu();
    else if (!document.fullscreenElement) selectTab('library');
  } else if (chapterKey) seekChapter(key === 'ArrowLeft' ? -1 : 1);
  else if (e.shiftKey && key === 'n') playAdjacent(1);
  else if (e.shiftKey && key === 'p') previousInQueue();
  else if (key === ' ' || key === 'k') togglePlay();
  else if (key === 'j') skip(-10);
  else if (key === 'l') skip(10);
  else if (key === 'ArrowLeft') skip(-5);
  else if (key === 'ArrowRight') skip(5);
  else if (key === 'ArrowUp') changeVolume(0.05);
  else if (key === 'ArrowDown') changeVolume(-0.05);
  else if (key === 'm') toggleMute();
  else if (key === 'f') toggleFullscreen();
  else if (key === 't') toggleTheater();
  else if (key === 'i') toMini();
  else if (key === 'c') toggleSubtitles();
  else if (key === '+' || key === '=') changeCaptionSize(1);
  else if (key === '-') changeCaptionSize(-1);
  else if (key === 'b') cycleCaptionBackground();
  else if (key === '<') changeSpeed(-1);
  else if (key === '>') changeSpeed(1);
  else if (key === ',') stepFrame(-1);
  else if (key === '.') stepFrame(1);
  else if (/^[0-9]$/.test(key) && media.duration) media.currentTime = (media.duration * Number(key)) / 10;
  else if (key === 'Home') media.currentTime = 0;
  else if (key === 'End' && media.duration) media.currentTime = Math.max(0, media.duration - 0.1);
  else if (key === '?') toggleHelp();
  else return;
  e.preventDefault();
  poke();
}

// Media keys and the system's Now Playing controls.
function setupMediaKeys() {
  if (!('mediaSession' in navigator)) return;
  const on = (action, fn) => navigator.mediaSession.setActionHandler(action, (details) => player && fn(player.media, details));
  on('play', (media) => media.play());
  on('pause', (media) => media.pause());
  on('seekbackward', (media) => (media.currentTime -= 10));
  on('seekforward', (media) => (media.currentTime += 10));
  on('seekto', (media, details) => (media.currentTime = details.seekTime));
  on('stop', () => stopPlayer());
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
  if (player && !player.mini) leavePlayer();
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
  state.speed = 1;
  renderDestination();

  for (const job of await api.queue.list()) state.jobs.set(job.id, job);
  renderQueue();
  api.queue.onUpdate(updateJob);
  api.queue.onRemoved((id) => {
    state.jobs.delete(id);
    renderQueue();
  });

  applyLibrary(await api.library.list());
  api.library.onUpdate(applyLibrary);
  $('#library-search').addEventListener('input', (e) => {
    state.librarySearch = e.target.value;
    renderLibrary();
  });
  document.addEventListener('keydown', onPlayerKey);
  setupMediaKeys();
  window.addEventListener('beforeunload', () => player && player.save());
  window.addEventListener('resize', () => player && updateTime());
  window.addEventListener('blur', () => setTimeout(autoPip, 200));
  window.addEventListener('focus', () => pip && !pip.manual && leavePip());
  document.addEventListener('fullscreenchange', () => {
    if (!player || player.mini) return;
    updateControls();
    updateTime();
    poke();
  });

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
