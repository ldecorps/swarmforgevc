// BL-221/BL-267: Stryker sandboxes each mutation worker under
// extension/.stryker-tmp/sandbox-<id>/, mirroring extension/'s own tree -
// but a repo-root SIBLING directory (outside extension/) never gets copied
// in, so a test or the code under test resolving a path into that sibling
// (e.g. path.join(__dirname, '..', '..', 'pwa', ...) two levels up from
// extension/test/, or complianceBatteryGate.ts's REPO_ROOT three levels up
// from extension/out/recruiter/) ENOENTs inside the sandbox. Every such
// resolution bottoms out at the SAME shared parent - .stryker-tmp/<name>,
// one level below extension/ - regardless of how many levels the caller
// itself walks up from inside its own sandbox-<id>/ subtree, so a single
// shared symlink there (never a per-sandbox copy) satisfies every
// concurrent worker. Stryker's own TemporaryDirectory.dispose() only ever
// removes the one sandbox-<id> subdirectory it created, never the shared
// .stryker-tmp parent while other content (these symlinks) still lives
// there, so the symlinks survive across runs untouched.
//
// BL-221 shipped this hardcoded to a single sibling (pwa/); BL-267
// generalized it to a list so covering the next sibling (confirmed:
// swarmforge/, via complianceBatteryGate.ts) is an added name, not a new
// mechanism. Pure-ish logic lives here so ensureStrykerSandboxSiblings.js
// (the CLI entry point) stays a thin wrapper - mirrors crapLib.js's split.
const fs = require('fs');
const path = require('path');

function ensureStrykerSandboxSiblingLink(extensionDir, tempDirName, siblingName) {
  const siblingSource = path.join(extensionDir, '..', siblingName);
  const tempDir = path.join(extensionDir, tempDirName);
  const linkPath = path.join(tempDir, siblingName);
  const relativeTarget = path.relative(tempDir, siblingSource);

  fs.mkdirSync(tempDir, { recursive: true });

  let existingTarget = null;
  try {
    existingTarget = fs.readlinkSync(linkPath);
  } catch {
    // absent, or present but not a symlink - fall through to (re)create
  }

  if (existingTarget === relativeTarget) {
    return { created: false, linkPath, siblingName };
  }

  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(relativeTarget, linkPath, 'dir');
  return { created: true, linkPath, siblingName };
}

// Trivially extensible: the next repo-root sibling a test/CLI reaches into
// is an added entry in siblingNames, not a new call site.
function ensureStrykerSandboxSiblingLinks(extensionDir, tempDirName, siblingNames) {
  return siblingNames.map((siblingName) => ensureStrykerSandboxSiblingLink(extensionDir, tempDirName, siblingName));
}

module.exports = { ensureStrykerSandboxSiblingLink, ensureStrykerSandboxSiblingLinks };
