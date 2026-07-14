const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// macOS assesses every newly created executable file the first time it is
// executed (syspolicyd — measured ~2-10s per file, serialized system-wide,
// and re-triggered even for a byte-identical COPY). Tests that wrote a fresh
// mock script per test paid that assessment on every run; at ~41 fake-tmux
// installs plus assorted mock scripts, the scans dominated the suite's wall
// clock (~5 minutes wall for ~16s of CPU — BL-060).
//
// Fix: deduplicate executables by content into one stable file per machine
// under os.tmpdir(), and HARDLINK them to wherever a test needs one. A
// hardlink shares the inode, so the one-time assessment stays cached; only
// the first-ever run of a given content on a machine pays the scan.

const SHARED_DIR = path.join(os.tmpdir(), 'sfvc-shared-bin-v1');

function sharedExecutable(name, content) {
  fs.mkdirSync(SHARED_DIR, { recursive: true });
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
  const file = path.join(SHARED_DIR, `${name}-${hash}`);
  if (!fs.existsSync(file)) {
    // Write-then-rename keeps concurrent test processes from executing a
    // half-written script; identical content makes the race harmless.
    const tmp = path.join(SHARED_DIR, `.${name}-${hash}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, content, { mode: 0o755 });
    fs.renameSync(tmp, file);
  }
  return file;
}

// Places an executable with the given content at destPath, reusing the
// machine-wide assessed file. Falls back to a plain copy if destPath is on a
// different filesystem (the copy then pays the scan, but stays correct).
function installExecutable(destPath, content) {
  const shared = sharedExecutable(path.basename(destPath), content);
  fs.rmSync(destPath, { force: true });
  try {
    fs.linkSync(shared, destPath);
  } catch {
    fs.copyFileSync(shared, destPath);
    fs.chmodSync(destPath, 0o755);
  }
  return destPath;
}

module.exports = { sharedExecutable, installExecutable };
