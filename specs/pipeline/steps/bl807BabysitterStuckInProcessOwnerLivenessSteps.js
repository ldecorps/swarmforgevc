'use strict';

// BL-807: step handlers for "the stuck-in-process check reads owner
// liveness, and can see every mailbox". Drives the REAL babysitter_check.sh
// end to end against disposable fixture roots — a real tmux server whose
// pane text is steered to satisfy classify-pane-busy? (never a hand-rolled
// fake tmux protocol responder), same idiom as
// bl804BabysitterMonoRouterTopologyAwarenessSteps.js. The one exception is
// the "motion signal never disagrees with stuck findings" scenario (03),
// which invokes babysitterd_sweep_lib.bb's own pure check-stuck-in-process
// and check-swarm-starved directly — the cross-check that matters there is
// a same-tick property of the pure decision functions, not something a
// single real sweep's stdout can observe (check-swarm-starved's CRIT is
// gated on a 2-sweep streak, so a first-ever sweep could never produce it
// regardless of whether the fix is correct — asserting on it there would be
// vacuous, never able to fail against a broken implementation).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECK_SH = path.join(SCRIPTS, 'babysitter_check.sh');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');

const FEATURE = 'the stuck-in-process check reads owner liveness, and can see every mailbox';

const MAILBOX_KIND = {
  'role-nested master': 'master',
  'flat worktree': 'flat',
};
const KNOWN_ROLES = new Set(['specifier', 'coordinator', 'coder']);

function knownMailbox(value) {
  if (!Object.prototype.hasOwnProperty.call(MAILBOX_KIND, value)) {
    throw new Error(`BL-807: unrecognized <mailbox> example value "${value}"`);
  }
  return MAILBOX_KIND[value];
}

function knownRole(value) {
  if (!KNOWN_ROLES.has(value)) {
    throw new Error(`BL-807: unrecognized <role> example value "${value}" - not in KNOWN_ROLES`);
  }
  return value;
}

function knownPaneState(value) {
  if (value !== 'busy' && value !== 'idle') {
    throw new Error(`BL-807: unrecognized pane-state "${value}"`);
  }
  return value;
}

function knownOutcome(value) {
  if (value !== 'warned' && value !== 'suppressed') {
    throw new Error(`BL-807: unrecognized <outcome> example value "${value}"`);
  }
  return value;
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function mkFixtureRoot() {
  const root = mkTmp('bl807-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'failed'), { recursive: true });
  // babysitter_check.bb's active-ticket-count glob throws on a missing dir
  // (unlike the try/caught mailbox globs) - keep it empty, but present.
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  return root;
}

function writeMeminfo(root) {
  const p = path.join(root, 'meminfo');
  fs.writeFileSync(p, 'MemAvailable:    8000000 kB\n');
  return p;
}

// Both mailbox shapes BL-807 defect 2 is about (handoff_lib.bb/
// mailbox-base-dir is the production resolver these mirror): worktree roles
// are flat, master-resident roles nest a <role> segment under handoffs/.
function mailboxHandoffsDir(root, role, kind) {
  return kind === 'master'
    ? path.join(root, '.swarmforge', 'handoffs', role)
    : path.join(root, '.worktrees', role, '.swarmforge', 'handoffs');
}

function writeAgedParcel(root, role, kind, ageMinutes, fileName) {
  const dir = path.join(mailboxHandoffsDir(root, role, kind), 'inbox', 'in_process');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, 'id: bl807-fixture\nfrom: x\nto: x\ntype: git_handoff\n');
  const mtime = new Date(Date.now() - ageMinutes * 60 * 1000);
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function sessionFor(role) {
  return `swarmforge-${role}`;
}

function writeRolesTsv(root, role, session, kind) {
  const worktree = kind === 'master' ? root : path.join(root, '.worktrees', role);
  const line = [role, role, worktree, session, role, 'claude', 'task'].join('\t');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${line}\n`);
}

// Starts a REAL tmux server with one pane. The pane's own process is
// renamed (`exec -a "claude --remote-control fake" ...`) so a real
// `ps -eo pid=,ppid=,args=` snapshot finds a live, RC-enabled claude
// process as a CHILD of the pane's shell (has-claude-process? looks for a
// process whose ppid is the pane's own pid — the fork+wait shape is
// required, not incidental: execing the pane's OWN process in place would
// leave no child at all). The busy variant also prints literal text
// classify-pane-busy? matches ("esc to interrupt") before sleeping, so the
// real capture-pane output drives the same busy/idle classification
// production code uses — never a hand-rolled busy flag.
function startTmuxSession(root, session, busy) {
  const sockDir = mkTmp('bl807-sock-');
  const sock = path.join(sockDir, 'bl807.sock');
  const scriptPath = path.join(sockDir, 'pane.sh');
  const innerCmd = busy
    ? 'bash -c \'printf "esc to interrupt\\n"; sleep 999\''
    : 'sleep 999';
  fs.writeFileSync(
    scriptPath,
    ['#!/usr/bin/env bash', `exec -a "claude --remote-control fake" ${innerCmd} &`, 'wait', ''].join('\n')
  );
  fs.chmodSync(scriptPath, 0o755);
  execFileSync('tmux', ['-S', sock, 'new-session', '-d', '-s', session, 'bash', scriptPath]);
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), sock);
  return { sock, sockDir };
}

function cleanup(ctx) {
  const st = ctx.bl807;
  if (!st) return;
  if (st.sock) {
    try {
      execFileSync('tmux', ['-S', st.sock, 'kill-server'], { stdio: 'ignore' });
    } catch {
      /* server already gone - fine */
    }
  }
  if (st.sockDir) fs.rmSync(st.sockDir, { recursive: true, force: true });
  if (st.root) fs.rmSync(st.root, { recursive: true, force: true });
}

function countKeyOccurrences(stdout, key) {
  return stdout.split(`[${key}]`).length - 1;
}

function stuckKeyFor(fileName) {
  // Mirrors check-stuck-in-process's own key derivation exactly
  // (`(subs name 0 (min 40 count))`) - every fixture file name here is well
  // under 40 chars, so this is a plain prefix, never a truncation.
  return `stuck-${fileName.slice(0, 40)}`;
}

// BL-807 scenario 03: check-stuck-in-process (check 5) and check-swarm-
// starved's motion-in-process? (check 10) both consume the SAME claim's
// :owner-busy? boolean. Proving they agree is a same-tick property of the
// pure decision functions, not something one real CLI sweep's stdout can
// observe (see the file header) — so this runs the actual production
// babysitterd_sweep_lib.bb functions directly, on the same synthesized
// claim, and reports both verdicts.
function runMotionConsistencyProbe(ownerBusy) {
  const script = [
    `(load-file "${SWEEP_LIB}")`,
    "(require '[babysitterd-sweep-lib :as sw])",
    `(let [claim {:name "bl807-motion-check.handoff" :age-min 45 :owner-busy? ${ownerBusy ? 'true' : 'false'}}`,
    '      stuck-findings (sw/check-stuck-in-process [claim])',
    '      {starved-finding :finding} (sw/check-swarm-starved',
    '                                   {:active-ticket-count 1',
    '                                    :any-pane-busy? false',
    '                                    :paused? false',
    '                                    :prev-streak 1',
    '                                    :pending-claims []',
    '                                    :in-process-claims [claim]})]',
    '  (println (str "STUCK_EMPTY=" (empty? stuck-findings)))',
    '  (println (str "STARVED_NIL=" (nil? starved-finding))))',
    '',
  ].join('\n');
  const tmpFile = path.join(os.tmpdir(), `bl807-motion-probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.bb`);
  fs.writeFileSync(tmpFile, script);
  try {
    const result = spawnSync('bb', [tmpFile], { encoding: 'utf8' });
    return `${result.stdout || ''}${result.stderr || ''}`;
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

function ensureState(ctx) {
  if (!ctx.bl807) {
    ctx.bl807 = {
      root: mkFixtureRoot(),
      sock: null,
      sockDir: null,
      role: null,
      kind: null,
      paneState: null,
      fileName: null,
      cliStdout: '',
      probeStdout: '',
    };
  }
  return ctx.bl807;
}

function runSweep(ctx) {
  const st = ensureState(ctx);
  const meminfoPath = writeMeminfo(st.root);
  const result = spawnSync('bash', [CHECK_SH, st.root], {
    encoding: 'utf8',
    env: { ...process.env, BABYSITTER_MEMINFO_PATH: meminfoPath },
  });
  st.cliStdout = `${result.stdout || ''}${result.stderr || ''}`;
  st.probeStdout = runMotionConsistencyProbe(st.paneState === 'busy');
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(/^a babysitter sweep that classifies each role's pane as busy or idle$/, (ctx) => {
    ensureState(ctx);
  }, FEATURE);

  // ── Given: the parcel ────────────────────────────────────────────────
  registry.defineScoped(/^an in_process parcel older than the stuck threshold$/, (ctx) => {
    const st = ensureState(ctx);
    st.role = 'coder';
    st.kind = 'flat';
    st.fileName = 'bl807-default.handoff';
    writeAgedParcel(st.root, st.role, st.kind, 90, st.fileName);
  }, FEATURE);

  registry.defineScoped(/^an in_process parcel younger than the stuck threshold$/, (ctx) => {
    const st = ensureState(ctx);
    st.role = 'coder';
    st.kind = 'flat';
    st.fileName = 'bl807-young.handoff';
    writeAgedParcel(st.root, st.role, st.kind, 5, st.fileName);
  }, FEATURE);

  registry.defineScoped(
    /^an in_process parcel older than the stuck threshold in the (role-nested master|flat worktree) mailbox of role (\S+)$/,
    (ctx, rawMailbox, rawRole) => {
      const st = ensureState(ctx);
      st.kind = knownMailbox(rawMailbox);
      st.role = knownRole(rawRole);
      st.fileName = `bl807-${st.kind}-${st.role}.handoff`;
      writeAgedParcel(st.root, st.role, st.kind, 90, st.fileName);
    },
    FEATURE
  );

  // ── Given/And: the owning role's pane state (both scenario wordings) ───
  registry.defineScoped(/^(?:its owning role's|that role's) pane is classified (busy|idle)$/, (ctx, rawState) => {
    const st = ensureState(ctx);
    st.paneState = knownPaneState(rawState);
    const session = sessionFor(st.role);
    writeRolesTsv(st.root, st.role, session, st.kind);
    const { sock, sockDir } = startTmuxSession(st.root, session, st.paneState === 'busy');
    st.sock = sock;
    st.sockDir = sockDir;
  }, FEATURE);

  // ── When ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^the sweep runs$/, (ctx) => {
    runSweep(ctx);
  }, FEATURE);

  // ── Then ─────────────────────────────────────────────────────────────
  registry.defineScoped(/^no stuck-in-process warning is raised for that parcel$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const key = stuckKeyFor(st.fileName);
      if (countKeyOccurrences(st.cliStdout, key) !== 0) {
        throw new Error(`expected no [${key}] finding; got:\n${st.cliStdout}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^a stuck-in-process warning is raised for that parcel$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const key = stuckKeyFor(st.fileName);
      if (!st.cliStdout.includes(`WARN [${key}]`)) {
        throw new Error(`expected a WARN [${key}] finding; got:\n${st.cliStdout}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^no nudge is sent to that role$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const key = stuckKeyFor(st.fileName);
      // nudge-eligible? (babysitterd_sweep_lib.bb, unchanged by this
      // ticket) is exactly: CRIT, or a WARN whose key starts with "stuck-".
      // A fully suppressed check-5 result never enters `findings` at all,
      // so it can never reach decide-nudges - re-derived directly from the
      // sweep's own printed output: no [stuck-...] finding for this parcel
      // exists to nudge on.
      if (countKeyOccurrences(st.cliStdout, key) !== 0) {
        throw new Error(`expected no nudge-eligible [${key}] finding; got:\n${st.cliStdout}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^that warning is eligible to nudge, as it is today$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const key = stuckKeyFor(st.fileName);
      // Re-derive nudge-eligible?'s own predicate (unchanged, out of scope
      // here) directly from the printed finding: severity WARN and a key
      // that starts with "stuck-".
      if (!st.cliStdout.includes(`WARN [${key}]`)) {
        throw new Error(`expected a WARN [${key}] finding (the nudge-eligible shape); got:\n${st.cliStdout}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(
    /^the sweep's in-process motion signal and its stuck findings do not disagree about that parcel$/,
    (ctx) => {
      const st = ensureState(ctx);
      try {
        if (!/STUCK_EMPTY=true/.test(st.probeStdout) || !/STARVED_NIL=true/.test(st.probeStdout)) {
          throw new Error(
            `expected the busy-owner claim to read as both not-stuck (check 5) and not-starved (check 10's ` +
              `motion signal) - probe output:\n${st.probeStdout}`
          );
        }
      } finally {
        cleanup(ctx);
      }
    },
    FEATURE
  );

  registry.defineScoped(/^the stuck-in-process outcome for that parcel is (warned|suppressed)$/, (ctx, rawOutcome) => {
    const st = ensureState(ctx);
    try {
      const outcome = knownOutcome(rawOutcome);
      const key = stuckKeyFor(st.fileName);
      const present = st.cliStdout.includes(`WARN [${key}]`);
      if (outcome === 'warned' && !present) {
        throw new Error(`expected [${key}] to be warned; got:\n${st.cliStdout}`);
      }
      if (outcome === 'suppressed' && present) {
        throw new Error(`expected [${key}] to be suppressed (no WARN); got:\n${st.cliStdout}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);

  registry.defineScoped(/^exactly one stuck-in-process warning names that parcel$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const key = stuckKeyFor(st.fileName);
      const count = countKeyOccurrences(st.cliStdout, key);
      if (count !== 1) {
        throw new Error(`expected exactly one [${key}] finding, got ${count}; output:\n${st.cliStdout}`);
      }
    } finally {
      cleanup(ctx);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
