// What the extension knows about links: building the decant:// link that
// hands a video to the app, and reading YouTube links. Loaded by the
// background worker, the YouTube page script and the tests (Node).
(function (root) {
  const YOUTUBE = 'https://www.youtube.com';
  const VIDEO_ID = /^[\w-]{11}$/;
  const LIST_ID = /^[\w-]{2,64}$/;

  // decant://open?url=… shows the link in Decant, decant://save?url=… saves it
  // to the library. `only` picks videos of a playlist by id.
  // `playlist` asks Decant to read the link as a playlist.
  function decantUrl(action, url, { playlist = false, only = null } = {}) {
    const params = new URLSearchParams({ url });
    if (playlist) params.set('playlist', '1');
    if (only && only.length) params.set('only', only.join(','));
    return `decant://${action === 'save' ? 'save' : 'open'}?${params}`;
  }

  const videoUrl = (id) => `${YOUTUBE}/watch?v=${id}`;
  // A mix ("RD…") only exists around a video, other playlists stand alone.
  const playlistUrl = (list, video = null) => (/^RD/.test(list) && video ? `${videoUrl(video)}&list=${list}` : `${YOUTUBE}/playlist?list=${list}`);

  // A YouTube link -> { video, list, shorts } (each may be null), or null when
  // it points to neither a video nor a playlist.
  function parseYoutube(href, base = YOUTUBE) {
    let url;
    try {
      url = new URL(href, base);
    } catch {
      return null;
    }
    if (!/(^|\.)youtube\.com$/i.test(url.hostname) && !/^youtu\.be$/i.test(url.hostname)) return null;
    const list = url.searchParams.get('list');
    const result = { video: null, list: list && LIST_ID.test(list) ? list : null, shorts: false };
    const shorts = /^\/shorts\/([\w-]{11})/.exec(url.pathname);
    if (/^youtu\.be$/i.test(url.hostname)) result.video = url.pathname.slice(1, 12);
    else if (url.pathname === '/watch') result.video = url.searchParams.get('v');
    else if (shorts) Object.assign(result, { video: shorts[1], shorts: true });
    else if (url.pathname !== '/playlist') return null;
    if (result.video && !VIDEO_ID.test(result.video)) result.video = null;
    return result.video || result.list ? result : null;
  }

  // The tidy link Decant gets for a page or link: YouTube links lose their
  // tracking and timing bits, other http(s) links go as they are.
  function linkFor(href) {
    const yt = parseYoutube(href);
    if (yt) {
      if (yt.shorts) return `${YOUTUBE}/shorts/${yt.video}`;
      if (yt.video) return yt.list ? `${videoUrl(yt.video)}&list=${yt.list}` : videoUrl(yt.video);
      return playlistUrl(yt.list);
    }
    return /^https?:\/\//i.test(href || '') ? href : null;
  }

  const api = { decantUrl, videoUrl, playlistUrl, parseYoutube, linkFor };
  root.Decant = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
