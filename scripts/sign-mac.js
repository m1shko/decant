// electron-builder afterSign hook: ad-hoc signs the whole macOS bundle before
// the dmg/zip are made. Without a valid signature over the final bundle,
// macOS reports a downloaded app as "damaged" instead of offering to open it.
// codesign refuses files carrying extended attributes, so those go first.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function signMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('xattr', ['-cr', app]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
