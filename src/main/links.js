// decant:// links, which the browser extension (or any page) opens to hand
// Decant a video:
//
//   decant://open?url=<link>             show the link, ready to download
//   decant://save?url=<link>             save it straight to the library
//   ...&only=<id>,<id>                   for a playlist: just these videos
//
// What such a link may carry is kept narrow: it comes from outside the app.
const SCHEME = 'decant';
const ACTIONS = ['open', 'save'];
const MAX_URL = 4096;
const MAX_ONLY = 5000;

// The action, link and picked videos in a decant:// URL, or null if it is not a valid one.
function parseDecantUrl(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_URL + MAX_ONLY * 70) return null;
  let link;
  try {
    link = new URL(raw.trim());
  } catch {
    return null;
  }
  if (link.protocol !== `${SCHEME}:`) return null;
  // "decant://open?…", and "decant:open?…" or "decant://open/?…" as some systems rewrite it.
  const action = (link.host || link.pathname).replace(/^\/+|\/+$/g, '').toLowerCase() || 'open';
  if (!ACTIONS.includes(action)) return null;
  const url = (link.searchParams.get('url') || '').trim();
  if (!url || url.length > MAX_URL || !/^https?:\/\/[^\s/]+/i.test(url)) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  const only = (link.searchParams.get('only') || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[\w-]{1,64}$/.test(id))
    .slice(0, MAX_ONLY);
  return { action, url, only: only.length ? [...new Set(only)] : null };
}

// The decant:// URL among command-line arguments (Windows and Linux pass it there).
function findDecantUrl(argv = []) {
  return argv.find((arg) => typeof arg === 'string' && arg.toLowerCase().startsWith(`${SCHEME}:`)) || null;
}

module.exports = { SCHEME, parseDecantUrl, findDecantUrl };
