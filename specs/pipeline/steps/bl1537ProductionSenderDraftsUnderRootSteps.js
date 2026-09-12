'use strict';

// BL-1537: step handlers for "every production sender of the handoff CLI
// builds its draft under the project root it sends from". Scenario 01's
// four shell rows delegate to the REAL shell test
// swarmforge/scripts/test/test_production_sender_drafts_under_root.sh (same
// real-CLI-real-fixture discipline as bl1530ShellTestsSpeakTheAuditSteps.js);
// its three TypeScript rows drive the compiled extension/out/tools/ entries
// directly against an in-process fixture. Scenario 02 replaces the handoff
// CLI with a recorder to see the chosen draft path while it still exists.
// Scenario 03 is a static census over the seven files' source.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'every production sender of the handoff CLI builds its draft under the project root it sends from';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SHELL_TEST = path.join(SCRIPTS_DIR, 'test', 'test_production_sender_drafts_under_root.sh');

const SHELL_ROW = {
  'swarmforge/scripts/promote_and_route_next.sh': '01',
  'swarmforge/scripts/route_backlog_to_coder.sh': '02',
  'swarmforge/scripts/mailbox_note_to_role.sh': '03',
  'swarmforge/scripts/inject_note_to_role.sh': '04',
};

// recipient the real production code addresses today (buildSeedDraft sends
// `to: coordinator` - tracer-bullet-launcher.ts's own header describes the
// pipeline it walks as starting at the coordinator).
const TS_SENDER_RECIPIENT = {
  'extension/src/tools/closing-ceremony-run.ts': 'specifier',
  'extension/src/tools/night-closing-ceremony-run.ts': 'specifier',
  'extension/src/tools/tracer-bullet-launcher.ts': 'coordinator',
};

const SEVEN_SENDERS = [...Object.keys(SHELL_ROW), ...Object.keys(TS_SENDER_RECIPIENT)];

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// ── fixture shared by the three TS-sender rows and scenario 02 ─────────────

function buildFixture(prefix) {
  const root = mkSocketFixtureRoot(prefix);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], {
    cwd: root,
  });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const roles = [
    ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ['specifier', 'master', root, 'swarmforge-specifier', 'Specifier', 'claude', 'task'],
    ['coder', 'coder', root, 'swarmforge-coder', 'Coder', 'claude', 'task'],
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${roles.map((r) => r.join('\t')).join('\n')}\n`);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-9538-fixture-ticket.yaml'),
    'id: BL-9538\ntitle: "fixture ticket already active"\nstatus: todo\nassigned_to: coder\n'
  );
  // The three TS senders join `<target>/swarmforge/scripts/swarm_handoff.sh`
  // literally, unlike the shell senders (invoked at their OWN real path, so
  // their SCRIPT_DIR already resolves there) - a symlink gives the fixture a
  // fully working swarmforge/scripts/ tree without copying its bb closure.
  fs.symlinkSync(SCRIPTS_DIR.replace(/\/scripts$/, ''), path.join(root, 'swarmforge'), 'dir');
  return root;
}

function cleanupFixture(ctx) {
  for (const key of ['root', 'outside']) {
    if (ctx[key]) {
      releaseSocketFixtureRoot(ctx[key]);
      fs.rmSync(ctx[key], { recursive: true, force: true });
      ctx[key] = undefined;
    }
  }
  if ('savedTmpdir' in ctx) {
    if (ctx.savedTmpdir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = ctx.savedTmpdir;
    }
    delete ctx.savedTmpdir;
  }
}

function runTsSender(sender, root) {
  let thrown = null;
  const savedRole = process.env.SWARMFORGE_ROLE;
  try {
    if (sender.endsWith('closing-ceremony-run.ts')) {
      const { sendNoteViaHandoff } = require(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'closing-ceremony-run'));
      const { buildClosingCeremonyNoteDraft } = require(path.join(
        REPO_ROOT,
        'extension',
        'out',
        'quality',
        'closingCeremony'
      ));
      sendNoteViaHandoff(root, buildClosingCeremonyNoteDraft('specifier', 'evidence/bl1537-probe.md'));
    } else if (sender.endsWith('night-closing-ceremony-run.ts')) {
      const { sendHandoffNote } = require(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'night-closing-ceremony-run'));
      sendHandoffNote(root, 'specifier', 'BL-1537 lean-packet probe');
    } else if (sender.endsWith('tracer-bullet-launcher.ts')) {
      delete process.env.SWARMFORGE_ROLE;
      const { sendSeedNote } = require(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'tracer-bullet-launcher'));
      sendSeedNote('bl1537-probe', root);
    } else {
      throw new Error(`unknown TS sender: ${sender}`);
    }
  } catch (e) {
    thrown = e;
  } finally {
    if (savedRole === undefined) {
      delete process.env.SWARMFORGE_ROLE;
    } else {
      process.env.SWARMFORGE_ROLE = savedRole;
    }
  }
  return thrown;
}

function mailboxDir(root, role, state) {
  const res = spawnSync('bb', [path.join(SCRIPTS_DIR, 'mailbox_dir.bb'), root, role, state], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

function inboxFileCount(root, role) {
  const dir = mailboxDir(root, role, 'new');
  if (!dir) {
    return 0;
  }
  return walkFiles(dir).length;
}

function tmpFileCount(root) {
  return walkFiles(path.join(root, 'tmp')).length;
}

// ── the delegated shell test, run once and memoized on `ctx` per scenario ──

function runShellTest(ctx) {
  if (!ctx.shellResult) {
    ctx.shellResult = spawnSync('bash', [SHELL_TEST], { encoding: 'utf8', timeout: 120000 });
  }
  return ctx.shellResult;
}

function shellOutput(res) {
  return `${res.stdout || ''}${res.stderr || ''}`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ─────────────────────────────────────────────────────────

  scoped(/^a fixture project root under mkdtemp with a valid roles\.tsv naming coordinator, specifier and coder$/, (ctx) => {
    ctx.root = buildFixture('bl1537-fixture-');
  });

  scoped(/^TMPDIR points at a directory outside that fixture root$/, (ctx) => {
    ctx.outside = mkSocketFixtureRoot('bl1537-outside-');
    ctx.savedTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = ctx.outside;
  });

  scoped(/^the handoff transport runs mailbox-only with no tmux and no daemon$/, () => {
    // Documents the shell senders' env (SWARMFORGE_MAILBOX_ONLY=1, no live
    // tmux session) - applied per-sender inside test_production_sender_drafts_under_root.sh.
    // The three TS senders keep their own real production env instead (one
    // of them, night-closing-ceremony-run.ts, hardcodes sync/SKIP_DAEMON
    // internally): this step is a no-op for them and the "it sends" step's
    // own tolerance for a sync-tmux-inject failure below is why.
  });

  // ── Scenario 01 (Outline) ────────────────────────────────────────────────

  scoped(/^the sender (\S+) is run against the fixture root$/, (ctx, sender) => {
    ctx.sender = sender;
    if (!SHELL_ROW[sender] && !TS_SENDER_RECIPIENT[sender]) {
      throw new Error(`unrecognized sender in scenario 01: ${sender}`);
    }
    if (TS_SENDER_RECIPIENT[sender]) {
      ctx.recipient = TS_SENDER_RECIPIENT[sender];
      ctx.inboxBefore = inboxFileCount(ctx.root, ctx.recipient);
      ctx.tmpBefore = tmpFileCount(ctx.root);
    }
  });

  scoped(/^it sends (.+)$/, (ctx) => {
    if (ctx.usesRecorder) {
      // Scenario 02 reuses this exact step text but performs its own send
      // (via the recorder-substituted CLI) inside its own "Then" step below,
      // where the recorder's log still needs to be read while the answer is
      // fresh - nothing to do here but let that step run next.
      return;
    }
    const sender = ctx.sender;
    if (SHELL_ROW[sender]) {
      runShellTest(ctx);
      return;
    }
    ctx.tsThrown = runTsSender(sender, ctx.root);
  });

  scoped(/^the (\S+) inbox\/new holds that note$/, (ctx, recipient) => {
    const sender = ctx.sender;
    if (SHELL_ROW[sender]) {
      const row = SHELL_ROW[sender];
      const out = shellOutput(runShellTest(ctx));
      assert.match(out, new RegExp(`PASS: ${row}:`), `expected row ${row} (${sender}) to pass:\n${out}`);
      return;
    }
    assert.equal(recipient, ctx.recipient, `fixture mismatch: expected recipient ${ctx.recipient}, step named ${recipient}`);
    const after = inboxFileCount(ctx.root, recipient);
    assert.ok(
      after > ctx.inboxBefore,
      `expected a new file in ${recipient}'s inbox/new for ${sender}; before=${ctx.inboxBefore} after=${after}` +
        (ctx.tsThrown ? `\n(sender threw: ${ctx.tsThrown.message})` : '')
    );
  });

  scoped(/^no HANDOFF_DRAFT_OUTSIDE_ROOT refusal is printed$/, (ctx) => {
    const sender = ctx.sender;
    if (SHELL_ROW[sender]) {
      const out = shellOutput(runShellTest(ctx));
      assert.doesNotMatch(out, /HANDOFF_DRAFT_OUTSIDE_ROOT/, `${sender}: the draft was refused as outside the root`);
      return;
    }
    if (ctx.tsThrown) {
      assert.doesNotMatch(
        String(ctx.tsThrown.message || ctx.tsThrown),
        /HANDOFF_DRAFT_OUTSIDE_ROOT/,
        `${sender}: the draft was refused as outside the root: ${ctx.tsThrown.message}`
      );
    }
  });

  scoped(/^no file was created under TMPDIR$/, (ctx) => {
    const sender = ctx.sender;
    if (SHELL_ROW[sender]) {
      // Asserted inside test_production_sender_drafts_under_root.sh itself
      // (assert_common) for every row - a second, weaker re-check here would
      // only ever restate a PASS/FAIL this scenario already reads above.
      return;
    }
    const outsideFiles = walkFiles(ctx.outside);
    assert.equal(outsideFiles.length, 0, `${sender}: TMPDIR gained file(s): ${outsideFiles.join(', ')}`);
  });

  // Last step reached by every row of scenario 01 - cleans up the
  // Background's fixture in a finally so it runs whether or not this row's
  // own assertion passes (matches bl1518HandoffDraftRootGuardSteps.js's own
  // "clean up on whichever step turns out to be last" discipline).
  scoped(/^the sender's draft file no longer exists once the sender exits$/, (ctx) => {
    try {
      const sender = ctx.sender;
      if (SHELL_ROW[sender]) {
        return; // same as above - covered by the delegated shell test's own PASS row.
      }
      const after = tmpFileCount(ctx.root);
      assert.equal(after, ctx.tmpBefore, `${sender}: left a draft file under the fixture root's tmp/`);
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────

  const SCENARIO_02_SENDER = 'swarmforge/scripts/route_backlog_to_coder.sh';

  scoped(
    /^the sender swarmforge\/scripts\/route_backlog_to_coder\.sh is run against the fixture root with the handoff CLI replaced by a recorder$/,
    (ctx) => {
      ctx.sender = SCENARIO_02_SENDER;
      ctx.usesRecorder = true;
      const shadowDir = path.join(ctx.root, 'shadow-scripts');
      fs.mkdirSync(shadowDir, { recursive: true });
      for (const name of fs.readdirSync(SCRIPTS_DIR)) {
        if (name === 'swarm_handoff.sh') {
          continue;
        }
        fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(shadowDir, name));
      }
      ctx.recorderLog = path.join(ctx.root, 'recorder.log');
      fs.writeFileSync(
        path.join(shadowDir, 'swarm_handoff.sh'),
        `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> ${JSON.stringify(ctx.recorderLog)}\nexit 0\n`
      );
      fs.chmodSync(path.join(shadowDir, 'swarm_handoff.sh'), 0o755);
      ctx.shadowRouteScript = path.join(shadowDir, 'route_backlog_to_coder.sh');
    }
  );

  scoped(/^the draft path the recorder received lies under the fixture root's tmp directory$/, (ctx) => {
    // route_backlog_to_coder.sh's own post-send confirmation check always
    // fails here (the recorder logs argv and exits 0 but never actually
    // queues anything for it to find) - the same race/mismatch scenario 01
    // row 2 tolerates, and irrelevant to what this scenario is proving.
    const res = spawnSync('bash', [ctx.shadowRouteScript, 'BL-9538', ctx.root], { cwd: ctx.root, encoding: 'utf8' });
    ctx.scenario02Output = `${res.stdout || ''}${res.stderr || ''}`;
    const recorded = fs.readFileSync(ctx.recorderLog, 'utf8').trim().split('\n')[0];
    ctx.recordedDraftPath = recorded;
    assert.ok(recorded, `expected the recorder to capture a draft path; run output: ${ctx.scenario02Output}`);
    assert.ok(
      recorded === path.join(ctx.root, 'tmp') || recorded.startsWith(`${path.join(ctx.root, 'tmp')}${path.sep}`),
      `expected the draft path (${recorded}) to lie under ${ctx.root}/tmp/`
    );
  });

  scoped(/^that path is not under TMPDIR$/, (ctx) => {
    try {
      assert.ok(
        !ctx.recordedDraftPath.startsWith(ctx.outside),
        `expected the draft path (${ctx.recordedDraftPath}) not to be under TMPDIR (${ctx.outside})`
      );
    } finally {
      cleanupFixture(ctx);
    }
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────────

  scoped(/^the seven sender files named in scenario 01$/, (ctx) => {
    ctx.sevenFiles = SEVEN_SENDERS;
  });

  scoped(/^each is scanned for a draft directory expression$/, (ctx) => {
    ctx.sources = ctx.sevenFiles.map((rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
  });

  const BAD_DRAFT_DIR = /mktemp\)"$|mktemp "\$\{TMPDIR|os\.tmpdir\(\)/m;

  // Scoped to lines that actually build the HANDOFF draft (every fixed
  // call site names its variable draft/DRAFT/draftPath) rather than the
  // whole file - promote_and_route_next.sh's own SED_TMP="$(mktemp)" a few
  // lines below its freshness-hold note is an unrelated BSD/GNU sed temp
  // file the literal ticket-quoted grep cannot tell apart from a draft.
  function draftBuildingLines(source) {
    return source
      .split('\n')
      .filter((line) => /draft/i.test(line))
      .join('\n');
  }

  scoped(
    /^none of them creates its draft with a bare mktemp, under \$\{TMPDIR:-\/tmp\}, or under os\.tmpdir\(\)$/,
    (ctx) => {
      ctx.sevenFiles.forEach((rel, i) => {
        assert.doesNotMatch(
          draftBuildingLines(ctx.sources[i]),
          BAD_DRAFT_DIR,
          `${rel} still builds its draft under the system temp dir`
        );
      });
    }
  );

  scoped(/^the census of production senders that both invoke the handoff CLI and build their own draft still counts seven$/, (ctx) => {
    try {
      // BL-1445: the mint-time grep widened here to also recognize the NEW
      // idiom (a TS sender calling draftPathUnder(...), whose own "tmp"
      // literal now lives in draftPathUnder.ts rather than the caller) - a
      // matcher blind to that idiom would silently drop the three TS senders
      // from the census the moment they stopped saying os.tmpdir() in their
      // own source, exactly the "goes green on a subset" failure this
      // scenario exists to catch.
      const roots = ['swarmforge/scripts', 'extension/src'];
      const draftIdiom = /mktemp|os\.tmpdir\(\)|fs\/create-temp|fs\/path \((root|project-root|tmp-dir)\) "tmp"|fs\/path "tmp"|draftPathUnder\(/;
      const candidates = [];
      for (const r of roots) {
        for (const f of walkFiles(path.join(REPO_ROOT, r))) {
          const rel = path.relative(REPO_ROOT, f);
          if (rel.includes(`${path.sep}test${path.sep}`)) {
            continue;
          }
          if (!/\.(sh|ts|bb)$/.test(f)) {
            continue;
          }
          const src = fs.readFileSync(f, 'utf8');
          if (/swarm_handoff\.(sh|bb)/.test(src) && draftIdiom.test(src)) {
            candidates.push(rel);
          }
        }
      }
      const stillCounted = SEVEN_SENDERS.filter((rel) => candidates.includes(rel));
      assert.equal(
        stillCounted.length,
        7,
        `expected all seven BL-1537 senders to still be counted as draft-building handoff senders; missing: ${SEVEN_SENDERS.filter(
          (rel) => !candidates.includes(rel)
        ).join(', ')}`
      );
    } finally {
      cleanupFixture(ctx);
    }
  });
}

module.exports = { registerSteps, cleanupFixture };
