// Renders the interface with fake data (docs/demo/mock.js) in headless Chrome
// and writes the README screenshots to docs/screenshots/. macOS + Chrome only.
//   node scripts/screenshots.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const demoDir = path.join(root, 'docs', 'demo');
const outDir = path.join(root, 'docs', 'screenshots');

// The demo page is the real index.html with the mock loaded first. Its CSP is
// dropped because file:// pages have no 'self' origin to match.
const html = fs
  .readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8')
  .replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
  .replace('href="styles.css"', 'href="../../src/renderer/styles.css"')
  .replace('<script src="app.js"></script>', '<script src="mock.js"></script>\n    <script src="../../src/renderer/app.js"></script>');
fs.writeFileSync(path.join(demoDir, 'index.html'), html);
fs.mkdirSync(outDir, { recursive: true });

const shots = [
  ['audio', 'dark'],
  ['video', 'dark'],
  ['playlist', 'dark'],
  ['history', 'dark'],
  ['audio', 'light'],
];

for (const [scene, theme] of shots) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'decant-shot-'));
  const url = `${pathToFileURL(path.join(demoDir, 'index.html'))}?scene=${scene}`;
  const file = path.join(outDir, `${scene}-${theme}.png`);
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    ...(theme === 'dark' ? ['--force-dark-mode', '--blink-settings=preferredColorScheme=0'] : ['--blink-settings=preferredColorScheme=1']),
    '--force-device-scale-factor=2',
    '--window-size=980,760',
    '--virtual-time-budget=3000',
    `--screenshot=${file}`,
    url,
  ], { stdio: 'ignore' });
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(path.relative(root, file));
}
