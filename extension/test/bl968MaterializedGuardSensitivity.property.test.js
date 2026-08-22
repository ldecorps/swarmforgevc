'use strict';

// BL-968 invariant 2, generative encoding (BL-654, coder-authored): "a
// standing guard proves invariant 1 continuously ... so the next
// load-time-binding step file fails its own parcel's gates instead of
// silently blinding the acceptance-contract check for everyone."
//
// Property: for EVERY registry tree formed by planting one
// load-time-binding step module into the current registry - across all
// three declared offender classes, at either require-chain depth - the
// REAL guard (the same materializeCurrentPipeline + registryLoadVerdict
// the unit-lane standing guard runs) reports the registry unloadable AND
// names the offending file.
//
// Generator reach is by CONSTRUCTION, not by hope (the collision-pair
// guidance): every draw is derived from a real offender shape this parcel
// fixed, so every draw is a violation candidate by construction -
//   - git-root-resolve: the EXACT resolveMainCheckout(__dirname) call the
//     three ticketed files made (headlessDarkEmitterAudit /
//     routingBreakEven / standingRuleViolations);
//   - live-repo-read: the EXACT readFileSync-outside-the-materialized-tree
//     shape of the fourth offender (devHostLauncherSteps' swarm_ensure.bb
//     read), over real repo files absent from the materialized tree;
//   - benign-subprocess: the EXACT shape of the fifth offender
//     (bl936...Steps' `command -v bb` login-shell spawn) - commands that
//     SUCCEED on a live PATH, detectable only through the guard's
//     neutered-PATH clause.
// The chain-depth axis (offender in a steps/lib/ module required by a
// clean-looking step file) exists because the naming assertion must hold
// through a require chain, not only for a direct DOMAINS entry.
// Per-class and per-depth reach floors are asserted after the run -
// absolute counts, never scaled (memory: reachability floors are
// absolute).
//
// Non-vacuity (staged-first restore discipline, both runs recorded
// 2026-08-20):
//   - Break A: helper's naming probe dropped (verdict.detail never set) ->
//     FAILED on the naming assertion at the first draw
//     ("guard detail must NAME the offender").
//   - Break B: helper's PATH neutering dropped (child env keeps the live
//     PATH) -> FAILED with loadable:true on the first benign-subprocess
//     draw - proving both that the neutered-PATH clause is load-bearing
//     and that the benign-subprocess class has real generator reach.
// Both breaks restored; the property holds on the restored helper.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { materializeCurrentPipeline, registryLoadVerdict, plantOffender } = require('./helpers/materializedRegistryGuard');

const NUM_RUNS = 24;
// Absolute reach floors over NUM_RUNS draws (asserted after the run).
const CLASS_FLOOR = 5;
const DEPTH_FLOOR = 6;

// Real repo files that exist in a live checkout but are NEVER part of the
// materialized tree (only specs/pipeline is mirrored; node_modules and
// extension are symlinked) - so a load-time read of one succeeds in a real
// checkout and dies ENOENT in the gate's tree, exactly the fourth
// offender's shape.
const LIVE_REPO_FILES = [
  'swarmforge/scripts/swarm_ensure.bb',
  'swarmforge/handoff-protocol.md',
  'swarmforge/swarmforge.conf',
];

// PATH-resolved commands that succeed on a live PATH (the fifth offender's
// shape) - each would load CLEAN without the guard's neutered-PATH clause.
const BENIGN_SPAWNS = [
  "execFileSync('bash', ['-lc', 'command -v bb'], { encoding: 'utf8' })",
  "execFileSync('git', ['--version'], { encoding: 'utf8' })",
  "execFileSync('node', ['--version'], { encoding: 'utf8' })",
];

function offenderSource(cls, opts) {
  const lines = ["'use strict';"];
  if (cls === 'git-root-resolve') {
    lines.push(`const { resolveMainCheckout } = require('${opts.mainCheckoutRel}');`);
    lines.push('const MAIN_CHECKOUT = resolveMainCheckout(__dirname);');
    lines.push('module.exports.MAIN_CHECKOUT = MAIN_CHECKOUT;');
  } else if (cls === 'live-repo-read') {
    lines.push("const path = require('node:path');");
    lines.push(
      `const LIVE = require('node:fs').readFileSync(path.join(__dirname, ${opts.upSegments}, '${opts.repoFile}'), 'utf8');`
    );
    lines.push('module.exports.LIVE = LIVE;');
  } else if (cls === 'benign-subprocess') {
    lines.push("const { execFileSync } = require('node:child_process');");
    lines.push(`const PROBE = ${opts.spawnExpr}.trim();`);
    lines.push('module.exports.PROBE = PROBE;');
  } else {
    throw new Error(`unknown offender class: ${cls}`);
  }
  return lines.join('\n') + '\n';
}

const offenderArb = fc.record({
  cls: fc.constantFrom('git-root-resolve', 'live-repo-read', 'benign-subprocess'),
  depth: fc.constantFrom('direct', 'via-lib'),
  suffix: fc.integer({ min: 0, max: 999999 }),
  repoFile: fc.constantFrom(...LIVE_REPO_FILES),
  spawnExpr: fc.constantFrom(...BENIGN_SPAWNS),
});

test(
  'BL-968 invariant 2 (generative): every planted load-time-binding module, any class, any chain depth, turns the guard red naming it',
  () => {
    const shared = materializeCurrentPipeline();
    const coverage = { cls: {}, depth: {} };
    try {
      fc.assert(
        fc.property(offenderArb, ({ cls, depth, suffix, repoFile, spawnExpr }) => {
          coverage.cls[cls] = (coverage.cls[cls] || 0) + 1;
          coverage.depth[depth] = (coverage.depth[depth] || 0) + 1;

          const offenderName = `bl968Gen${suffix}`;
          let files;
          let expectNamed;
          if (depth === 'direct') {
            const stepFile = `${offenderName}Steps.js`;
            files = {
              [stepFile]:
                offenderSource(cls, {
                  mainCheckoutRel: './lib/mainCheckout',
                  upSegments: "'..', '..', '..'",
                  repoFile,
                  spawnExpr,
                }) + 'module.exports.registerSteps = function registerSteps() {};\n',
            };
            expectNamed = stepFile;
          } else {
            // Chain-depth axis: the load-time work hides in a lib module a
            // clean-looking step file requires - the naming must surface
            // the LIB file from the require stack.
            const libFile = `lib/${offenderName}Lib.js`;
            const stepFile = `${offenderName}Steps.js`;
            files = {
              [libFile]: offenderSource(cls, {
                mainCheckoutRel: './mainCheckout',
                upSegments: "'..', '..', '..', '..'",
                repoFile,
                spawnExpr,
              }),
              [stepFile]: [
                "'use strict';",
                `require('./${libFile.replace(/\.js$/, '')}');`,
                'module.exports.registerSteps = function registerSteps() {};',
                '',
              ].join('\n'),
            };
            expectNamed = `${offenderName}Lib.js`;
          }

          const planted = plantOffender(shared.pipelineDir, {
            registerRelPath: `${offenderName}Steps`,
            files,
          });
          try {
            const verdict = registryLoadVerdict(shared.pipelineDir, shared.root);
            assert.equal(
              verdict.loadable,
              false,
              `a ${cls} offender (${depth}) loaded clean - the guard would miss the next ${cls} step file: ${JSON.stringify(verdict)}`
            );
            assert.ok(
              (verdict.detail || '').includes(expectNamed),
              `the guard detail must NAME the offender ${expectNamed} (${cls}, ${depth}):\n${verdict.detail}`
            );
          } finally {
            planted.restore();
          }
        }),
        { numRuns: NUM_RUNS }
      );

      for (const cls of ['git-root-resolve', 'live-repo-read', 'benign-subprocess']) {
        assert.ok(
          (coverage.cls[cls] || 0) >= CLASS_FLOOR,
          `reach floor: class ${cls} drawn ${coverage.cls[cls] || 0} < ${CLASS_FLOOR} of ${NUM_RUNS}`
        );
      }
      for (const depth of ['direct', 'via-lib']) {
        assert.ok(
          (coverage.depth[depth] || 0) >= DEPTH_FLOOR,
          `reach floor: depth ${depth} drawn ${coverage.depth[depth] || 0} < ${DEPTH_FLOOR} of ${NUM_RUNS}`
        );
      }
      console.log(`BL-968 sensitivity coverage over ${NUM_RUNS} draws:`, JSON.stringify(coverage));
    } finally {
      fs.rmSync(shared.root, { recursive: true, force: true });
    }
  },
  300000
);
