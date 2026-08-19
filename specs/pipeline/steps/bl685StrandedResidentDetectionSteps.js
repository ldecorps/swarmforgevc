'use strict';

// BL-685: step handlers for "A mono-router resident stranded off its home
// role is detected from outside its own turn". Drives the REAL
// swarmforge/scripts/babysitter_check.bb entry point against disposable
// fixture roots - never the pure check directly (qa_e2e_procedure step 2:
// a predicate only a test calls is the BL-419 shape). Pane state is
// injected via a PATH-stub tmux (the test_babysitter_check.sh idiom);
// scenario 04's nudge dedup runs against a REAL fake coordinator tmux pane
// (the bl631 pattern), tracked through the shared fixtureReaper.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { track, reap } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BABYSITTER_CHECK = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitter_check.bb');

const FEATURE = 'A mono-router resident stranded off its home role is detected from outside its own turn';

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    reap(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  return root;
}

function backdate(p, secondsAgo) {
  const t = (Date.now() - secondsAgo * 1000) / 1000;
  fs.utimesSync(p, t, t);
}

// A mono-router fixture root: identity declares rotation router, roles.tsv
// has home=coder (first non-coordinator row) plus a master-resident
// specifier and the coordinator, a git repo so the pipeline-code check has
// refs, and empty mailboxes for every role.
function mkFixtureRoot() {
  const root = mkTmp('sfvc-bl685-');
  const sf = path.join(root, '.swarmforge');
  fs.mkdirSync(path.join(sf, 'handoffs', 'failed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  for (const box of ['new', 'in_process']) {
    fs.mkdirSync(path.join(root, '.worktrees', 'coder', '.swarmforge', 'handoffs', 'inbox', box), { recursive: true });
    fs.mkdirSync(path.join(sf, 'handoffs', 'specifier', 'inbox', box), { recursive: true });
    fs.mkdirSync(path.join(sf, 'handoffs', 'coordinator', 'inbox', box), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'meminfo'), 'MemAvailable:    8000000 kB\n');
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  execFileSync('git', ['-C', root, 'branch', 'swarmforge-QA']);
  fs.writeFileSync(path.join(sf, 'swarm-identity'), 'rotation\trouter\n');
  fs.writeFileSync(
    path.join(sf, 'roles.tsv'),
    `coder\tcoder\t${path.join(root, '.worktrees', 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `specifier\tspecifier\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n` +
      `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`
  );
  return root;
}

function setActiveRole(root, role, { minutesAgo = 20 } = {}) {
  const marker = path.join(root, '.swarmforge', 'mono-router-active-role');
  fs.writeFileSync(marker, `${role}\n`);
  backdate(marker, minutesAgo * 60);
}

// A PATH-stub tmux that logs every call and reports the resident pane
// present with a controllable capture (idle prompt vs busy footer) - the
// test_babysitter_check.sh idiom, PATH-resolved, never chmod-for-failure.
function mkStubTmuxBin(root, { paneText = '> \n' } = {}) {
  const bin = path.join(root, 'stub-bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(root, 'tmux-calls.log');
  fs.writeFileSync(log, '');
  const script = `#!/usr/bin/env bash
echo "$*" >> "${log}"
for arg in "$@"; do
  if [[ "$arg" == "has-session" ]]; then exit 0; fi
  if [[ "$arg" == "list-panes" ]]; then echo "999"; exit 0; fi
  if [[ "$arg" == "capture-pane" ]]; then printf '%s' ${JSON.stringify(paneText)}; exit 0; fi
done
exit 0
`;
  fs.writeFileSync(path.join(bin, 'tmux'), script);
  fs.chmodSync(path.join(bin, 'tmux'), 0o755);
  // A socket pointer so the sweep's pane gather has something to call.
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  return { bin, log };
}

function runSweep(root, { nudge = false, stubBin } = {}) {
  const env = { ...process.env, BABYSITTER_MEMINFO_PATH: path.join(root, 'meminfo') };
  if (stubBin) env.PATH = `${stubBin}:${env.PATH}`;
  const args = [BABYSITTER_CHECK, root];
  if (nudge) args.push('--nudge');
  try {
    const stdout = execFileSync('bb', args, { encoding: 'utf8', env });
    return { exitCode: 0, output: stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function strandedFindings(output) {
  return output.split('\n').filter((l) => l.includes('[resident-stranded-'));
}

// Scenario 04: a REAL fake coordinator tmux pane so --nudge reaches
// nudge-resident!'s :nudged branch (the only path that persists dedup
// state) for real - the exact bl631 pattern, fixtureReaper-tracked.
function addFakeCoordinatorPane(root) {
  const sock = path.join(root, 'coord.sock');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);
  execFileSync('tmux', [
    '-S', sock, 'new-session', '-d', '-s', 'swarmforge-coordinator',
    'bash', '-c', 'exec -a "claude --remote-control fake" sleep 999 & wait',
  ]);
  track(root);
  return sock;
}

// Scenario 02's <situation> column - each row shapes the fixture. Every
// value is an explicit KNOWN_VALUES entry; an unknown row throws.
const SITUATION_BUILDERS = {
  'in its home role and idle': (ctx) => {
    setActiveRole(ctx.root, 'coder', { minutesAgo: 20 });
    ctx.stub = mkStubTmuxBin(ctx.root);
  },
  'in a non-home role and busy': (ctx) => {
    setActiveRole(ctx.root, 'specifier', { minutesAgo: 20 });
    // The busy footer classify-pane-busy? recognises, on the RESIDENT
    // (home) pane - the one physical pane a mono-router pack has.
    ctx.stub = mkStubTmuxBin(ctx.root, { paneText: '✻ Cogitating… (42s · esc to interrupt)\n' });
  },
  'in a non-home role holding an in_process parcel': (ctx) => {
    setActiveRole(ctx.root, 'specifier', { minutesAgo: 20 });
    ctx.stub = mkStubTmuxBin(ctx.root);
    fs.writeFileSync(
      path.join(ctx.root, '.swarmforge', 'handoffs', 'specifier', 'inbox', 'in_process', '10_work.handoff'),
      'id: w1\nfrom: coordinator\nto: specifier\npriority: 10\ntype: git_handoff\ntask: BL-T\ncommit: aaaaaaaaaa\n\nbody\n'
    );
  },
  'in a non-home role idle within the grace period': (ctx) => {
    setActiveRole(ctx.root, 'specifier', { minutesAgo: 2 });
    ctx.stub = mkStubTmuxBin(ctx.root);
  },
  'in a non-home role having asked for dispatch': (ctx) => {
    setActiveRole(ctx.root, 'specifier', { minutesAgo: 20 });
    ctx.stub = mkStubTmuxBin(ctx.root);
    fs.writeFileSync(
      path.join(ctx.root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new', '00_dispatch.handoff'),
      'id: d1\nfrom: specifier\nto: coordinator\npriority: 00\ntype: note\nmessage: promote and route next\n\nbody\n'
    );
  },
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a mono-router swarm whose home role is coder$/,
    (ctx) => {
      ctx.root = mkFixtureRoot();
    },
    FEATURE
  );

  // ── Scenario 01 givens ───────────────────────────────────────────────
  registry.defineScoped(
    /^the resident is in a non-home role$/,
    (ctx) => {
      setActiveRole(ctx.root, 'specifier', { minutesAgo: 20 });
    },
    FEATURE
  );

  registry.defineScoped(
    /^its mailbox is empty$/,
    () => {
      // The fixture's mailboxes start empty - nothing to do; the step
      // exists so the scenario states the suppressor explicitly.
    },
    FEATURE
  );

  registry.defineScoped(
    /^its pane has been idle past the grace period$/,
    (ctx) => {
      ctx.stub = mkStubTmuxBin(ctx.root);
    },
    FEATURE
  );

  // ── Scenario 03/04/05 given - registered BEFORE the scenario 02
  // outline's greedy (.+) pattern below, which would otherwise shadow
  // it (registry.resolve is first-match, the BL-300 lesson).
  registry.defineScoped(
    /^the resident is stranded in a non-home role$/,
    (ctx) => {
      setActiveRole(ctx.root, 'specifier', { minutesAgo: 20 });
      ctx.stub = mkStubTmuxBin(ctx.root);
    },
    FEATURE
  );

  // ── Scenario 02 given (Outline) ──────────────────────────────────────
  registry.defineScoped(
    /^the resident is (.+)$/,
    (ctx, situation) => {
      if (!Object.prototype.hasOwnProperty.call(SITUATION_BUILDERS, situation)) {
        throw new Error(`unknown <situation> token: ${situation}`);
      }
      SITUATION_BUILDERS[situation](ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no rotate instruction was ever issued to it$/,
    (ctx) => {
      // By construction: no completed/done parcel in this fixture carries a
      // rotate pattern - assert it rather than trust it.
      for (const rel of ['completed', 'done']) {
        const dir = path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', rel);
        assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0);
      }
    },
    FEATURE
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the deterministic sweep runs$/,
    (ctx) => {
      ctx.result = runSweep(ctx.root, { stubBin: ctx.stub && ctx.stub.bin });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the sweep runs twice within the cooldown$/,
    (ctx) => {
      // Real tmux for the nudge path: the PATH stub is replaced by a real
      // fake coordinator pane, so nudge-resident! delivers for real and
      // the dedup state is genuinely written and re-read.
      addFakeCoordinatorPane(ctx.root);
      ctx.first = runSweep(ctx.root, { nudge: true });
      ctx.second = runSweep(ctx.root, { nudge: true });
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a stranded-resident finding is reported$/,
    (ctx) => {
      assert.ok(
        strandedFindings(ctx.result.output).length > 0,
        `expected a resident-stranded finding, got:\n${ctx.result.output}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the finding names the role the resident is stuck in$/,
    (ctx) => {
      const [finding] = strandedFindings(ctx.result.output);
      assert.match(finding, /resident-stranded-specifier/);
      assert.match(finding, /'specifier'/);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no stranded-resident finding is reported$/,
    (ctx) => {
      assert.deepEqual(
        strandedFindings(ctx.result.output),
        [],
        `expected no resident-stranded finding, got:\n${ctx.result.output}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^no rotate-unhonored finding is reported$/,
    (ctx) => {
      assert.ok(
        !ctx.result.output.includes('rotate-unhonored'),
        `expected no rotate-unhonored finding, got:\n${ctx.result.output}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the coordinator is nudged exactly once$/,
    (ctx) => {
      const nudges = (s) => (s.match(/NUDGED coordinator/g) || []).length;
      assert.equal(nudges(ctx.first.output), 1, `expected the first sweep to nudge once, got:\n${ctx.first.output}`);
      assert.equal(nudges(ctx.second.output), 0, `expected the second sweep deduped, got:\n${ctx.second.output}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no keystroke is sent to the resident pane$/,
    (ctx) => {
      const log = fs.readFileSync(ctx.stub.log, 'utf8');
      assert.ok(
        !/send-keys/.test(log),
        `expected the sweep to send no keystroke anywhere (it observes and nudges, never remediates), got tmux calls:\n${log}`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
