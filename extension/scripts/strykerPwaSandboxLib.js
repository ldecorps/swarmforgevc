// BL-221: Stryker sandboxes each mutation worker under
// extension/.stryker-tmp/sandbox-<id>/, mirroring extension/'s own tree -
// but the sibling repo-root pwa/ directory (outside extension/) never gets
// copied in, so a test resolving a pwa/ asset via
// path.join(__dirname, '..', '..', 'pwa', ...) (two levels up from
// extension/test/) ENOENTs inside the sandbox. That same two-levels-up
// path lands at .stryker-tmp/pwa - the shared PARENT of every sandbox-<id>
// dir, one level below extension/ - so a single shared symlink there
// (never a per-sandbox copy) satisfies every concurrent worker. Stryker's
// own TemporaryDirectory.dispose() only ever removes the one sandbox-<id>
// subdirectory it created, never the shared .stryker-tmp parent while
// other content (this symlink) still lives there, so the symlink survives
// across runs untouched. Pure-ish logic lives here so ensureStrykerPwaSandbox.js
// (the CLI entry point) stays a thin wrapper - mirrors crapLib.js's split.
const fs = require('fs');
const path = require('path');

function ensureStrykerPwaSandboxLink(extensionDir, tempDirName) {
  const pwaSource = path.join(extensionDir, '..', 'pwa');
  const tempDir = path.join(extensionDir, tempDirName);
  const linkPath = path.join(tempDir, 'pwa');
  const relativeTarget = path.relative(tempDir, pwaSource);

  fs.mkdirSync(tempDir, { recursive: true });

  let existingTarget = null;
  try {
    existingTarget = fs.readlinkSync(linkPath);
  } catch {
    // absent, or present but not a symlink - fall through to (re)create
  }

  if (existingTarget === relativeTarget) {
    return { created: false, linkPath };
  }

  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(relativeTarget, linkPath, 'dir');
  return { created: true, linkPath };
}

module.exports = { ensureStrykerPwaSandboxLink };
