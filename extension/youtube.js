// On YouTube: a "Send to Decant" button over thumbnails and on the video page,
// and on a playlist page a bar to send the whole playlist or pick videos by
// ticking them on the page.
//
// YouTube changes its markup often, so this leans on what lasts: links to
// /watch, /shorts and /playlist that hold a thumbnail. Everything drawn here
// lives in shadow roots, out of reach of YouTube's styles.
(() => {
  const D = globalThis.Decant;
  const t = (name, sub) => chrome.i18n.getMessage(name, sub == null ? undefined : String(sub)) || name;
  const RELEASES = 'https://github.com/m1shko/decant/releases/latest';
  const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 6h22l-8.5 11v7.5L13.5 27V17z"/></svg>';
  const THUMB = 'img, yt-image, yt-thumbnail-view-model, ytd-thumbnail, yt-collection-thumbnail-view-model';
  const PLAYLIST_ITEM =
    'ytd-playlist-renderer, ytd-grid-playlist-renderer, ytd-compact-playlist-renderer, ytd-radio-renderer, ytd-compact-radio-renderer, ytd-grid-radio-renderer';
  const ROW = 'yt-lockup-view-model, ytd-playlist-video-renderer';
  const HEADER = 'yt-page-header-view-model, ytd-playlist-header-renderer, #header';

  let prefs = { action: 'open', thumbnails: true };
  chrome.storage.sync.get(prefs).then((saved) => {
    prefs = { ...prefs, ...saved };
    refresh();
  });
  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, { newValue }] of Object.entries(changes)) prefs[key] = newValue;
    hideHover();
    refresh(true);
  });

  const el = (html) => {
    const box = document.createElement('template');
    box.innerHTML = html.trim();
    return box.content.firstElementChild;
  };
  const otherAction = () => (prefs.action === 'save' ? 'open' : 'save');
  const altHint = () => (prefs.action === 'save' ? t('altOpen') : t('altSave'));

  // --- Sending ------------------------------------------------------------------

  // target: { kind: 'video' | 'playlist', url }. Opening the decant:// link
  // hands it to the app; the page stays where it is.
  function send(target, { alt = false, only = null } = {}) {
    const action = alt ? otherAction() : prefs.action;
    location.href = D.decantUrl(action, target.url, { playlist: target.kind === 'playlist', only });
    toast(only ? t('toastSentMany', only.length) : action === 'save' ? t('toastSaved') : t('toastSent'));
  }

  // --- Our layer: hover button, playlist bar, toast -----------------------------

  const CSS = `
    :host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;
      font: 500 13px/1.3 Roboto, Arial, sans-serif; --accent: #6d4aff; --accent-hover: #5a37f0;
      --bg: #ffffff; --fg: #0f0f0f; --muted: #606060; --soft: rgba(0, 0, 0, 0.06); --line: rgba(0, 0, 0, 0.1); }
    :host([data-theme='dark']) { --bg: #282828; --fg: #f1f1f1; --muted: #aaaaaa; --soft: rgba(255, 255, 255, 0.1); --line: rgba(255, 255, 255, 0.12); }
    [hidden] { display: none !important; }
    button { font: inherit; color: inherit; cursor: pointer; border: 0; }
    button:disabled { opacity: 0.45; cursor: default; }
    svg { width: 14px; height: 14px; fill: currentColor; flex: none; }
    .pill { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px 0 10px; border-radius: 999px;
      background: var(--accent); color: #fff; white-space: nowrap; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }
    .pill:hover:not(:disabled) { background: var(--accent-hover); }
    .pill.icon { width: 28px; padding: 0; justify-content: center; }
    .hover { position: fixed; pointer-events: auto; }
    .bar { position: fixed; right: 24px; bottom: 24px; pointer-events: auto; display: flex; align-items: center; gap: 8px;
      padding: 6px 6px 6px 14px; border-radius: 999px; background: var(--bg); color: var(--fg);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25); border: 1px solid var(--line); }
    .bar .brand { display: flex; align-items: center; gap: 6px; color: var(--accent); font-weight: 700; }
    .bar .count { color: var(--muted); min-width: 7em; }
    .bar .plain { height: 28px; padding: 0 12px; border-radius: 999px; background: var(--soft); white-space: nowrap; }
    .bar .plain:hover:not(:disabled) { filter: brightness(0.95); }
    .bar .close { width: 28px; padding: 0; font-size: 18px; line-height: 28px; }
    .toast { position: fixed; left: 24px; bottom: 24px; max-width: 360px; pointer-events: auto; display: flex; gap: 10px;
      padding: 12px 16px; border-radius: 12px; background: var(--bg); color: var(--fg);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25); border: 1px solid var(--line); }
    .toast svg { width: 18px; height: 18px; color: var(--accent); margin-top: 1px; }
    .toast .hint { margin-top: 4px; color: var(--muted); font-weight: 400; font-size: 12px; }
    .toast a { color: var(--accent); }
  `;

  const host = document.createElement('decant-layer');
  const layer = host.attachShadow({ mode: 'open' });
  layer.innerHTML = `<style>${CSS}</style>`;
  const hoverBtn = layer.appendChild(el(`<button class="pill hover" hidden></button>`));
  const bar = layer.appendChild(el(`<div class="bar" hidden></div>`));
  const toastBox = layer.appendChild(el(`<div class="toast" role="status" hidden></div>`));
  document.documentElement.append(host);

  let toastTimer = null;
  function toast(text) {
    toastBox.innerHTML = `${LOGO}<div><div class="title"></div><div class="hint"></div></div>`;
    toastBox.querySelector('.title').textContent = text;
    const hint = toastBox.querySelector('.hint');
    hint.append(`${t('toastHint')} `, Object.assign(document.createElement('a'), { href: RELEASES, target: '_blank', rel: 'noopener', textContent: t('getDecant') }));
    toastBox.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastBox.hidden = true), 6000);
  }
  toastBox.addEventListener('mouseenter', () => clearTimeout(toastTimer));
  toastBox.addEventListener('mouseleave', () => (toastTimer = setTimeout(() => (toastBox.hidden = true), 2000)));

  // --- Button over thumbnails ---------------------------------------------------

  // What a thumbnail link points to, or null if it is not one.
  function thumbnailTarget(a) {
    if (a.closest('#movie_player, decant-watch') || (!a.querySelector(THUMB) && a.id !== 'thumbnail')) return null;
    const rect = a.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 50) return null;
    const yt = D.parseYoutube(a.getAttribute('href'));
    if (!yt) return null;
    // Playlists and mixes show a stack of thumbnails; a plain video link may
    // carry a list too (a mix to play next), it is still one video.
    const stack = a.querySelector('yt-collection-thumbnail-view-model, yt-collections-stack') || a.closest(PLAYLIST_ITEM);
    if (yt.list && (stack || !yt.video)) return { kind: 'playlist', url: D.playlistUrl(yt.list, yt.video) };
    if (yt.video) return { kind: 'video', url: yt.shorts ? `https://www.youtube.com/shorts/${yt.video}` : D.videoUrl(yt.video) };
    return null;
  }

  let hovered = null; // { anchor, target }
  let hideTimer = null;

  function placeHover() {
    if (!hovered) return;
    const rect = hovered.anchor.getBoundingClientRect();
    if (!hovered.anchor.isConnected || rect.width === 0) return hideHover();
    hoverBtn.style.left = `${Math.round(rect.left + 8)}px`;
    hoverBtn.style.top = `${Math.round(rect.top + 8)}px`;
  }

  function showHover(anchor, target) {
    clearTimeout(hideTimer);
    if (hovered?.anchor !== anchor) {
      hovered = { anchor, target };
      const small = anchor.getBoundingClientRect().width < 200;
      const label = target.kind === 'playlist' ? t('sendPlaylist') : t('sendVideo');
      hoverBtn.className = `pill hover${small ? ' icon' : ''}`;
      hoverBtn.innerHTML = LOGO;
      if (!small) hoverBtn.append(label);
      hoverBtn.title = `${target.kind === 'playlist' ? t('sendPlaylistLong') : t('sendVideo')}\n${altHint()}`;
      hoverBtn.setAttribute('aria-label', label);
    }
    placeHover();
    hoverBtn.hidden = false;
  }

  function hideHover() {
    clearTimeout(hideTimer);
    hovered = null;
    hoverBtn.hidden = true;
  }
  const hideSoon = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideHover, 150);
  };

  document.addEventListener(
    'mouseover',
    (e) => {
      if (e.composedPath().includes(host)) return clearTimeout(hideTimer);
      if (!prefs.thumbnails || picking) return hovered && hideSoon();
      const node = e.target instanceof Element ? e.target : null;
      // The preview YouTube plays over a hovered thumbnail is not inside its link.
      if (hovered && node?.closest('ytd-video-preview, #video-preview, #inline-preview-player')) return clearTimeout(hideTimer);
      const anchor = node?.closest('a[href]');
      const target = anchor && thumbnailTarget(anchor);
      if (target) showHover(anchor, target);
      else if (hovered) hideSoon();
    },
    { capture: true, passive: true },
  );
  document.addEventListener('scroll', () => requestAnimationFrame(placeHover), { capture: true, passive: true });
  hoverBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (hovered) send(hovered.target, { alt: e.altKey });
    hideHover();
  });

  // --- Buttons on the video page ------------------------------------------------

  const WATCH_CSS = `
    :host { display: flex; align-items: center; gap: 8px; margin-left: 12px; flex: none; }
    [hidden] { display: none !important; }
    button { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px 0 12px; border: 0; border-radius: 18px;
      font: 500 14px/36px Roboto, Arial, sans-serif; white-space: nowrap; cursor: pointer;
      background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05)); color: var(--yt-spec-text-primary, #0f0f0f); }
    button:hover { background: var(--yt-spec-button-chip-background-hover, rgba(0, 0, 0, 0.1)); }
    svg { width: 18px; height: 18px; fill: #6d4aff; }
  `;

  function watchTarget() {
    if (location.pathname !== '/watch') return null;
    const yt = D.parseYoutube(location.href);
    return yt?.video ? yt : null;
  }

  function renderWatchButtons() {
    const yt = watchTarget();
    // Next to "Subscribe", where there is room; the like and share buttons
    // on the right would wrap to a second line.
    const owner = yt && document.querySelector('ytd-watch-metadata #owner');
    const current = document.querySelector('decant-watch');
    if (!owner) return current?.remove();
    const key = [yt.video, yt.list, prefs.action, chrome.i18n.getUILanguage()].join('|');
    if (current && current.parentElement === owner && current.dataset.key === key) return;
    current?.remove();
    const box = document.createElement('decant-watch');
    box.dataset.key = key;
    const root = box.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${WATCH_CSS}</style>`;
    const button = (label, title, target) => {
      const b = root.appendChild(el(`<button type="button">${LOGO}</button>`));
      b.append(label);
      b.title = `${title}\n${altHint()}`;
      b.addEventListener('click', (e) => send(target, { alt: e.altKey }));
    };
    button(t('sendVideo'), t('sendVideo'), { kind: 'video', url: D.videoUrl(yt.video) });
    if (yt.list) button(t('playlist'), t('sendPlaylistLong'), { kind: 'playlist', url: D.playlistUrl(yt.list, yt.video) });
    owner.append(box);
  }

  // --- Playlist page: send it all, or pick videos -------------------------------

  let picking = null; // { list, picked: Set<videoId>, last: videoId }

  function playlistOnPage() {
    if (location.pathname !== '/playlist') return null;
    const list = new URL(location.href).searchParams.get('list');
    return list && /^[\w-]{2,64}$/.test(list) ? list : null;
  }

  // The playlist's videos on the page: Map videoId -> { row, thumb }.
  function playlistRows(list) {
    const page = document.querySelector('ytd-browse[page-subtype="playlist"]:not([hidden])') || document;
    const rows = new Map();
    for (const a of page.querySelectorAll('a[href*="/watch?"]')) {
      if (!a.querySelector(THUMB) || a.closest(HEADER)) continue;
      const yt = D.parseYoutube(a.getAttribute('href'));
      if (!yt?.video || yt.list !== list || rows.has(yt.video)) continue;
      rows.set(yt.video, { row: a.closest(ROW) || a.parentElement, thumb: a });
    }
    return rows;
  }

  function decorateRows() {
    if (!picking) return;
    for (const [id, { row, thumb }] of playlistRows(picking.list)) {
      row.classList.add('decant-row');
      row.dataset.decantId = id;
      row.classList.toggle('decant-picked', picking.picked.has(id));
      if (!thumb.querySelector(':scope > decant-check')) {
        thumb.classList.add('decant-thumb');
        thumb.append(document.createElement('decant-check'));
      }
    }
  }

  function undecorateRows() {
    for (const check of document.querySelectorAll('decant-check')) check.remove();
    for (const row of document.querySelectorAll('.decant-row')) {
      row.classList.remove('decant-row', 'decant-picked');
      delete row.dataset.decantId;
    }
    for (const thumb of document.querySelectorAll('.decant-thumb')) thumb.classList.remove('decant-thumb');
  }

  function startPicking(list) {
    picking = { list, picked: new Set(), last: null };
    hideHover();
    decorateRows();
    renderBar();
  }

  function stopPicking() {
    picking = null;
    undecorateRows();
    renderBar();
  }

  function toggleRow(id, range) {
    const { picked } = picking;
    const select = !picked.has(id);
    let ids = [id];
    if (range && picking.last) {
      const order = [...playlistRows(picking.list).keys()];
      const [a, b] = [order.indexOf(picking.last), order.indexOf(id)].sort((x, y) => x - y);
      if (a !== -1) ids = order.slice(a, b + 1);
    }
    for (const each of ids) select ? picked.add(each) : picked.delete(each);
    picking.last = id;
    decorateRows();
    renderBar();
  }

  // While picking, a click on a video ticks it instead of playing it.
  window.addEventListener(
    'click',
    (e) => {
      if (!picking || e.composedPath().includes(host)) return;
      const row = e.target instanceof Element && e.target.closest('.decant-row');
      if (!row || e.target.closest('button, yt-icon-button, ytd-menu-renderer, [role="button"]:not(a)')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleRow(row.dataset.decantId, e.shiftKey);
    },
    true,
  );
  document.addEventListener('keydown', (e) => e.key === 'Escape' && picking && stopPicking());

  function barButton(cls, label, onclick, { title, disabled } = {}) {
    const b = el(`<button type="button" class="${cls}"></button>`);
    b.textContent = label;
    if (title) b.title = title;
    b.disabled = Boolean(disabled);
    b.addEventListener('click', onclick);
    return b;
  }

  function renderBar() {
    const list = playlistOnPage();
    if (picking && picking.list !== list) {
      picking = null;
      undecorateRows();
    }
    bar.hidden = !list;
    if (!list) return;
    const brand = el(`<span class="brand">${LOGO}Decant</span>`);
    if (!picking) {
      const sendAll = barButton('pill', t('sendPlaylist'), (e) => send({ kind: 'playlist', url: D.playlistUrl(list) }, { alt: e.altKey }), {
        title: `${t('sendPlaylistLong')}\n${altHint()}`,
      });
      sendAll.prepend(el(LOGO));
      bar.replaceChildren(brand, barButton('plain', t('pickVideos'), () => startPicking(list), { title: t('pickHint') }), sendAll);
      return;
    }
    const count = picking.picked.size;
    const sendPicked = barButton(
      'pill',
      t('sendPicked', count),
      (e) => {
        const only = [...picking.picked];
        send({ kind: 'playlist', url: D.playlistUrl(list) }, { alt: e.altKey, only });
        stopPicking();
      },
      { disabled: !count, title: altHint() },
    );
    bar.replaceChildren(
      brand,
      el(`<span class="count"></span>`),
      barButton('plain', t('selectAll'), () => {
        for (const id of playlistRows(list).keys()) picking.picked.add(id);
        decorateRows();
        renderBar();
      }),
      barButton('plain', t('selectNone'), () => {
        picking.picked.clear();
        decorateRows();
        renderBar();
      }, { disabled: !count }),
      sendPicked,
      barButton('plain close', '×', stopPicking, { title: t('cancel') }),
    );
    bar.querySelector('.count').textContent = count ? t('pickedCount', count) : t('pickHint');
  }

  // --- Keeping up with YouTube, a single-page app -------------------------------

  let lastRoute = null;
  let pending = false;

  function refresh(force = false) {
    host.dataset.theme = document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
    if (!host.isConnected) document.documentElement.append(host);
    const route = location.pathname + location.search;
    if (force || route !== lastRoute) {
      lastRoute = route;
      hideHover();
      renderBar();
    }
    renderWatchButtons();
    decorateRows();
  }

  // YouTube redraws parts of the page all the time: catch up, at most a few times a second.
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      refresh();
    }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['dark'] });
  document.addEventListener('yt-navigate-finish', () => refresh());
  refresh();
})();
