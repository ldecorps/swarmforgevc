#!/usr/bin/env node
'use strict';

// BL-1636: removes dead, `bl`-prefixed handler temp roots from a directory
// (default os.tmpdir()) older than a floor, keeping any root whose name
// carries a LIVE owner pid regardless of age - reusing tmpDir.js's own
// owner-pid naming convention (`<prefix><pid>-...`) and liveness probe
// (BL-1623's zombie-aware isPidAlive), never a second copy of either.
// Lists the directory ONCE; never recurses outside it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { defaultIsPidAlive } = (() => {
  // tmpDir.js does not export its liveness probe today - re-derive the
  // identical zombie-aware check here rather than reaching into a private
  // helper, so this script has no dependency on extension/test/'s own
  // module graph (it must run standalone, e.g. from a bare checkout).
  const { spawnSync } = require('node:child_process');
  function isZombiePid(pid) {
    const probe = spawnSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' });
    return probe.status === 0 && /^\s*Z/.test(probe.stdout || '');
  }
  function defaultIsPidAlive(pid) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      return err.code === 'EPERM';
    }
    return !isZombiePid(pid);
  }
  return { defaultIsPidAlive };
})();

// Self-audit (2026-09-19): this leftmost digit-run match can misread an
// unrelated legacy directory's leading ticket number (e.g.
// `bl1031-dir-<rand>`) as an "owner pid", which only ever makes the reap
// SKIP a root it could safely have removed - it never causes a false
// deletion (no digit run this pattern could find is ever used to justify
// removing anything; it only ever justifies keeping). A stricter,
// end-anchored match (pid immediately before the trailing 6-char mkdtemp
// suffix) was considered and rejected: caller prefixes vary in length, so
// anchoring would miss a genuinely long-lived owned root whose prefix
// carries extra descriptive text, which WOULD risk deleting something
// still alive. This keeps the same "errs toward keeping a root it is
// unsure about" posture tmpDir.js's isZombiePid already documents for the
// unit lane's own sweep - never tightened at the cost of that safety
// direction.
const OWNER_PID_PATTERN = /(\d+)-/;

function parseArgs(argv) {
  const opts = { dir: os.tmpdir(), olderThanHours: 24, prefix: 'bl', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') {
      opts.dir = argv[++i];
    } else if (arg === '--older-than-hours') {
      opts.olderThanHours = Number(argv[++i]);
    } else if (arg === '--prefix') {
      opts.prefix = argv[++i];
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    }
  }
  return opts;
}

/**
 * BL-1636: a root is removed iff (a) its name starts with `prefix`, (b) it
 * is older than `olderThanHoursFloor`, and (c) it does NOT carry a live
 * owner pid in its name - a live owner keeps its root regardless of age
 * (scenario 04's third example). `isPidAlive`/`nowMs` are injectable so a
 * test drives this deterministically without a real clock or process
 * table.
 */
function reapStaleTmpRoots({ dir, prefix, olderThanHoursFloor, isPidAlive = defaultIsPidAlive, nowMs = Date.now(), dryRun = false }) {
  const floorMs = olderThanHoursFloor * 60 * 60 * 1000;
  const removed = [];
  const entries = fs.readdirSync(dir); // ONE listing.
  for (const name of entries) {
    if (!name.startsWith(prefix)) {
      continue;
    }
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // vanished between readdir and stat - nothing to reap.
    }
    const rest = name.slice(prefix.length);
    const pidMatch = OWNER_PID_PATTERN.exec(rest);
    if (pidMatch && isPidAlive(Number(pidMatch[1]))) {
      continue; // a live owner keeps its root regardless of age.
    }
    const ageMs = nowMs - stat.mtimeMs;
    if (ageMs < floorMs) {
      continue; // too young - not yet a leak, even with no live owner.
    }
    if (!dryRun) {
      fs.rmSync(full, { recursive: true, force: true });
    }
    removed.push(full);
  }
  return removed;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const removed = reapStaleTmpRoots({
    dir: opts.dir,
    prefix: opts.prefix,
    olderThanHoursFloor: opts.olderThanHours,
    dryRun: opts.dryRun,
  });
  console.log(`${opts.dryRun ? '[dry-run] would remove' : 'removed'} ${removed.length} stale root(s) under ${opts.dir}`);
}

if (require.main === module) {
  main();
}

module.exports = { reapStaleTmpRoots };
