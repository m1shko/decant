// Auto cleanup of the library: a video you finish moves to "To delete", then
// is deleted once the delay set in Settings has passed. Pure functions over
// the library's items and playlists, so they can be tested without Electron.
//
// On items:      finishedAt  when it was watched to the end
//                keep        never deleted automatically
//                trashedAt   when it moved to "To delete"
//                trashedWith the playlist it moved there with
// On playlists:  trashedAt   when all of it was watched
const DAY = 24 * 60 * 60 * 1000;
const DELAYS = [0, 1, 3, 7, 14, 30];

// Watched to the end: less than 30 s left, or for short videos less than
// 10 % of them (at least 5 s, at most half): a 40 s Short is not watched
// after 10 s.
function isFinished(position, duration) {
  if (!(duration > 0) || !Number.isFinite(position)) return false;
  return position >= duration - Math.min(30, Math.max(5, duration * 0.1), duration / 2);
}

function delayMs(prefs) {
  const days = Number(prefs.cleanupDelayDays);
  return (DELAYS.includes(days) ? days : 7) * DAY;
}

// What may go to "To delete": watched, not kept, and a video (songs only if
// asked for: they are played again).
const eligible = (item, prefs) => Boolean(item.finishedAt) && !item.keep && (item.kind !== 'audio' || Boolean(prefs.cleanupAudio));

const clean = (item) => {
  const { trashedAt, trashedWith, ...rest } = item;
  return rest;
};

// Back from "To delete": as if never watched, so it does not go right back.
function restoreItem(item) {
  const { finishedAt, ...rest } = clean(item);
  return { ...rest, position: 0 };
}

// Moves what was watched to "To delete" and lists what is due for deletion.
// A video in a playlist waits for the whole playlist: once every video of it
// is watched, the playlist goes, with its videos. `playing` is never deleted.
// Returns { items, playlists, deleted: [item ids], changed }.
function sweep({ items, playlists }, prefs, now, { playing = null } = {}) {
  const byId = new Map(items.map((i) => [i.id, { ...i }]));
  let lists = playlists.map((p) => ({ ...p }));
  let changed = false;
  const set = (item, patch) => {
    Object.assign(item, patch);
    changed = true;
  };

  // Turned off: nothing waits to be deleted any more.
  if (!prefs.autoCleanup) {
    for (const item of byId.values()) if (item.trashedAt) byId.set(item.id, clean(item)), (changed = true);
    lists = lists.map((p) => {
      if (!p.trashedAt) return p;
      changed = true;
      const { trashedAt, ...rest } = p;
      return rest;
    });
    return { items: items.map((i) => byId.get(i.id)), playlists: lists, deleted: [], changed };
  }

  // Whole playlists watched.
  for (const list of lists) {
    if (list.trashedAt || !list.entries.length) continue;
    const members = list.entries.map((e) => byId.get(e.id));
    if (members.some((m) => !m?.finishedAt)) continue;
    if (!members.some((m) => eligible(m, prefs))) continue;
    set(list, { trashedAt: now });
    for (const m of members) if (eligible(m, prefs) && !m.trashedAt) set(m, { trashedAt: now, trashedWith: list.id });
  }

  // Single videos, unless a playlist still being watched holds them.
  const held = new Set(lists.filter((p) => !p.trashedAt).flatMap((p) => p.entries.map((e) => e.id)));
  for (const item of byId.values()) {
    if (!item.trashedAt && eligible(item, prefs) && !held.has(item.id)) set(item, { trashedAt: now });
    // Kept (or no longer eligible) while waiting: back in the library.
    if (item.trashedAt && !eligible(item, prefs)) byId.set(item.id, clean(item)), (changed = true);
  }

  // Due for deletion.
  const delay = delayMs(prefs);
  const due = (t) => t && now >= t + delay;
  const deleted = [...byId.values()].filter((i) => due(i.trashedAt) && i.id !== playing).map((i) => i.id);
  for (const id of deleted) byId.delete(id);
  const gone = new Set(deleted);
  lists = lists
    .filter((p) => !due(p.trashedAt))
    .map((p) => (p.entries.some((e) => gone.has(e.id)) ? { ...p, entries: p.entries.filter((e) => !gone.has(e.id)) } : p));
  if (deleted.length || lists.length !== playlists.length) changed = true;

  return { items: items.filter((i) => byId.has(i.id)).map((i) => byId.get(i.id)), playlists: lists, deleted, changed };
}

module.exports = { DAY, DELAYS, isFinished, delayMs, sweep, restoreItem, clean };
