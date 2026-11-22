const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY, REMOVED_DAYS, isFinished, sweep, removeItem, restoreItem } = require('../src/main/cleanup');

const on = { autoCleanup: true, cleanupDelayDays: 7, cleanupAudio: false };
const video = (id, extra = {}) => ({ id, kind: 'video', title: id, ...extra });
const list = (id, ...ids) => ({ id, title: id, entries: ids.map((e, index) => ({ id: e, index })) });
const ids = (items) => items.map((i) => i.id);
const T = 1_000_000;

test('a video is finished with less than 30 s left, or 10 % (at least 5 s) of a short one', () => {
  assert.equal(isFinished(571, 600), true);
  assert.equal(isFinished(560, 600), false);
  assert.equal(isFinished(36, 40), true);
  assert.equal(isFinished(30, 40), false);
  assert.equal(isFinished(15, 19), true);
  assert.equal(isFinished(13, 19), false);
  assert.equal(isFinished(10, undefined), false);
});

test('a watched video moves to "To delete", then is deleted after the delay', () => {
  let state = { items: [video('a', { finishedAt: T }), video('b')], playlists: [] };
  let r = sweep(state, on, T);
  assert.equal(r.items.find((i) => i.id === 'a').trashedAt, T);
  assert.equal(r.items.find((i) => i.id === 'b').trashedAt, undefined);
  assert.deepEqual(r.deleted, []);
  r = sweep(r, on, T + 7 * DAY - 1);
  assert.deepEqual(r.deleted, []);
  r = sweep(r, on, T + 7 * DAY);
  assert.deepEqual(r.deleted, ['a']);
  assert.deepEqual(ids(r.items), ['b']);
});

test('kept videos, songs and the one playing stay', () => {
  const items = [video('kept', { finishedAt: T, keep: true }), { ...video('song', { finishedAt: T }), kind: 'audio' }, video('now', { finishedAt: T })];
  let r = sweep({ items, playlists: [] }, { ...on, cleanupDelayDays: 0 }, T, { playing: 'now' });
  assert.deepEqual(r.deleted, []);
  assert.deepEqual(ids(r.items), ['kept', 'song', 'now']);
  r = sweep({ items, playlists: [] }, { ...on, cleanupDelayDays: 0, cleanupAudio: true }, T);
  assert.deepEqual(r.deleted, ['song', 'now']);
});

test('a playlist waits until all of it is watched, then goes with its videos', () => {
  const playlists = [list('p', 'a', 'b')];
  let r = sweep({ items: [video('a', { finishedAt: T }), video('b')], playlists }, on, T);
  assert.equal(r.items[0].trashedAt, undefined, 'held by the playlist');
  r.items[1].finishedAt = T + 1;
  r = sweep(r, on, T + 1);
  assert.equal(r.playlists[0].trashedAt, T + 1);
  assert.deepEqual(r.items.map((i) => i.trashedWith), ['p', 'p']);
  r = sweep(r, on, T + 1 + 7 * DAY);
  assert.deepEqual(r.deleted, ['a', 'b']);
  assert.deepEqual(r.playlists, []);
});

test('a kept video survives its playlist', () => {
  const items = [video('a', { finishedAt: T }), video('b', { finishedAt: T, keep: true })];
  let r = sweep({ items, playlists: [list('p', 'a', 'b')] }, on, T);
  assert.equal(r.items[1].trashedAt, undefined);
  r = sweep(r, on, T + 7 * DAY);
  assert.deepEqual(ids(r.items), ['b']);
  assert.deepEqual(r.playlists, []);
});

test('turning it off empties "To delete"; keeping a video takes it out', () => {
  let r = sweep({ items: [video('a', { finishedAt: T })], playlists: [list('p', 'a')] }, on, T);
  assert.ok(r.playlists[0].trashedAt);
  const off = sweep(r, { ...on, autoCleanup: false }, T + 1);
  assert.equal(off.items[0].trashedAt, undefined);
  assert.equal(off.playlists[0].trashedAt, undefined);
  r.items[0].keep = true;
  r = sweep(r, on, T + 2);
  assert.equal(r.items[0].trashedAt, undefined);
});

test('a restored video starts over and does not come straight back', () => {
  const r = sweep({ items: [video('a', { finishedAt: T, position: 590 })], playlists: [] }, on, T);
  const back = restoreItem(r.items[0]);
  assert.deepEqual(back, { id: 'a', kind: 'video', title: 'a', position: 0 });
  assert.equal(sweep({ items: [back], playlists: [] }, on, T + 1).items[0].trashedAt, undefined);
});

test('what you remove waits 30 days in "Recently deleted", even with auto cleanup off', () => {
  const off = { ...on, autoCleanup: false };
  const items = [removeItem(video('a', { position: 120 }), T), video('b')];
  let r = sweep({ items, playlists: [] }, off, T + 1);
  assert.equal(r.items[0].trashedAt, T, 'not brought back when cleanup is off');
  r = sweep(r, off, T + REMOVED_DAYS * DAY - 1);
  assert.deepEqual(r.deleted, []);
  r = sweep(r, off, T + REMOVED_DAYS * DAY);
  assert.deepEqual(r.deleted, ['a']);
  assert.deepEqual(ids(r.items), ['b']);
});

test('with auto cleanup on, removed items keep their own 30-day delay and the playlist drops them', () => {
  const items = [removeItem(video('a'), T), video('b')];
  let r = sweep({ items, playlists: [list('p', 'a', 'b')] }, { ...on, cleanupDelayDays: 1 }, T + 2 * DAY);
  assert.deepEqual(r.deleted, [], 'not on the cleanup delay');
  assert.equal(r.items[0].trashedAt, T, 'unwatched but stays removed');
  r = sweep(r, on, T + REMOVED_DAYS * DAY);
  assert.deepEqual(r.deleted, ['a']);
  assert.deepEqual(r.playlists[0].entries.map((e) => e.id), ['b']);
});

test('a removed item comes back where you were, and does not go straight to "To delete"', () => {
  const back = restoreItem(removeItem(video('a', { position: 120, finishedAt: T }), T));
  assert.deepEqual(back, video('a', { position: 120 }));
  assert.equal(sweep({ items: [back], playlists: [] }, on, T + 1).items[0].trashedAt, undefined);
});
