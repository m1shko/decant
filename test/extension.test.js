const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decantUrl, videoUrl, playlistUrl, parseYoutube, linkFor } = require('../extension/decant.js');
const { parseDecantUrl } = require('../src/main/links');

test('the extension builds links the app reads', () => {
  const url = playlistUrl('PLabc');
  assert.deepEqual(parseDecantUrl(decantUrl('save', url, { playlist: true, only: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] })), {
    action: 'save',
    url,
    playlist: true,
    only: ['aaaaaaaaaaa', 'bbbbbbbbbbb'],
  });
  assert.deepEqual(parseDecantUrl(decantUrl('open', videoUrl('dQw4w9WgXcQ'))), { action: 'open', url: videoUrl('dQw4w9WgXcQ'), playlist: false, only: null });
});

test('reads YouTube links', () => {
  assert.deepEqual(parseYoutube('/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1&pp=xyz'), { video: 'dQw4w9WgXcQ', list: 'RDdQw4w9WgXcQ', shorts: false });
  assert.deepEqual(parseYoutube('/shorts/abcdefghijk'), { video: 'abcdefghijk', list: null, shorts: true });
  assert.deepEqual(parseYoutube('https://www.youtube.com/playlist?list=PLabc'), { video: null, list: 'PLabc', shorts: false });
  assert.deepEqual(parseYoutube('https://youtu.be/dQw4w9WgXcQ?t=3'), { video: 'dQw4w9WgXcQ', list: null, shorts: false });
  assert.equal(parseYoutube('/@somechannel'), null);
  assert.equal(parseYoutube('/watch?v=short'), null);
  assert.equal(parseYoutube('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('a mix keeps its video, other playlists stand alone', () => {
  assert.equal(playlistUrl('RDdQw4w9WgXcQ', 'dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ');
  assert.equal(playlistUrl('PLabc', 'dQw4w9WgXcQ'), 'https://www.youtube.com/playlist?list=PLabc');
});

test('tidies the page link it sends', () => {
  assert.equal(linkFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&pp=abc'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(linkFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc&index=3'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc');
  assert.equal(linkFor('https://vimeo.com/123'), 'https://vimeo.com/123');
  assert.equal(linkFor('chrome://extensions'), null);
  assert.equal(linkFor(undefined), null);
});

test('every language has every text', () => {
  const dir = path.join(__dirname, '..', 'extension', '_locales');
  const read = (lang) => JSON.parse(fs.readFileSync(path.join(dir, lang, 'messages.json'), 'utf8'));
  const keys = Object.keys(read('en')).sort();
  for (const lang of fs.readdirSync(dir)) assert.deepEqual(Object.keys(read(lang)).sort(), keys, lang);
  // And every text the code asks for exists.
  const code = ['background.js', 'youtube.js', 'options.html', 'manifest.json']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'extension', f), 'utf8'))
    .join('\n');
  const used = new Set([...code.matchAll(/(?:\bt\(['"]|data-i18n="|__MSG_)([A-Za-z0-9]+)/g)].map((m) => m[1]));
  assert.ok(used.size > 20);
  for (const key of used) assert.ok(keys.includes(key), `missing text: ${key}`);
});
