'use strict';

// BL-927: step handlers for "the rotate gate protects the mailbox of the
// role the pane is really running". Drives the REAL
// handoff-lib/departing-role-blocking-handoff and mono-router-lib/
// rotate-gate-decision (composed exactly as respawn-as! composes them)
// against a fixture mono-router layout via `bb -e`, injecting the pane's
// live identity through departing-role-blocking-handoff's own
// :live-role-fn seam - no live tmux session anywhere in scenarios 01-03.
// Scenario 04 drives handoff-lib/rotate-resident-to! (the daemon's own,
// ungated, rotation entry) with a fake tmux stub on PATH, same shape as
// test_rotate_to_role_stuck_parcel_gate.sh's own scenario 04.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFF_LIB = path.join(SCRIPTS_DIR, 'handoff_lib.bb');

const FEATURE_NAME = 'the rotate gate protects the mailbox of the role the pane is really running';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_DECISIONS = { proceed: 'proceed', refuse: 'refuse' };
function knownDecision(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_DECISIONS, value)) {
    throw new Error(`bl927: unrecognized <decision> example value "${value}"`);
  }
  return KNOWN_DECISIONS[value];
}

const KNOWN_MARKER_STATES = { missing: 'missing', blank: 'blank' };
function knownMarkerState(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_MARKER_STATES, value)) {
    throw new Error(`bl927: unrecognized <marker state> example value "${value}"`);
  }
  return KNOWN_MARKER_STATES[value];
}

function cljStr(s) {
  // Clojure string-literal escaping needs are a strict subset of JSON's for
  // the plain ASCII fixture values (role names, absolute paths) this file
  // ever embeds - JSON.stringify's quoting/backslash-escaping is safe reuse.
  return JSON.stringify(String(s));
}

function mkFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl927-rotate-gate-'));
  const swarmDir = path.join(dir, '.swarmforge');
  fs.mkdirSync(swarmDir, { recursive: true });
  fs.writeFileSync(
    path.join(swarmDir, 'roles.tsv'),
    [
      `coder\tmaster\t${dir}\tswarmforge-coder\tCoder\tclaude\ttask`,
      `cleaner\tmaster\t${dir}\tswarmforge-cleaner\tCleaner\tclaude\tbatch`,
      `documenter\tmaster\t${dir}\tswarmforge-documenter\tDocumenter\tclaude\ttask`,
    ].join('\n') + '\n'
  );
  return dir;
}

function writeMarker(dir, content) {
  fs.writeFileSync(path.join(dir, '.swarmforge', 'mono-router-active-role'), content);
}

// BL-927 bounce (fixture-dir leak, same shape as BL-929's/BL-931's own
// remediations): the Background's mkFixture() creates ctx.dir, but a Given
// step below (marker-state validation) can throw BEFORE either When step's
// own try/finally ever runs - a try/finally local to the throwing step
// can't save it either, since the dir was created by the earlier Background
// step. Every throw that can fire before a When step's cleanup must release
// the fixture itself; idempotent (force: true) so a later, already-cleaned
// ctx.dir is a no-op.
function cleanupFixture(ctx) {
  if (ctx.dir) {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  }
}

function queueParcel(dir, role, name) {
  const inProcess = path.join(dir, '.swarmforge', 'handoffs', role, 'inbox', 'in_process');
  fs.mkdirSync(inProcess, { recursive: true });
  fs.writeFileSync(
    path.join(inProcess, `00_${name}.handoff`),
    `id: ${name}\nfrom: coordinator\nto: ${role}\npriority: 50\ntype: git_handoff\ntask: BL-${name}\ncommit: aaaaaaaaaa\n\nmerge_and_process coordinator aaaaaaaaaa\n`
  );
}

function runBb(source, opts) {
  const result = spawnSync('bb', ['-e', source], { encoding: 'utf8', timeout: 15000, ...opts });
  if (result.status !== 0) {
    throw new Error(`bb -e failed (exit ${result.status}): ${result.stderr}\n${result.stdout}`);
  }
  return result.stdout.trim();
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a mono-router pack whose single resident pane serves every role in turn$/,
    (ctx) => {
      ctx.dir = mkFixture();
    },
    FEATURE_NAME
  );

  // ── Given: marker ────────────────────────────────────────────────────
  registry.defineScoped(
    /^the active-role marker names "([^"]+)"$/,
    (ctx, marker) => {
      writeMarker(ctx.dir, marker);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the active-role marker is (missing|blank)$/,
    (ctx, state) => {
      let known;
      try {
        known = knownMarkerState(state);
      } catch (err) {
        cleanupFixture(ctx);
        throw err;
      }
      // "missing": write nothing - no marker file at all.
      if (known === 'blank') {
        writeMarker(ctx.dir, '   \n');
      }
    },
    FEATURE_NAME
  );

  // ── Given: live identity ─────────────────────────────────────────────
  registry.defineScoped(
    /^the resident pane's live identity is "([^"]+)"$/,
    (ctx, live) => {
      ctx.liveRole = live;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the resident pane's live identity cannot be read$/,
    (ctx) => {
      ctx.liveRole = null;
    },
    FEATURE_NAME
  );

  // ── Given: a real blocking parcel ────────────────────────────────────
  registry.defineScoped(
    /^role "([^"]+)" holds a real parcel in its in_process box$/,
    (ctx, role) => {
      queueParcel(ctx.dir, role, `stuck-${role}`);
    },
    FEATURE_NAME
  );

  // ── When: resident-invoked rotation (scenarios 01-03) ────────────────
  registry.defineScoped(
    /^the resident invokes rotation to "([^"]+)"$/,
    (ctx, target) => {
      try {
        const liveExpr = ctx.liveRole == null ? 'nil' : cljStr(ctx.liveRole);
        const source = [
          `(load-file ${cljStr(HANDOFF_LIB)})`,
          `(handoff-lib/set-project-root! ${cljStr(ctx.dir)})`,
          `(let [result (handoff-lib/departing-role-blocking-handoff {:live-role-fn (fn [] ${liveExpr})})`,
          `      decision (mono-router-lib/rotate-gate-decision`,
          `                {:blocking-file (:blocking-file result)`,
          `                 :force? false`,
          `                 :active-role (:role result)`,
          `                 :target-role ${cljStr(target)}})]`,
          `  (println (or (:role result) "NONE"))`,
          `  (println (name decision)))`,
        ].join('\n');
        // BL-932-batch hardening (BL-909/BL-927): capture the RESOLVED
        // departing role alongside the decision, not just the decision.
        // BL-113 gherkin mutation found that mutating <marker>/<live> to an
        // unresolvable role string still yields the SAME "proceed" decision
        // (via the pre-existing unknown-role fail-open path) as a correctly
        // resolved, diverged live role with an empty box - two different
        // mechanisms converging on one observable decision. Recording the
        // resolved role lets "the departing role resolved is the pane's live
        // identity" (scenario 01 only) distinguish them.
        const [roleLine, decisionLine] = runBb(source).split('\n');
        ctx.resolvedRole = roleLine === 'NONE' ? null : roleLine;
        ctx.decision = decisionLine;
      } finally {
        // BL-927 bounce: both Then steps that follow read only the
        // in-memory ctx.resolvedRole/ctx.decision captured above, never
        // ctx.dir again - safe to release the fixture here even if runBb
        // threw.
        cleanupFixture(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the rotate gate decision is "([^"]+)"$/,
    (ctx, expected) => {
      const known = knownDecision(expected);
      if (ctx.decision !== known) {
        throw new Error(`expected rotate gate decision "${known}", got "${ctx.decision}"`);
      }
    },
    FEATURE_NAME
  );

  // Scenario 01 only (invariant 1): across all three examples the departing
  // role resolves to the pane's LIVE identity - either directly (live
  // diverges from marker and resolves) or coincidentally (marker and live
  // agree, so the marker-role branch yields the same value). A regression
  // that fell back to the marker's role, or to fail-open, whenever it
  // should have used live identity would fail this even when the plain
  // proceed/refuse decision happens to still match.
  registry.defineScoped(
    /^the departing role resolved is the pane's live identity$/,
    (ctx) => {
      if (ctx.resolvedRole !== ctx.liveRole) {
        throw new Error(
          `expected the departing role to resolve to the pane's live identity "${ctx.liveRole}", got "${ctx.resolvedRole}"`
        );
      }
    },
    FEATURE_NAME
  );

  // ── When: daemon-driven rotation (scenario 04) ───────────────────────
  registry.defineScoped(
    /^the handoff daemon's own chase rotates the resident to "([^"]+)"$/,
    (ctx, target) => {
      try {
        // BL-927 bounce: nested inside ctx.dir (not a second, independent
        // mkdtempSync under os.tmpdir()) so cleanupFixture's single rmSync
        // of ctx.dir below releases it too - same "no sibling temp roots"
        // idiom BL-931's own fixture uses for its fake tmux bin.
        const fakeBin = path.join(ctx.dir, 'bin');
        fs.mkdirSync(fakeBin, { recursive: true });
        const tmuxLog = path.join(ctx.dir, 'tmux-calls.log');
        fs.writeFileSync(tmuxLog, '');
        fs.writeFileSync(path.join(fakeBin, 'tmux'), `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(tmuxLog)}\nexit 0\n`);
        fs.chmodSync(path.join(fakeBin, 'tmux'), 0o755);

        const launchDir = path.join(ctx.dir, '.swarmforge', 'launch');
        fs.mkdirSync(launchDir, { recursive: true });
        fs.writeFileSync(path.join(launchDir, `${target}.sh`), '#!/bin/sh\nexit 0\n');
        fs.chmodSync(path.join(launchDir, `${target}.sh`), 0o755);

        fs.writeFileSync(path.join(ctx.dir, 'fake.sock'), '');
        fs.writeFileSync(path.join(ctx.dir, '.swarmforge', 'tmux-socket'), `${path.join(ctx.dir, 'fake.sock')}\n`);

        const confDir = path.join(ctx.dir, 'swarmforge');
        fs.mkdirSync(confDir, { recursive: true });
        fs.writeFileSync(path.join(confDir, 'swarmforge.conf'), 'config rotation router\n');

        const source = [
          `(load-file ${cljStr(HANDOFF_LIB)})`,
          `(handoff-lib/set-project-root! ${cljStr(ctx.dir)})`,
          `(println (:ok (handoff-lib/rotate-resident-to! ${cljStr(target)})))`,
        ].join('\n');
        ctx.rotateResult = runBb(source, {
          cwd: ctx.dir,
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
        });
        ctx.tmuxLog = fs.readFileSync(tmuxLog, 'utf8');
      } finally {
        // BL-927 bounce: the one Then step that follows reads only
        // ctx.rotateResult/ctx.tmuxLog, already captured in memory above -
        // safe to release the fixture here even if runBb threw.
        cleanupFixture(ctx);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the rotation proceeds without consulting the rotate gate$/,
    (ctx) => {
      if (ctx.rotateResult !== 'true') {
        throw new Error(`expected rotate-resident-to! to succeed (:ok true) despite a real blocking parcel, got: ${ctx.rotateResult}`);
      }
      if (!ctx.tmuxLog.includes('respawn-pane')) {
        throw new Error(`expected a respawn-pane tmux call proving the rotation actually ran, log: ${ctx.tmuxLog}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
