'use strict';

// BL-921: chase must not trust the mono-router active-role marker alone -
// it must independently confirm the resident pane's own live identity
// before treating "resident already IS the target role" as true. Scenarios
// 01-03 drive the REAL pure functions in mono_router_lib.bb via `bb -e`
// (same pattern as bl636RotatePreferenceParcelPrioritySteps.js). Scenario
// 04 drives the REAL handoffd.bb daemon (--chase-sweep-once, added by this
// ticket) against a fixture tmux that always reports the pane's live
// identity as "coder" while the marker claims "cleaner" - the actual
// divergence shape from the 2026-08-18 incident.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mono_router_lib.bb');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');
const FEATURE = "Chase verifies the resident pane's live identity before waking it";

function cljVal(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  throw new Error(`unsupported clj value: ${v}`);
}
function cljMap(obj) {
  const parts = Object.entries(obj).map(([k, v]) => `:${k} ${cljVal(v)}`);
  return `{${parts.join(' ')}}`;
}

function bbEval(expr) {
  const code = `(load-file "${LIB}") (println (pr-str ${expr}))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed for: ${expr}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function readKeyword(pr) {
  // pr-str of a keyword prints as ":foo"; strip the leading colon.
  return pr.startsWith(':') ? pr.slice(1) : JSON.parse(pr);
}

// "unreadable" is the Gherkin table's way of saying the live-identity probe
// found nothing parseable - the real tmux-probing site (handoffd.bb's
// resident-live-role) returns nil in exactly that case.
function liveRoleArg(literal) {
  return literal === 'unreadable' ? null : literal;
}

function ensureState(ctx) {
  if (!ctx.bl921) {
    ctx.bl921 = {
      residentExists: true,
      ownSessionRoles: new Set(),
      marker: null,
      liveIdentity: null,
    };
  }
  return ctx.bl921;
}

// Idempotent, mirroring bl870WakeAttributionSteps.js's cleanup(ctx): safe to
// call from both the fixture-creation step's failure path and the
// downstream assertion step's finally, whichever runs last.
function cleanup(ctx) {
  const st = ctx.bl921;
  if (!st || !st.fixtureRoot) return;
  fs.rmSync(st.fixtureRoot, { recursive: true, force: true });
  st.fixtureRoot = null;
}

function registerSteps(registry) {
  registry.defineScoped(/^a mono-router pack whose resident pane session exists$/, (ctx) => {
    ensureState(ctx).residentExists = true;
  }, FEATURE);

  registry.defineScoped(/^the role "([^"]+)" has no standing session of its own$/, (ctx, role) => {
    ensureState(ctx).ownSessionRoles.delete(role);
  }, FEATURE);

  registry.defineScoped(/^the role "([^"]+)" has a standing session of its own$/, (ctx, role) => {
    ensureState(ctx).ownSessionRoles.add(role);
  }, FEATURE);

  registry.defineScoped(/^the active-role marker reads "([^"]+)"$/, (ctx, marker) => {
    ensureState(ctx).marker = marker;
  }, FEATURE);

  registry.defineScoped(/^the resident pane's live identity is "([^"]+)"$/, (ctx, liveIdentity) => {
    ensureState(ctx).liveIdentity = liveIdentity;
  }, FEATURE);

  registry.defineScoped(/^the mailbox of "([^"]+)" holds an unclaimed handoff$/, (ctx, role) => {
    ensureState(ctx).mailboxRole = role;
  }, FEATURE);

  // ── Scenarios 01/02: dormant-mailbox-chase-action ────────────────────────
  registry.defineScoped(/^chase decides how to poke the role "([^"]+)"$/, (ctx, role) => {
    const st = ensureState(ctx);
    const args = cljMap({
      'target-session-exists?': st.ownSessionRoles.has(role),
      'resident-session-exists?': st.residentExists,
      'active-role': st.marker,
      'target-role': role,
      'live-role': liveRoleArg(st.liveIdentity),
    });
    st.decision = readKeyword(bbEval(`(mono-router-lib/dormant-mailbox-chase-action ${args})`));
  }, FEATURE);

  registry.defineScoped(/^the decision is "([^"]+)"$/, (ctx, expected) => {
    const st = ensureState(ctx);
    if (st.decision !== expected) {
      throw new Error(`expected chase decision "${expected}", got "${st.decision}"`);
    }
  }, FEATURE);

  // ── Scenario 03: should-rotate-resident? ─────────────────────────────────
  registry.defineScoped(/^the rotation gate is asked whether to rotate the resident to "([^"]+)"$/, (ctx, role) => {
    const st = ensureState(ctx);
    const args = cljMap({
      'active-role': st.marker,
      'target-role': role,
      'live-role': liveRoleArg(st.liveIdentity),
      'resident-busy?': false,
      'last-rotate-at-ms': 0,
      'now-ms': 100000,
      'cooldown-ms': 30000,
    });
    st.gate = readKeyword(bbEval(`(mono-router-lib/should-rotate-resident? ${args})`));
  }, FEATURE);

  registry.defineScoped(/^the gate does not answer "([^"]+)"$/, (ctx, forbidden) => {
    const st = ensureState(ctx);
    if (st.gate === forbidden) {
      throw new Error(`gate answered "${forbidden}", which this scenario forbids`);
    }
  }, FEATURE);

  // ── Scenario 04: real daemon, --chase-sweep-once x N ─────────────────────
  registry.defineScoped(/^the chase sweep runs (\d+) times$/, (ctx, timesStr) => {
    const st = ensureState(ctx);
    const times = Number(timesStr);
    const root = mkSocketFixtureRoot('bl921-chase-');
    st.fixtureRoot = root;

    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });

    const coderWt = path.join(root, 'wt-coder');
    const cleanerWt = path.join(root, 'wt-cleaner');
    fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
    fs.mkdirSync(path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
    fs.mkdirSync(path.join(cleanerWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
    fs.mkdirSync(path.join(cleanerWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });

    fs.writeFileSync(
      path.join(root, '.swarmforge', 'roles.tsv'),
      `coder\tcoder\t${coderWt}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `cleaner\tcleaner\t${cleanerWt}\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n`
    );
    fs.writeFileSync(path.join(root, 'swarmforge.conf'), 'config rotation router\nconfig rotation_home coder\n');
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'swarm-identity'),
      `active_backlog_max_depth_conf_path\t${path.join(root, 'swarmforge.conf')}\nrotation\trouter\n`
    );
    fs.writeFileSync(path.join(root, '.swarmforge', 'mono-router-active-role'), `${st.marker}\n`);

    const sock = path.join(root, 'fake.sock');
    fs.writeFileSync(sock, '');
    fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${sock}\n`);

    const mailboxRole = st.mailboxRole || 'cleaner';
    const handoffFile = path.join(
      mailboxRole === 'cleaner' ? cleanerWt : coderWt,
      '.swarmforge', 'handoffs', 'inbox', 'new', '00_from_qa_to_role.handoff'
    );
    fs.writeFileSync(
      handoffFile,
      'id: t1\nfrom: qa\nto: ' + mailboxRole + '\npriority: 00\ntype: git_handoff\ntask: BL-921\ncommit: aaaaaaaaaa\n' +
      'created_at: 2026-08-18T09:00:00Z\nenqueued_at: 2026-08-18T09:00:00Z\n\nfixture\n'
    );
    const agedMs = Date.now() - 45000;
    fs.utimesSync(handoffFile, agedMs / 1000, agedMs / 1000);

    const fakeBin = path.join(root, 'bin');
    fs.mkdirSync(fakeBin, { recursive: true });
    const tmuxLog = path.join(root, 'tmux-calls.log');
    st.tmuxLog = tmuxLog;
    // The resident's live identity is whatever this scenario declared
    // (typically "coder", diverged from a marker claiming another role) -
    // every list-panes probe reports it, mirroring rotate-resident-to!'s
    // real `zsh '<root>/.swarmforge/launch/<role>.sh'` start command.
    const liveRoleScript = `#!/usr/bin/env bash
echo "$*" >> "${tmuxLog}"
if [[ "$*" == *"has-session"* && "$*" == *"swarmforge-${mailboxRole}"* ]]; then
  exit 1
fi
if [[ "$*" == *"list-panes"* ]]; then
  echo "zsh '${root}/.swarmforge/launch/${st.liveIdentity}.sh'"
  exit 0
fi
exit 0
`;
    fs.writeFileSync(path.join(fakeBin, 'tmux'), liveRoleScript);
    fs.chmodSync(path.join(fakeBin, 'tmux'), 0o755);

    try {
      for (let i = 0; i < times; i++) {
        const result = spawnSync('bb', [HANDOFFD, root, '--chase-sweep-once'], {
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
          encoding: 'utf8',
        });
        if (result.status !== 0) {
          throw new Error(`--chase-sweep-once run ${i + 1} failed:\n${result.stdout}\n${result.stderr}`);
        }
      }
      st.sweepsRun = times;
    } catch (e) {
      // Daemon invocation itself failed - the assertion step that would
      // otherwise clean up the fixture root never runs.
      cleanup(ctx);
      throw e;
    }
  }, FEATURE);

  registry.defineScoped(/^no wake text is injected into the resident pane$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      if (!st.tmuxLog || !fs.existsSync(st.tmuxLog)) {
        throw new Error('chase sweep fixture never ran - no tmux log to inspect');
      }
      const log = fs.readFileSync(st.tmuxLog, 'utf8');
      const wakeLines = log.split('\n').filter((l) => l.includes('send-keys'));
      if (wakeLines.length > 0) {
        throw new Error(
          `expected no send-keys wake injection across ${st.sweepsRun} sweeps, found ${wakeLines.length}:\n${wakeLines.join('\n')}`
        );
      }
    } finally {
      // Guarantee cleanup whether the assertion above passes or throws -
      // the failing case is exactly the one that most needs the fixture
      // preserved for evidence, and was previously the one that leaked it.
      cleanup(ctx);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
