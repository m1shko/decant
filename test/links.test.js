const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDecantUrl, findDecantUrl } = require('../src/main/links');

const video = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const link = (action, params) => `decant://${action}?${new URLSearchParams(params)}`;

test('reads an open link', () => {
  assert.deepEqual(parseDecantUrl(link('open', { url: video })), { action: 'open', url: video, only: null });
});

test('reads a save link with picked videos', () => {
  const playlist = 'https://www.youtube.com/playlist?list=PL123';
  assert.deepEqual(parseDecantUrl(link('save', { url: playlist, only: 'aaa,bbb,aaa' })), {
    action: 'save',
    url: playlist,
    only: ['aaa', 'bbb'],
  });
});

test('accepts the forms some systems rewrite the link to', () => {
  const query = `?url=${encodeURIComponent(video)}`;
  for (const raw of [`decant://open/${query}`, `decant:open${query}`, `DECANT://OPEN${query}`, `decant://${query}`]) {
    assert.equal(parseDecantUrl(raw)?.url, video, raw);
  }
});

test('refuses anything that is not an http(s) link to open', () => {
  assert.equal(parseDecantUrl(link('open', { url: 'file:///etc/passwd' })), null);
  assert.equal(parseDecantUrl(link('open', { url: 'javascript:alert(1)' })), null);
  assert.equal(parseDecantUrl(link('open', { url: 'not a link' })), null);
  assert.equal(parseDecantUrl(link('open', {})), null);
  assert.equal(parseDecantUrl(link('delete', { url: video })), null);
  assert.equal(parseDecantUrl(`https://example.com/?url=${encodeURIComponent(video)}`), null);
  assert.equal(parseDecantUrl(null), null);
});

test('drops picked ids that are not ids', () => {
  assert.deepEqual(parseDecantUrl(link('open', { url: video, only: 'ok_1,bad id,../x,' })).only, ['ok_1']);
  assert.equal(parseDecantUrl(link('open', { url: video, only: ',,' })).only, null);
});

test('finds the link among command-line arguments', () => {
  const raw = link('open', { url: video });
  assert.equal(findDecantUrl(['C:\\Decant\\Decant.exe', '--flag', raw]), raw);
  assert.equal(findDecantUrl(['/usr/bin/decant', '.']), null);
});
