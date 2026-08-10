const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir, mkSharedTmpDir } = require('./helpers/tmpDir');

// BL-622 invariant (declared on the ticket, coder-authored per BL-654):
// "Ambient-env Telegram creds resolve only for the one recorded primary
// root; any other swarm without per-swarm creds keeps its front desk DOWN
// with one loud line - no path brings up a second poller on the same
// token." Two independent facets, one property each:
//   A. env-fallback gating (resolve-telegram-creds/env-fallback-allowed?)
//   B. cross-swarm token uniqueness (conflicting-swarm)
// Both drive the REAL fleet_telegram_creds_lib.bb - never a JS re-
// implementation of the decision, which would test this file's own oracle
// against itself rather than the actual production code.
const REPO_ROOT = path.join(__dirname, '..', '..');
const SWARM_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CREDS_CLI = path.join(SWARM_SCRIPTS, 'fleet_telegram_creds_cli.bb');
const CREDS_LIB = path.join(SWARM_SCRIPTS, 'fleet_telegram_creds_lib.bb');

function writeSwarmIdentity(projectRoot, swarmName) {
  fs.mkdirSync(path.join(projectRoot, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.swarmforge', 'swarm-identity'),
    `swarm_name\t${swarmName}\nswarm_mode\tautonomous\nswarm_mode_primary\ttrue\n`
  );
}

function writeFleetCredsFile(fleetHome, swarmName, creds) {
  const dir = path.join(fleetHome, '.swarmforge', 'fleet', swarmName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram.json'), JSON.stringify(creds));
}

function writePrimaryRoot(fleetHome, root) {
  const dir = path.join(fleetHome, '.swarmforge', 'fleet', 'primary');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'root'), root);
}

function resolveCreds(projectRoot, fleetHome, env) {
  const out = execFileSync('bb', [CREDS_CLI, projectRoot], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, ...env, SWARMFORGE_FLEET_HOME: fleetHome },
  });
  return JSON.parse(out.trim());
}

function rmQuiet(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// A tiny CLI wrapper over the REAL conflicting-swarm, written once to a temp
// file and invoked with plain argv (never string-interpolated into Clojure
// source - swarm names/tokens are test-controlled here, but argv passing is
// the robust pattern regardless). Prints the conflicting swarm name, or the
// literal string "NONE".
//
// BL-868: this directory is created once at module load and read by every
// test in this file, so it must survive past the FIRST test's own teardown -
// mkTmpDir's per-test afterEach sweep (now wired into the property lane)
// would otherwise delete it before the second test runs. mkSharedTmpDir is
// the tmpDir.js helper built for exactly this "created once in setup,
// referenced by multiple tests" shape; it sweeps at afterAll instead.
const CONFLICT_CHECK_SCRIPT = path.join(mkSharedTmpDir('bl622-prop-script-'), 'conflict_check.bb');
fs.writeFileSync(
  CONFLICT_CHECK_SCRIPT,
  [
    `(load-file "${CREDS_LIB}")`,
    '(let [[home swarm-name token] *command-line-args*',
    '      token (when (not= token "__NIL__") token)]', // argv can never carry a real nil
    '  (println (or (fleet-telegram-creds-lib/conflicting-swarm home swarm-name token) "NONE")))',
  ].join('\n')
);

function checkConflict(fleetHome, swarmName, token) {
  const out = execFileSync('bb', [CONFLICT_CHECK_SCRIPT, fleetHome, swarmName, token === null ? '__NIL__' : token], {
    encoding: 'utf8',
    timeout: 15000,
  }).trim();
  return out === 'NONE' ? null : out;
}

// ── Property A: env-fallback gating ─────────────────────────────────────
// The oracle is derived directly from the invariant's own wording, never
// copied from fleet_telegram_creds_lib.bb's env-fallback-allowed? - or this
// would prove nothing.
function oracleRefused({ swarmName, primaryRecordState, hasOwnCredsFile }) {
  if (hasOwnCredsFile) return false; // own creds file always wins wholesale
  if (primaryRecordState === 'matches') return false; // the recorded primary itself
  if (primaryRecordState === 'none' && swarmName === 'primary') return false; // first-ever bootstrap
  return true; // 'differs', or ('none' and a non-primary swarm name)
}

// Reachability floor (BL-654): both the DISCRETE recorded-primary state
// (none/matches/differs) and the primary-vs-non-primary swarm name must
// each be reached deterministically, not left to chance in a wide random
// string space that might rarely land on "primary" or a specific state -
// see this file's own module docstring on generator reach.
const primaryRecordArb = fc.constantFrom('none', 'matches', 'differs');
const hasOwnCredsArb = fc.boolean();
const swarmNameArb = fc.oneof(
  { weight: 1, arbitrary: fc.constant('primary') },
  { weight: 2, arbitrary: fc.constantFrom('secondary', 'fes', 'staging-swarm') }
);

test('property: env-fallback token resolution is refused iff this is not the recorded primary root and it has no own creds file', () => {
  const seenRefused = { true: 0, false: 0 };
  fc.assert(
    fc.property(swarmNameArb, primaryRecordArb, hasOwnCredsArb, (swarmName, primaryRecordState, hasOwnCredsFile) => {
      const projectRoot = mkTmpDir('bl622-prop-project-');
      const fleetHome = mkTmpDir('bl622-prop-fleet-');
      let otherPrimaryRoot;
      try {
        writeSwarmIdentity(projectRoot, swarmName);
        if (primaryRecordState === 'matches') {
          writePrimaryRoot(fleetHome, projectRoot);
        } else if (primaryRecordState === 'differs') {
          otherPrimaryRoot = mkTmpDir('bl622-prop-other-primary-');
          writePrimaryRoot(fleetHome, otherPrimaryRoot);
        }
        if (hasOwnCredsFile) {
          writeFleetCredsFile(fleetHome, swarmName, { botToken: `${swarmName}-own-token`, chatId: 'c', bridgePort: 8765 });
        }

        const expectedRefused = oracleRefused({ swarmName, primaryRecordState, hasOwnCredsFile });
        seenRefused[String(expectedRefused)] += 1;

        const resolved = resolveCreds(projectRoot, fleetHome, {
          TELEGRAM_BOT_TOKEN: 'ambient-token',
          TELEGRAM_CHAT_ID: 'ambient-chat',
        });

        assert.equal(
          resolved.refused,
          expectedRefused,
          `swarmName=${swarmName} primaryRecordState=${primaryRecordState} hasOwnCredsFile=${hasOwnCredsFile}: ${JSON.stringify(resolved)}`
        );
        if (expectedRefused) {
          assert.equal(resolved.botToken, null);
          assert.ok(resolved.reason && resolved.reason.includes(swarmName), `reason should name the swarm: ${resolved.reason}`);
        } else if (hasOwnCredsFile) {
          assert.equal(resolved.botToken, `${swarmName}-own-token`);
        } else {
          assert.equal(resolved.botToken, 'ambient-token');
        }
      } finally {
        rmQuiet(projectRoot);
        rmQuiet(fleetHome);
        if (otherPrimaryRoot) rmQuiet(otherPrimaryRoot);
      }
    }),
    { numRuns: 40 }
  );
  assert.ok(seenRefused.true > 0, 'generator reach floor: must generate at least one REFUSED trial');
  assert.ok(seenRefused.false > 0, 'generator reach floor: must generate at least one ALLOWED trial');
});

// ── Property B: cross-swarm token uniqueness ────────────────────────────
// "no path brings up a second poller on the same token" - a subject swarm
// must be flagged as conflicting iff some OTHER fleet swarm's own creds
// file carries the byte-identical token. Collisions are CONSTRUCTED (one
// swarm's token copied onto another's), never left to chance - two
// independently-generated random tokens colliding by luck would make this
// generator's reach into the "conflict exists" state astronomically rare,
// exactly the failure mode this ticket's own role instructions warn about.
const distinctNamesArb = fc
  .uniqueArray(fc.constantFrom('fes', 'fes2', 'fes3', 'staging', 'secondary'), { minLength: 2, maxLength: 4 })
  .map((names) => names.slice());
const forceCollisionArb = fc.boolean();
const saltArb = fc.integer({ min: 0, max: 1_000_000 });

test('property: a swarm is flagged as conflicting iff another fleet swarm genuinely holds the identical token', () => {
  const seenConflict = { true: 0, false: 0 };
  fc.assert(
    fc.property(distinctNamesArb, forceCollisionArb, saltArb, (names, forceCollision, salt) => {
      const fleetHome = mkTmpDir('bl622-prop-uniq-');
      try {
        const tokens = {};
        names.forEach((name, i) => {
          tokens[name] = `${name}-token-${salt}-${i}`;
        });
        if (forceCollision) {
          // Construct the collision by deriving the second swarm's token
          // from the first's - a real duplicate, not a coincidence.
          tokens[names[1]] = tokens[names[0]];
        }
        names.forEach((name) => writeFleetCredsFile(fleetHome, name, { botToken: tokens[name], chatId: 'c', bridgePort: 8765 }));

        const subject = names[names.length - 1];
        const subjectToken = tokens[subject];
        const expectedConflictor = names.find((name) => name !== subject && tokens[name] === subjectToken) || null;
        seenConflict[String(expectedConflictor !== null)] += 1;

        const actualConflictor = checkConflict(fleetHome, subject, subjectToken);

        assert.equal(
          actualConflictor,
          expectedConflictor,
          `names=${JSON.stringify(names)} subject=${subject} forceCollision=${forceCollision}`
        );
      } finally {
        rmQuiet(fleetHome);
      }
    }),
    { numRuns: 30 }
  );
  assert.ok(seenConflict.true > 0, 'generator reach floor: must construct at least one genuine collision');
  assert.ok(seenConflict.false > 0, 'generator reach floor: must generate at least one collision-free trial');

  // Non-vacuous per BL-654: a nil token never conflicts with anything.
  const fleetHome = mkTmpDir('bl622-prop-uniq-nil-');
  try {
    writeFleetCredsFile(fleetHome, 'fes', { botToken: 'fes-token', chatId: 'c', bridgePort: 8765 });
    assert.equal(checkConflict(fleetHome, 'fes2', null), null);
  } finally {
    rmQuiet(fleetHome);
  }
});
