'use strict';

// BL-1017: step handlers for "a vanished standing role session is recreated,
// not merely alerted about".
//
// Scenarios 01, 02 and 04 drive the REAL sweep CLI (babysitter_check.sh)
// against a disposable fixture root, not the pure lib. That is deliberate and
// is the point of this ticket's required_wiring: a repair decision the lib
// returns but the live caller never consumes is the BL-419 shape ("mechanism
// built, wired nowhere"), and only running the actual CLI can tell the two
// apart. These three scenarios therefore also discharge the ticket's
// qa_e2e_procedure step 3.
//
// Scenario 03 ("a present pane is never treated as a missing session") drives
// the pure decision function instead. A PRESENT pane requires a live tmux
// session, which is the environmentally-unsuitable boundary this project's
// engineering rules keep out of the unit/acceptance lanes - and spawning real
// tmux sessions here could disturb the live swarm. The pane-present branch is
// a pure decision, so it is asserted purely, and the live-tmux half is
// recorded as the manual procedure in the ticket's qa_e2e_procedure step 4.
//
// SAFETY: every fixture root is created with NO .swarmforge/tmux-socket, so
// the sweep resolves a nil socket and issues no tmux command whatsoever. A
// repair is still DECIDED and consumed (it reports no-socket), which is
// exactly what these scenarios assert. Nothing here can touch a live pane.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');

const FEATURE = 'a vanished standing role session is recreated, not merely alerted about';

// The roles.tsv order the fixtures use. Under a rotation-router pack the
// FIRST role is the resident and only it plus the coordinator stand, so
// "cleaner" is a non-resident - the mono-router case invariant 1 protects.
const FIXTURE_ROLES = ['coder', 'specifier', 'cleaner', 'coordinator'];

// Scenario Outline handler rule: the substituted parameter is validated
// against the closed set the feature's own Examples use. An unknown row is a
// hard failure, never a passthrough that would silently assert nothing.
const KNOWN_PROCESS_STATES = new Map([
  ['a live claude process', { 'has-claude-process?': true, 'process-gather-failed?': false }],
  ['no claude process under it', { 'has-claude-process?': false, 'process-gather-failed?': false }],
  ['a failed process gather', { 'has-claude-process?': false, 'process-gather-failed?': true }],
]);

function writeFile(root, rel, contents) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

// A fixture project root shaped like a real one, minus the tmux socket (see
// the SAFETY note above). `router` decides whether the pack declares
// `config rotation router`, which is what makes a non-resident role
// should-not-stand.
function mkFixtureRoot({ router = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1017-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'failed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  writeFile(
    root,
    path.join('.swarmforge', 'roles.tsv'),
    FIXTURE_ROLES.map((r) => `${r}\t-\t-\tswarmforge-${r}`).join('\n') + '\n'
  );
  for (const role of FIXTURE_ROLES) {
    writeFile(root, path.join('.swarmforge', 'launch', `${role}.sh`), '#!/usr/bin/env bash\ntrue\n');
  }
  const confPath = path.join(root, 'pack.conf');
  fs.writeFileSync(confPath, router ? 'config rotation router\n' : 'config standing full\n');
  writeFile(
    root,
    path.join('.swarmforge', 'swarm-identity'),
    `active_backlog_max_depth_conf_path\t${confPath}\n`
  );
  return root;
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

// Every handler body runs through this so a failing assertion can never leak
// the fixture directory (engineering rule: an mkdtemp fixture is removed in a
// finally, never only after the last assertion).
function guarded(ctx, fn, { done = false } = {}) {
  try {
    fn();
  } catch (e) {
    cleanup(ctx);
    throw e;
  }
  if (done) {
    cleanup(ctx);
  }
}

function runSweep(ctx) {
  const result = spawnSync('bash', [CHECK_SH, ctx.root], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`babysitter_check.sh exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

// bb -e against the real lib, for the pane-present branch only.
function cljKeyVals(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `:${k} ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
}

function checkLiveSession(opts) {
  const code =
    `(load-file "${SWEEP_LIB}") (require '[babysitterd-sweep-lib :as sw]) ` +
    `(println (pr-str (sw/check-live-session {${cljKeyVals(opts)}})))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function critLineFor(output, role) {
  return output
    .split('\n')
    .find((l) => l.includes(`CRIT [pane-${role}]`) && l.includes(`swarmforge-${role}: tmux session missing`));
}

function repairLineFor(output, role) {
  return output.split('\n').find((l) => l.includes('REPAIR [') && l.includes(`swarmforge-${role}`));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  // "rotation is empty" = a standing full-forge pack: no rotation router, so
  // every configured role is expected to hold a session. Scenario 02
  // explicitly overrides this to the router case.
  scoped(/^a standing full-forge pack whose rotation is empty$/, (ctx) => {
    ctx.router = false;
    ctx.mode = null;
    ctx.output = null;
  });

  // ── Givens ───────────────────────────────────────────────────────────
  scoped(/^role "([^"]+)" whose pane does not exist$/, (ctx, role) => {
    assert.ok(FIXTURE_ROLES.includes(role), `unknown fixture role "${role}" - known: ${FIXTURE_ROLES}`);
    ctx.role = role;
    ctx.mode = 'cli';
  });

  scoped(/^role "([^"]+)" whose pane exists$/, (ctx, role) => {
    assert.ok(FIXTURE_ROLES.includes(role), `unknown fixture role "${role}" - known: ${FIXTURE_ROLES}`);
    ctx.role = role;
    ctx.mode = 'pure';
    ctx.pureOpts = { role, 'pane-exists?': true, 'should-stand?': true };
  });

  scoped(/^the topology says that role should stand$/, (ctx) => {
    ctx.router = false;
  });

  // The suppression is not asserted by fiat: the fixture declares a real
  // rotation-router pack and the sweep resolves should-stand? from topology
  // itself, exactly as it does live.
  scoped(/^the topology says that role should not stand$/, (ctx) => {
    guarded(ctx, () => {
      assert.notEqual(ctx.role, FIXTURE_ROLES[0], 'the resident always stands - pick a non-resident role');
      assert.notEqual(ctx.role, 'coordinator', 'the coordinator always stands - pick a non-resident role');
      ctx.router = true;
    });
  });

  scoped(/^the pane process state is (.+)$/, (ctx, processState) => {
    guarded(ctx, () => {
      const opts = KNOWN_PROCESS_STATES.get(processState);
      assert.ok(opts, `unknown process state "${processState}" - the handlers know ${[...KNOWN_PROCESS_STATES.keys()]}`);
      Object.assign(ctx.pureOpts, opts);
    });
  });

  // Pre-seeds the persisted repair ledger the way a previous sweep would have
  // left it, so the cooldown is exercised through the SAME state file the
  // live daemon reads - not through an injected flag.
  scoped(/^that role was already issued a repair inside the cooldown window$/, (ctx) => {
    ctx.seedRepairState = true;
  });

  // ── When ─────────────────────────────────────────────────────────────
  scoped(/^the sweep assesses that role$/, (ctx) => {
    guarded(ctx, () => {
      if (ctx.mode === 'pure') {
        ctx.pureResult = checkLiveSession(ctx.pureOpts);
        return;
      }
      ctx.root = mkFixtureRoot({ router: ctx.router });
      if (ctx.seedRepairState) {
        writeFile(
          ctx.root,
          path.join('.swarmforge', 'babysitterd', 'session-repairs.json'),
          JSON.stringify({ [ctx.role]: { attempts: 1, 'last-ms': Date.now() } })
        );
      }
      ctx.output = runSweep(ctx);
    });
  });

  // ── Thens ────────────────────────────────────────────────────────────
  scoped(/^a CRIT reporting the missing session is still emitted$/, (ctx) => {
    guarded(ctx, () => {
      assert.ok(
        critLineFor(ctx.output, ctx.role),
        `no missing-session CRIT for ${ctx.role} - a repair must never swallow its alert:\n${ctx.output}`
      );
    });
  });

  scoped(/^a repair decision to ensure that role's session is emitted alongside it$/, (ctx) => {
    guarded(
      ctx,
      () => {
        const line = repairLineFor(ctx.output, ctx.role);
        assert.ok(line, `no repair decision consumed for ${ctx.role}:\n${ctx.output}`);
        // The decision reached the live executor rather than merely being
        // returned by the lib: the fixture has no tmux socket, so the ONLY
        // way this status can be reported is by the caller having acted on it.
        assert.match(line, /REPAIR \[no-socket\]/);
        // And it was recorded durably, which is what bounds the next sweep.
        const ledger = JSON.parse(
          fs.readFileSync(path.join(ctx.root, '.swarmforge', 'babysitterd', 'session-repairs.json'), 'utf8')
        );
        assert.equal(ledger[ctx.role].attempts, 1);
      },
      { done: true }
    );
  });

  scoped(/^no CRIT is emitted$/, (ctx) => {
    guarded(ctx, () => {
      assert.equal(
        critLineFor(ctx.output, ctx.role),
        undefined,
        `a role the topology says should not stand must not be CRIT-ed:\n${ctx.output}`
      );
    });
  });

  scoped(/^no repair decision is emitted$/, (ctx) => {
    guarded(
      ctx,
      () => {
        if (ctx.mode === 'pure') {
          assert.ok(
            !ctx.pureResult.includes(':repair'),
            `a present pane must never yield a session repair: ${ctx.pureResult}`
          );
          return;
        }
        assert.equal(
          repairLineFor(ctx.output, ctx.role),
          undefined,
          `a repair was issued when it should have been withheld:\n${ctx.output}`
        );
      },
      { done: true }
    );
  });
}

module.exports = { registerSteps };
