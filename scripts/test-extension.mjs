// Tries the browser extension on the real YouTube: loads it in a throwaway
// Chrome profile, hovers thumbnails, clicks the buttons and checks the
// decant:// links they open. YouTube changes its pages often: run this when
// the buttons stop showing up. Needs Google Chrome and the internet.
//   npm run test:extension            (CHROME=/path/to/chrome to pick another)
//   npm run test:extension -- --shots  also saves screenshots to dist/extension-shots/
//   EXTENSION=path/to/Decant-Extension npm run test:extension  tries an unzipped release instead
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chrome =
  process.env.CHROME ||
  {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    linux: '/usr/bin/google-chrome',
  }[process.platform];
const shots = process.argv.includes('--shots') ? path.join(root, 'dist', 'extension-shots') : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

const PLAYLIST = 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'decant-extension-'));
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  pipe: true,
  enableExtensions: [path.resolve(process.env.EXTENSION || path.join(root, 'extension'))],
  userDataDir: profile,
  defaultViewport: { width: 1400, height: 1000 },
});
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Page.enable');
let sent = null;
cdp.on('Page.frameRequestedNavigation', (e) => e.url.startsWith('decant:') && (sent = decodeURIComponent(e.url)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? `  ${detail}` : ''}`);
}

async function go(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // A fresh profile gets YouTube's cookie consent first: decline what is optional.
  const declineButton = (sel) =>
    page.evaluate((sel) => {
      const b = [...document.querySelectorAll(sel)].find((b) => /reject all|tout refuser|alle ablehnen|rechazar todo|rifiuta tutto|rejeitar tudo/i.test(b.textContent));
      b?.click();
      return Boolean(b);
    }, sel);
  if (page.url().includes('consent.') && (await declineButton('button'))) await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(3000);
  if (await declineButton('ytd-consent-bump-v2-lightbox button, tp-yt-paper-dialog button')) await sleep(2500);
}

const shot = (name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });

async function click(x, y) {
  sent = null;
  await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.click(x, y);
  await sleep(500);
  return sent;
}

// Hovers the first thumbnail matching `selector`, clicks Decant's button and
// returns the decant:// link it opened (null when the button did not show).
async function hoverAndSend(selector, name) {
  const pos = await page.evaluate(async (selector) => {
    const a = [...document.querySelectorAll(selector)].find((a) => a.getBoundingClientRect().width > 100);
    if (!a) return null;
    a.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 600));
    const r = a.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!pos) return check(name, false, 'no such thumbnail on the page');
  await page.mouse.move(5, 5);
  await sleep(200);
  await page.mouse.move(pos.x, pos.y, { steps: 5 });
  await sleep(500);
  const btn = await page.evaluate(() => {
    const b = document.querySelector('decant-layer')?.shadowRoot?.querySelector('.hover');
    const r = b?.getBoundingClientRect();
    return b && !b.hidden ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (!btn) return check(name, false, 'the button did not show');
  await shot(`hover-${name}`);
  return click(btn.x, btn.y);
}

const like = (link, re) => Boolean(link && re.test(link));

// Thumbnails
await go('https://www.youtube.com/results?search_query=lofi+playlist');
let link = await hoverAndSend('a[href*="/watch?v="]:has(img):not(:has(yt-collection-thumbnail-view-model))', 'search video');
check('video thumbnail in search', like(link, /^decant:\/\/open\?url=https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/), link);
link = await hoverAndSend('a:has(yt-collection-thumbnail-view-model)', 'search mix');
check('playlist or mix thumbnail in search', like(link, /[?&]list=[\w-]+&playlist=1$/), link);
await go('https://www.youtube.com/@LofiGirl/playlists');
link = await hoverAndSend('a:has(yt-collection-thumbnail-view-model)', 'channel playlists');
check('playlist thumbnail on a channel', like(link, /\/playlist\?list=[\w-]+&playlist=1$/), link);
await go('https://www.youtube.com/@LofiGirl/shorts');
link = await hoverAndSend('a[href^="/shorts/"]', 'channel shorts');
check('Shorts thumbnail', like(link, /\/shorts\/[\w-]{11}$/), link);

// Video page
await go(`https://www.youtube.com/watch?v=NFvDHYMzj9U&list=${PLAYLIST}&index=2`);
const buttons = await page.evaluate(() =>
  [...(document.querySelector('decant-watch')?.shadowRoot?.querySelectorAll('button') || [])].map((b) => {
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
await shot('watch');
check('two buttons on a video page in a playlist', buttons.length === 2);
if (buttons.length === 2) {
  link = await click(buttons[0].x, buttons[0].y);
  check('video page sends the video', link === 'decant://open?url=https://www.youtube.com/watch?v=NFvDHYMzj9U', link);
  link = await click(buttons[1].x, buttons[1].y);
  check('video page sends the playlist', link === `decant://open?url=https://www.youtube.com/playlist?list=${PLAYLIST}&playlist=1`, link);
}

// Playlist page
await go(`https://www.youtube.com/playlist?list=${PLAYLIST}`);
const barButtons = () =>
  page.evaluate(() =>
    [...(document.querySelector('decant-layer')?.shadowRoot?.querySelectorAll('.bar button') || [])].map((b) => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent.trim(), disabled: b.disabled, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
let bar = await barButtons();
await shot('playlist');
check('playlist page shows the Decant bar', bar.length === 2);
if (bar.length === 2) {
  link = await click(bar[1].x, bar[1].y);
  check('bar sends the whole playlist', link === `decant://open?url=https://www.youtube.com/playlist?list=${PLAYLIST}&playlist=1`, link);
  await click(bar[0].x, bar[0].y);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.decant-row')].slice(0, 6).map((r) => {
      const b = r.getBoundingClientRect();
      return { id: r.dataset.decantId, x: b.x + 300, y: b.y + b.height / 2 };
    }),
  );
  check('pick mode puts a box on each video', rows.length === 6 && (await page.evaluate(() => document.querySelectorAll('decant-check').length)) >= 6);
  const url = page.url();
  await click(rows[1].x, rows[1].y);
  await page.keyboard.down('Shift');
  await click(rows[3].x, rows[3].y);
  await page.keyboard.up('Shift');
  await click(rows[5].x, rows[5].y);
  await sleep(500);
  check('a click picks a video instead of playing it', page.url() === url);
  const expected = [rows[1], rows[2], rows[3], rows[5]].map((r) => r.id);
  const picked = await page.evaluate(() => [...document.querySelectorAll('.decant-picked')].map((r) => r.dataset.decantId));
  check('click and shift-click pick the right videos', picked.join() === expected.join(), picked.join());
  await shot('playlist-picking');
  bar = await barButtons();
  const sendPicked = bar.find((b) => !b.disabled && /\d/.test(b.text));
  link = sendPicked && (await click(sendPicked.x, sendPicked.y));
  check('bar sends just the picked videos', link === `decant://open?url=https://www.youtube.com/playlist?list=${PLAYLIST}&playlist=1&only=${expected.join(',')}`, link);
}

await browser.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nAll good');
process.exit(failures ? 1 : 0);
