'use strict';

// BL-998: step handlers for "a shell test never dispatches into the real
// repo". Drives the REAL receive/completion helpers and the REAL guard
// script - no reimplementation of either.
//
// The "real repo" in these scenarios is a SECOND FIXTURE that plays the part,
// never this checkout. The defect under test is precisely that a run can
// claim a live parcel out of a real mailbox, so an acceptance run that used
// the actual repo to prove it would be committing the fault it is asserting
// against. Every path below is under a temp dir.
//
// Invariant 1 (BL-968) applies here: module load is requires and pure
// constants only - everything environmental binds at step-execution time.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GUARD = path.join(REAL_SCRIPTS_DIR, 'test', 'test_shell_fixture_dispatch_isolation.sh');

const FEATURE = 'A shell test never dispatches into the real repo';

// Scenario Outline values are validated against an explicit KNOWN_VALUES
// table and throw on anything else - never a passthrough.
const SAFE_SHAPES = {
  'installs the scripts tree into its fixture': 'installs',
  'calls a leaf helper directly with an explicit root': 'leaf',
};

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

function mkRepo(prefix, role) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const commit = execFileSync('git', ['-C', root, 'rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8' }).trim();
  const wt = path.join(root, '.worktrees', role);
  git(root, ['worktree', 'add', '-q', '-b', role, wt]);
  const roles = `${role}\t${role}\t${wt}\tswarmforge-${role}\t${role}\tclaude\ttask\n`;
  for (const dir of [root, wt]) {
    fs.mkdirSync(path.join(dir, '.swarmforge'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.swarmforge', 'roles.tsv'), roles);
  }
  return { root, wt, commit };
}

function inboxNew(wt) {
  return path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'new');
}

function queueParcel(wt, name, recipient, commit) {
  const dir = inboxNew(wt);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `50_${name}.handoff`);
  fs.writeFileSync(
    file,
    `id: ${name}\nfrom: specifier\nto: ${recipient}\nrecipient: ${recipient}\npriority: 50\ntype: git_handoff\ntask: BL-998-fixture\ncommit: ${commit}\n\npayload ${name}\n`
  );
  return file;
}

// The fix under test: give the fixture its own scripts copy so the helper's
// own `cd "$(dirname "$0")"` stays inside it.
function installScripts(wt) {
  const dest = path.join(wt, 'swarmforge', 'scripts');
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(REAL_SCRIPTS_DIR)) {
    if (entry.endsWith('.bb') || entry.endsWith('.sh')) {
      fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, entry), path.join(dest, entry));
    }
  }
  return dest;
}

// A whole-tree fingerprint of a mailbox: names AND bytes, so a claim (a
// file moving new/ -> in_process/) and an in-place edit both show up.
function mailboxFingerprint(wt) {
  const base = path.join(wt, '.swarmforge', 'handoffs');
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else {
        out.push(`${path.relative(base, full)}:${fs.readFileSync(full, 'utf8')}`);
      }
    }
  };
  walk(base);
  return out.join('\n');
}

function runGuardOver(testDirScriptsRoot) {
  // The guard resolves its own scripts dir from $0, so running the copy
  // inside a synthetic tree scopes it to that tree's tests.
  return spawnSync('bash', [path.join(testDirScriptsRoot, 'test', path.basename(GUARD))], {
    encoding: 'utf8',
  });
}

// Builds a synthetic scripts tree: the real scripts (so the guard's
// self-rooting derivation has something real to derive from), plus a test/
// dir holding only the one generated test this scenario is about.
function synthTreeWith(testSource, testName) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl998-guard-'));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(path.join(scripts, 'test'), { recursive: true });
  for (const entry of fs.readdirSync(REAL_SCRIPTS_DIR)) {
    if (entry.endsWith('.bb') || entry.endsWith('.sh')) {
      fs.copyFileSync(path.join(REAL_SCRIPTS_DIR, entry), path.join(scripts, entry));
    }
  }
  fs.copyFileSync(GUARD, path.join(scripts, 'test', path.basename(GUARD)));
  fs.writeFileSync(path.join(scripts, 'test', testName), testSource);
  return { root, scripts, testName };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a fixture worktree and a real repo whose mailbox holds a parcel$/, (ctx) => {
    ctx.fixture = mkRepo('bl998-fixture-', 'coder');
    // Stands in for the real repo. Never this checkout - see the header.
    ctx.live = mkRepo('bl998-live-', 'coder');
    ctx.liveParcel = queueParcel(ctx.live.wt, 'live-parcel', 'coder', ctx.live.commit);
    ctx.fixtureParcel = queueParcel(ctx.fixture.wt, 'fixture-parcel', 'coder', ctx.fixture.commit);
    ctx.liveBefore = mailboxFingerprint(ctx.live.wt);
    ctx.cleanup = () => {
      for (const r of [ctx.fixture, ctx.live]) {
        fs.rmSync(r.root, { recursive: true, force: true });
      }
    };
  });

  // ── Scenarios 01 / 02 ─────────────────────────────────────────────────
  const dispatchFromFixture = (ctx, script) => {
    const scripts = installScripts(ctx.fixture.wt);
    ctx.result = spawnSync('bb', [path.join(scripts, script)], {
      cwd: ctx.fixture.wt,
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_ROLE: 'coder' },
    });
  };

  scoped(/^the test dispatches the receive helper from its fixture$/, (ctx) => {
    dispatchFromFixture(ctx, 'ready_for_next.bb');
  });

  scoped(/^the test dispatches the completion helper from its fixture$/, (ctx) => {
    // Claim first, so the completion helper has something of its OWN to
    // complete - otherwise "unchanged" would hold for the trivial reason
    // that the helper refused.
    dispatchFromFixture(ctx, 'ready_for_next.bb');
    assert.match(ctx.result.stdout, /^TASK:/m, `precondition: the fixture claim failed:\n${ctx.result.stdout}${ctx.result.stderr}`);
    dispatchFromFixture(ctx, 'done_with_current.bb');
  });

  scoped(/^the parcel claimed is the fixture's own$/, (ctx) => {
    assert.match(
      ctx.result.stdout,
      /^TASK: .*fixture-parcel/m,
      `expected the FIXTURE's parcel to be claimed, got:\n${ctx.result.stdout}${ctx.result.stderr}`
    );
    assert.ok(
      !ctx.result.stdout.includes(ctx.live.root),
      `the run reached the stand-in real repo:\n${ctx.result.stdout}`
    );
  });

  scoped(/^the real repo's mailbox is unchanged$/, (ctx) => {
    assert.equal(
      mailboxFingerprint(ctx.live.wt),
      ctx.liveBefore,
      "the run altered the stand-in real repo's mailbox - names and bytes must be identical"
    );
    assert.ok(fs.existsSync(ctx.liveParcel), 'the live parcel must still be queued, not claimed');
    ctx.cleanup();
  });

  // ── Scenario 03: the guard names a new offender ───────────────────────
  scoped(/^a shell test that executes a receive dispatcher without installing scripts into its fixture$/, (ctx) => {
    ctx.offenderName = 'test_bl998_generated_offender.sh';
    ctx.synth = synthTreeWith(
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
        'READY="$SCRIPT_DIR/../ready_for_next.bb"',
        'WT="$(mktemp -d)"',
        '(cd "$WT" && SWARMFORGE_ROLE=coder bb "$READY")',
        '',
      ].join('\n'),
      ctx.offenderName
    );
  });

  scoped(/^the isolation guard runs$/, (ctx) => {
    ctx.guard = runGuardOver(ctx.synth.scripts);
  });

  scoped(/^the guard fails$/, (ctx) => {
    assert.notEqual(ctx.guard.status, 0, `expected the guard to fail, got:\n${ctx.guard.stdout}${ctx.guard.stderr}`);
  });

  scoped(/^the failure names that test$/, (ctx) => {
    const out = `${ctx.guard.stdout}${ctx.guard.stderr}`;
    assert.ok(out.includes(ctx.offenderName), `the failure must NAME the offender, got:\n${out}`);
    fs.rmSync(ctx.synth.root, { recursive: true, force: true });
  });

  // ── Scenario 04 (Outline): the two safe shapes ────────────────────────
  scoped(/^a shell test that (.+)$/, (ctx, token) => {
    if (!(token in SAFE_SHAPES)) {
      throw new Error(`unknown <shape> token: "${token}" - known: ${Object.keys(SAFE_SHAPES).join(' | ')}`);
    }
    const shape = SAFE_SHAPES[token];
    const source =
      shape === 'installs'
        ? [
            '#!/usr/bin/env bash',
            'set -euo pipefail',
            'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
            'REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"',
            'WT="$(mktemp -d)"',
            'mkdir -p "$WT/swarmforge/scripts"',
            'cp "$REAL_SCRIPTS_DIR"/*.bb "$REAL_SCRIPTS_DIR"/*.sh "$WT/swarmforge/scripts/"',
            'READY="$WT/swarmforge/scripts/ready_for_next.bb"',
            '(cd "$WT" && SWARMFORGE_ROLE=coder bb "$READY")',
            '',
          ].join('\n')
        : [
            '#!/usr/bin/env bash',
            'set -euo pipefail',
            'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
            'READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"',
            'WT="$(mktemp -d)"',
            '(cd "$WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")',
            '',
          ].join('\n');
    ctx.synth = synthTreeWith(source, `test_bl998_generated_${shape}.sh`);
  });

  scoped(/^the guard passes$/, (ctx) => {
    assert.equal(
      ctx.guard.status,
      0,
      `expected the guard to pass for a correctly isolated test, got:\n${ctx.guard.stdout}${ctx.guard.stderr}`
    );
    fs.rmSync(ctx.synth.root, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
