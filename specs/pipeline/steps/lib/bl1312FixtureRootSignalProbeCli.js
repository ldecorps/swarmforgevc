'use strict';

// BL-1312: the two-mode probe qa_e2e_procedure describes, as a standalone
// child process the step handler spawns and signals - the defect (a bare
// process.on('exit') hook that does not fire on SIGTERM/SIGINT) can only be
// observed from OUTSIDE the process it affects, since the process itself
// never gets to report anything once the signal's default action takes it
// down.
//
// argv: [helperPath, mode, preInstall, rootCount]
//   helperPath  - absolute path to socketFixtureRoot.js
//   mode        - 'idle' (create roots, print them, wait to be signaled) or
//                 'count' (create roots, print listener counts, exit 0)
//   preInstall  - 'already' to call fixtureReaper's onAbnormalExit() BEFORE
//                 any root is created (models "another step file already
//                 installed a fixtureReaper handler"), anything else to skip
//   rootCount   - how many roots to create (default 1)
const path = require('node:path');

const [, , helperPath, mode, preInstall, rootCountArg] = process.argv;
const rootCount = Number(rootCountArg || '1');

const { mkSocketFixtureRoot } = require(helperPath);

if (preInstall === 'already') {
  const { onAbnormalExit } = require(path.join(path.dirname(helperPath), 'fixtureReaper'));
  onAbnormalExit(() => {});
}

const roots = [];
for (let i = 0; i < rootCount; i += 1) {
  roots.push(mkSocketFixtureRoot(`bl1312-probe-${i}-`));
}

console.log(`ROOTS:${roots.join(',')}`);

if (mode === 'count') {
  console.log(`SIGINT:${process.listenerCount('SIGINT')}`);
  console.log(`SIGTERM:${process.listenerCount('SIGTERM')}`);
  process.exit(0);
} else {
  // Idle until signaled - long enough to outlive the step handler's own
  // wait, short enough that a probe the test harness somehow failed to
  // signal does not become a permanent orphan.
  setTimeout(() => {}, 30000);
}
