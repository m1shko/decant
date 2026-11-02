const test = require('node:test');
const assert = require('node:assert/strict');
const y = require('../src/main/ytdlp');

const env = { ffmpegDir: '/bin', cookiesBrowser: null };
const job = (o) => ({ url: 'https://youtu.be/x', outputDir: '/out', trim: null, ...o });
const after = (args, flag) => args[args.indexOf(flag) + 1];

test('parseTime', () => {
  assert.equal(y.parseTime('1:20'), 80);
  assert.equal(y.parseTime('01:02:03'), 3723);
  assert.equal(y.parseTime('90'), 90);
  assert.equal(y.parseTime('1:2:3:4'), null);
  assert.equal(y.parseTime('abc'), null);
  assert.equal(y.parseTime(''), null);
});

test('mp3 uses the chosen bitrate and embeds the cover', () => {
  const args = y.downloadArgs(job({ kind: 'audio', format: 'mp3', quality: '192' }), env);
  assert.equal(after(args, '--audio-format'), 'mp3');
  assert.equal(after(args, '--audio-quality'), '192K');
  assert.ok(args.includes('--embed-thumbnail'));
  assert.deepEqual(args.slice(-2), ['--', 'https://youtu.be/x']);
});

test('wav skips cover embedding', () => {
  const args = y.downloadArgs(job({ kind: 'audio', format: 'wav' }), env);
  assert.ok(!args.includes('--embed-thumbnail'));
  assert.ok(!args.includes('--audio-quality'));
});

test('video caps resolution and prefers h264', () => {
  const args = y.downloadArgs(job({ kind: 'video', format: 'mp4', quality: '720' }), env);
  assert.equal(after(args, '--format-sort'), 'res:720,vcodec:h264,acodec:aac');
  assert.equal(after(args, '--merge-output-format'), 'mp4');
  const best = y.downloadArgs(job({ kind: 'video', format: 'mp4', quality: 'best' }), env);
  assert.equal(after(best, '--format-sort'), 'res,vcodec:h264,acodec:aac');
});

test('trim adds a section and names the file after it', () => {
  const args = y.downloadArgs(job({ kind: 'audio', format: 'mp3', quality: '320', trim: { start: '80', end: '125' } }), env);
  assert.equal(after(args, '--download-sections'), '*80-125');
  assert.equal(after(args, '--output'), '%(title).150B (1.20-2.05).%(ext)s');
  const open = y.downloadArgs(job({ kind: 'audio', format: 'mp3', quality: '320', trim: { start: '10', end: null } }), env);
  assert.equal(after(open, '--download-sections'), '*10-inf');
});

test('cookies are passed through', () => {
  const args = y.downloadArgs(job({ kind: 'audio', format: 'm4a' }), { ...env, cookiesBrowser: 'firefox' });
  assert.equal(after(args, '--cookies-from-browser'), 'firefox');
});

test('progress line parsing', () => {
  const p = y.parseProgressLine('[siphon] 500|1000|NA|2048.5|3|avc1.640028');
  assert.equal(p.percent, 50);
  assert.equal(p.speed, 2048.5);
  assert.equal(p.eta, 3);
  assert.equal(p.audioOnly, false);
  const est = y.parseProgressLine('[siphon] 250|NA|1000|NA|NA|none');
  assert.equal(est.percent, 25);
  assert.equal(est.audioOnly, true);
  assert.equal(y.parseProgressLine('[download] Destination: x'), null);
});

test('summarizeInfo picks resolution steps', () => {
  const info = y.summarizeInfo({
    title: 'T',
    formats: [
      { vcodec: 'none', acodec: 'opus' },
      { vcodec: 'avc1', width: 1920, height: 1080 },
      { vcodec: 'avc1', width: 1280, height: 720 },
    ],
  });
  assert.deepEqual(info.heights, [1080, 720, 480, 360]);
  const portrait = y.summarizeInfo({ title: 'T', formats: [{ vcodec: 'h264', width: 1080, height: 1920 }] });
  assert.deepEqual(portrait.heights, [1080, 720, 480, 360]);
  const audio = y.summarizeInfo({ title: 'T', formats: [{ vcodec: 'none', acodec: 'mp3' }] });
  assert.equal(audio.hasVideo, false);
});

test('summarizeInfo flattens playlists', () => {
  const info = y.summarizeInfo({
    _type: 'playlist',
    title: 'P',
    entries: [{ id: 'abc', ie_key: 'Youtube', url: 'abc', title: 'A', duration: 10 }, null],
  });
  assert.equal(info.entries.length, 1);
  assert.equal(info.entries[0].url, 'https://www.youtube.com/watch?v=abc');
});

test('friendly errors', () => {
  assert.match(y.friendlyError('ERROR: [Instagram] x: login required', 'https://instagram.com/p/x'), /Cookies/);
  assert.match(y.friendlyError('ERROR: Private video'), /privée/);
  assert.equal(y.friendlyError('ERROR: something odd'), 'something odd');
});
