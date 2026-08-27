'use strict';

// BL-1109: step handlers for starved check 10 treating a live in_process
// claim as motion even when the owner pane is idle, CRIT copy that never
// claims an empty mailbox when claims were gathered, and in_process gather
// sharing stuck-in-process's glob (batch_*/nested).
//
// Pure decision path: babysitterd_sweep_lib.bb/check-swarm-starved via bb.
// Gather path: load babysitter_check.bb against a disposable project-root
// and call the same glob-handoffs / stuck-in-process-glob production uses.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { track } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');
const CHECK_BB = path.join(SCRIPTS, 'babysitter_check.bb');

const FEATURE =
  'BL-1109 babysitter STARVED counts a live in_process claim as motion even when the owner pane is idle';

const KNOWN_MAILBOX = {
  'one non-abandoned in_process claim, owner idle': 'live-idle',
  'no pending and no in_process claims': 'empty',
};

const KNOWN_VERDICT = { clear: 'clear', starved: 'starved' };

const KNOWN_PATH_SHAPE = {
  'a role worktree inbox/in_process/*.handoff': 'flat-worktree',
  'a nested worktree **/inbox/in_process/*.handoff': 'nested-master',
  'a batch_* in_process directory handoff': 'batch-dir',
};

function cljVal(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(cljVal).join(' ')}]`;
  if (typeof v === 'object') {
    const parts = Object.entries(v).map(([k, val]) => `:${k} ${cljVal(val)}`);
    return `{${parts.join(' ')}}`;
  }
  throw new Error(`unsupported clj value: ${v}`);
}

function bbStarved(args) {
  const code =
    `(load-file ${JSON.stringify(SWEEP_LIB)})` +
    ` (require '[babysitterd-sweep-lib :as sw])` +
    ` (println (pr-str (sw/check-swarm-starved ${cljVal(args)})))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb check-swarm-starved failed:\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout.trim();
}

function findingNil(pr) {
  return /:finding nil/.test(pr);
}

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1109-'));
  track(root);
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'failed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  return root;
}

function writeHandoff(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'id: bl1109-fixture\nfrom: x\nto: x\ntype: work\n');
  return filePath;
}

function placeHandoff(root, shape) {
  if (shape === 'flat-worktree') {
    return writeHandoff(
      path.join(root, '.worktrees', 'qa', '.swarmforge', 'handoffs', 'inbox', 'in_process', 'bl1109-flat.handoff')
    );
  }
  if (shape === 'nested-master') {
    return writeHandoff(
      path.join(root, '.swarmforge', 'handoffs', 'documenter', 'inbox', 'in_process', 'bl1109-nested.handoff')
    );
  }
  if (shape === 'batch-dir') {
    return writeHandoff(
      path.join(
        root,
        '.worktrees',
        'coder',
        '.swarmforge',
        'handoffs',
        'inbox',
        'in_process',
        'batch_bl1109',
        'bl1109-batch.handoff'
      )
    );
  }
  throw new Error(`BL-1109: unhandled path shape key "${shape}"`);
}

function gatherInProcessClaims(root) {
  // Call the real starved gatherer (in-process-claims), not a parallel
  // glob of stuck-in-process-glob — that second path let a flat-only
  // in-process-claims mutant survive while batch_/nested fixtures still
  // appeared via the glob probe (BL-1109 harden).
  const probe = [
    `(binding [*command-line-args* [${JSON.stringify(root)}]]`,
    `  (load-file ${JSON.stringify(CHECK_BB)})`,
    '  (let [f (ns-resolve \'babysitter-check \'in-process-claims)]',
    '    (doseq [c (f {})] (println (pr-str c)))))',
    '',
  ].join('\n');
  const tmp = path.join(os.tmpdir(), `bl1109-gather-${process.pid}-${Date.now()}.bb`);
  fs.writeFileSync(tmp, probe);
  try {
    const result = spawnSync('bb', [tmp], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`bb gather failed:\n${result.stderr}\n${result.stdout}`);
    }
    return (result.stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function ensureState(ctx) {
  if (!ctx.bl1109) ctx.bl1109 = {};
  return ctx.bl1109;
}

function registerSteps(registry) {
  registry.defineScoped(/^a swarm with at least one active ticket and no control pause$/, (ctx) => {
    const st = ensureState(ctx);
    st.activeTicketCount = 2;
    st.paused = false;
    st.anyPaneBusy = false;
  }, FEATURE);

  registry.defineScoped(/^the mailbox state is "(.+)"$/, (ctx, raw) => {
    const key = KNOWN_MAILBOX[raw];
    if (!key) {
      throw new Error(`BL-1109: unrecognized mailbox "${raw}"`);
    }
    const st = ensureState(ctx);
    st.mailboxKey = key;
    if (key === 'live-idle') {
      st.pendingClaims = [];
      st.inProcessClaims = [{ 'age-min': 45, 'owner-busy?': false, 'abandoned?': false }];
    } else {
      st.pendingClaims = [];
      st.inProcessClaims = [];
    }
  }, FEATURE);

  registry.defineScoped(/^every pane is idle$/, (ctx) => {
    ensureState(ctx).anyPaneBusy = false;
  }, FEATURE);

  registry.defineScoped(
    /^babysitterd evaluates the swarm-starved check for two consecutive idle sweeps$/,
    (ctx) => {
      const st = ensureState(ctx);
      const args = {
        'active-ticket-count': st.activeTicketCount,
        'any-pane-busy?': st.anyPaneBusy,
        'paused?': st.paused,
        'prev-streak': 1,
        'pending-claims': st.pendingClaims,
        'in-process-claims': st.inProcessClaims,
      };
      st.starvedPr = bbStarved(args);
    },
    FEATURE
  );

  registry.defineScoped(/^the swarm-starved verdict is "(.+)"$/, (ctx, raw) => {
    const expected = KNOWN_VERDICT[raw];
    if (!expected) throw new Error(`BL-1109: unrecognized verdict "${raw}"`);
    const st = ensureState(ctx);
    const clear = findingNil(st.starvedPr);
    if (expected === 'clear' && !clear) {
      throw new Error(`expected clear (no finding); got: ${st.starvedPr}`);
    }
    if (expected === 'starved' && clear) {
      throw new Error(`expected starved finding; got: ${st.starvedPr}`);
    }
  }, FEATURE);

  registry.defineScoped(/^an in_process handoff whose owning role's pane is idle this sweep$/, (ctx) => {
    const st = ensureState(ctx);
    // CRIT copy invariant: claims present in the gather that produced the
    // finding, but none countable as motion (abandoned) — otherwise check 10
    // clears and there is no CRIT text to assert on.
    st.pendingClaims = [{ 'abandoned?': true, 'age-min': 5 }];
    st.inProcessClaims = [{ 'age-min': 45, 'owner-busy?': false, 'abandoned?': true }];
  }, FEATURE);

  registry.defineScoped(/^the starved finding text is composed for that sweep$/, (ctx) => {
    const st = ensureState(ctx);
    st.starvedPr = bbStarved({
      'active-ticket-count': st.activeTicketCount,
      'any-pane-busy?': false,
      'paused?': false,
      'prev-streak': 1,
      'pending-claims': st.pendingClaims,
      'in-process-claims': st.inProcessClaims,
    });
  }, FEATURE);

  registry.defineScoped(/^the text does not claim zero pending or in-process parcels$/, (ctx) => {
    const st = ensureState(ctx);
    if (findingNil(st.starvedPr)) {
      throw new Error(`expected a starved finding to inspect; got: ${st.starvedPr}`);
    }
    if (/zero pending\/in-process parcels/.test(st.starvedPr)) {
      throw new Error(`CRIT must not claim empty mailbox when claims exist; got: ${st.starvedPr}`);
    }
  }, FEATURE);

  registry.defineScoped(/^an in_process handoff at "(.+)"$/, (ctx, raw) => {
    const shape = KNOWN_PATH_SHAPE[raw];
    if (!shape) throw new Error(`BL-1109: unrecognized path-shape "${raw}"`);
    const st = ensureState(ctx);
    st.root = mkRoot();
    st.handoffPath = placeHandoff(st.root, shape);
  }, FEATURE);

  registry.defineScoped(/^babysitterd gathers in-process claims for the starved check$/, (ctx) => {
    const st = ensureState(ctx);
    st.gathered = gatherInProcessClaims(st.root);
  }, FEATURE);

  registry.defineScoped(/^that handoff is among the claims$/, (ctx) => {
    const st = ensureState(ctx);
    const wantName = path.basename(st.handoffPath);
    const hit = st.gathered.some((line) => line.includes(`:name "${wantName}"`) || line.includes(`:name ${wantName}`));
    if (!hit) {
      throw new Error(
        `expected name ${wantName} in starved in-process-claims; got:\n${st.gathered.join('\n') || '(empty)'}`
      );
    }
    // Gather hardcodes :abandoned? false (starved-only rule); omitting the
    // key is not equivalent for the contract even when nil is live motion.
    const missingAbandoned = st.gathered.filter((line) => !line.includes(':abandoned? false'));
    if (missingAbandoned.length) {
      throw new Error(
        `every starved claim must include :abandoned? false; offending:\n${missingAbandoned.join('\n')}`
      );
    }
  }, FEATURE);
}

module.exports = { registerSteps };
