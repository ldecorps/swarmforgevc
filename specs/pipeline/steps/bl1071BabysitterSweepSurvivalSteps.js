'use strict';

// BL-1071: step handlers for "one failing probe never takes the babysitter's
// whole sweep down with it".
//
// Every scenario runs the REAL sweep (swarmforge/scripts/babysitter_check.sh)
// over a REAL fixture repo, and breaks the named probe the way the live
// incident broke it. That matters more here than usual: the defect under
// review was that the sweep DIED before assemble-findings, and only a live run
// can show that it no longer does. Driving assemble-findings directly would
// assert the pure decision while saying nothing about whether the sweep ever
// reaches it - which is precisely how this went unnoticed for hours.
//
// The fixture itself lives in extension/test/helpers/bl1071SweepFixture.js,
// shared with this ticket's two property files. Its docstrings carry the
// details that go subtly wrong when copied: the symlink FARM (a missing binary
// has to be missing from every PATH entry - a shebang-to-nowhere does not
// work, execvp keeps searching), and the pane-pid that decides whether a
// failing `ps` is visible as a gather failure at all.
//
// The temp-dir allocator is injected because the two contexts need different
// lifecycles: Vitest sweeps per-test through mkTmpDir, and this runner has no
// afterEach, so it sweeps by PREFIX before each scenario instead (BL-971 -
// nothing traps SIGKILL, so a killed run must not leave a tree behind).
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LIVE_ROLE,
  TMUX_TWO_ROLES,
  TMUX_NO_SERVER,
  makeSweepFixture,
  writeStub,
  breakProbes,
  ensureCalls,
  runSweep,
  died,
  reachedFindings,
  reachedRepair,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'test', 'helpers', 'bl1071SweepFixture'));

const FIXTURE_PREFIX = 'bl1071-acc-';

// BL-421: every Examples column value resolves through an explicit lookup, so
// a gherkin-mutator edit into an unrecognised value fails the scenario rather
// than slipping into an else branch.
const KNOWN_PROBES = {
  'the memory reading': ['memory'],
  'the process table': ['ps'],
  'the control-plane observation': ['control-plane'],
  'every one of them at once': ['memory', 'ps', 'control-plane'],
};

const KNOWN_SCRIPTS = { present: true, absent: false };

const KNOWN_RESPONSES = {
  'runs the whole-plane recovery': 'ensure',
  'escalates for a human relaunch': 'escalate',
};

const KNOWN_PER_ROLE = { suppressed: 'suppressed' };

function sweepStale() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

const mkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));

function sweep(ctx, extraEnv = {}) {
  const r = runSweep(ctx.fixture, extraEnv);
  ctx.output = r.output;
  ctx.exitCode = r.exitCode;
  ctx.elapsedMs = r.elapsedMs;
  return r;
}

function registerSteps(registry) {
  const FEATURE = "BL-1071 one failing probe never takes the babysitter's whole sweep down with it";
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── sweep-survives-a-failing-probe-01 ─────────────────────────────────
  define(/^a sweep in which "(.+)" fails$/, (ctx, probeLabel) => {
    const probes = KNOWN_PROBES[probeLabel];
    assert.ok(probes, `unknown probe "${probeLabel}" - known: ${Object.keys(KNOWN_PROBES).join(' | ')}`);
    sweepStale();
    ctx.fixture = breakProbes(makeSweepFixture(mkdir), probes);
  });

  define(/^the babysitter runs its sweep$/, (ctx) => {
    sweep(ctx, ctx.sweepEnv ?? {});
  });

  define(/^the sweep still reaches its findings$/, (ctx) => {
    // The incident's own signature, inverted: babysitterd.log carried ~192
    // stack traces, zero "OK all checks green" and zero REPAIR lines.
    assert.ok(!died(ctx.output), `the sweep died on a probe instead of degrading it:\n${ctx.output}`);
    assert.ok(reachedFindings(ctx.output), `the sweep produced no finding at all:\n${ctx.output}`);

    // The broken probe reported ITSELF rather than being silently absent.
    // The process gather is reportable only when there was a pane to gather
    // for: with tmux absent there are no panes at all, so asserting it there
    // would be asserting against a check that legitimately had nothing to
    // say, not against a silence.
    const reportable = {
      memory: /UNAVAILABLE \[memory\]/,
      ps: ctx.fixture.paneGatherable ? /UNAVAILABLE \[proc-gather-/ : null,
      'control-plane': /UNAVAILABLE \[control-plane\]/,
    };
    for (const probe of ctx.fixture.brokenProbes) {
      const expected = reportable[probe];
      if (!expected) continue;
      assert.match(ctx.output, expected, `the broken "${probe}" probe left no UNAVAILABLE finding:\n${ctx.output}`);
    }
    // And the other half of "degrades its own check and NOTHING ELSE".
    if (!ctx.fixture.brokenProbes.includes('memory')) {
      assert.ok(
        !/UNAVAILABLE \[memory\]/.test(ctx.output),
        `an unrelated probe's failure degraded the memory check too:\n${ctx.output}`
      );
    }
  });

  define(/^a repair that is due is still performed$/, (ctx) => {
    // "Performed" means the sweep reached the repair and acted, not that the
    // repair succeeded - the probe that failed may be the very facility the
    // repair needs. The incident's signature was ZERO repair lines, because
    // the sweep threw before it could reach one.
    assert.ok(
      reachedRepair(ctx.output),
      `the sweep reached its findings but never acted on a due repair:\n${ctx.output}`
    );
  });

  // ── plane-response-matches-what-is-possible-02 ────────────────────────
  define(/^the control plane is missing$/, (ctx) => {
    sweepStale();
    // launchScripts defaults on; the "absent" row rebuilds without them.
    ctx.fixture = breakProbes(makeSweepFixture(mkdir), [], { planeMissing: true });
    ctx.scriptsPresent = true;
  });

  define(/^persisted launch scripts are "(.+)"$/, (ctx, label) => {
    const present = KNOWN_SCRIPTS[label];
    assert.notEqual(present, undefined, `unknown launch-script state "${label}"`);
    if (!present) {
      ctx.fixture = breakProbes(makeSweepFixture(mkdir, { launchScripts: false }), [], { planeMissing: true });
    }
    ctx.scriptsPresent = present;
  });

  define(/^it "(.+)"$/, (ctx, label) => {
    const response = KNOWN_RESPONSES[label];
    assert.ok(response, `unknown response "${label}" - known: ${Object.keys(KNOWN_RESPONSES).join(' | ')}`);
    assert.match(ctx.output, /CRIT \[control-plane\]/, `no control-plane CRIT at all:\n${ctx.output}`);
    if (response === 'ensure') {
      assert.equal(ctx.scriptsPresent, true, 'this row expects launch scripts to be present');
      assert.match(ctx.output, /REPAIR \[repaired\] control-plane/, ctx.output);
      assert.equal(
        ensureCalls(ctx.fixture).length,
        1,
        `expected exactly one ./swarm ensure, got ${ensureCalls(ctx.fixture).length}`
      );
    } else {
      assert.equal(ctx.scriptsPresent, false, 'this row expects launch scripts to be absent');
      assert.match(ctx.output, /relaunch the swarm/, ctx.output);
      assert.deepEqual(ensureCalls(ctx.fixture), [], 'an escalation must start no recovery of its own');
    }
  });

  define(/^per-role session creation is "(.+)"$/, (ctx, label) => {
    assert.equal(KNOWN_PER_ROLE[label], 'suppressed', `unknown per-role state "${label}"`);
    // "Suppressed" means no session was CREATED. single_role_repair_lib's own
    // vocabulary is :ok for a repair that ran and :no-socket /
    // :no-session-name / :no-launch-script for one that refused - and a
    // refusal is not a race, it is the repair declining. Matching every
    // `REPAIR [...] swarmforge-` line would fail on `[no-launch-script]`,
    // which is the launch-scripts-absent row saying exactly what this
    // scenario wants to hear.
    assert.ok(
      !/REPAIR \[ok\] swarmforge-/.test(ctx.output),
      `a per-role session repair raced the whole-plane response:\n${ctx.output}`
    );
    assert.ok(
      !/new-session/.test(ctx.output),
      `a per-role tmux session was created alongside the whole-plane response:\n${ctx.output}`
    );
  });

  // ── recovery-is-bounded-in-time-03 ────────────────────────────────────
  define(/^the whole-plane recovery does not return$/, (ctx) => {
    // Spawns a grandchild too, so this also proves the whole process GROUP is
    // killed rather than only the direct child.
    ctx.fixture = breakProbes(
      makeSweepFixture(mkdir, {
        swarmStub: '#!/usr/bin/env bash\necho 1 >> "$(dirname "$0")/ensure-count"\nsleep 3600 &\nsleep 3600\n',
      }),
      [],
      { planeMissing: true }
    );
    ctx.scriptsPresent = true;
    ctx.sweepEnv = { BABYSITTER_ENSURE_TIMEOUT_MS: '1500' };
  });

  define(/^the sweep ends within its own bound$/, (ctx) => {
    assert.notEqual(ctx.exitCode, null, `the sweep never ended at all (${ctx.elapsedMs}ms)`);
    assert.ok(
      ctx.elapsedMs < 60000,
      `the sweep ran ${ctx.elapsedMs}ms against a 1500ms recovery bound - a hung recovery held it open`
    );
    assert.equal(
      ensureCalls(ctx.fixture).length,
      1,
      'the recovery must actually have been started, or this proves nothing'
    );
  });

  define(/^the recovery is reported as unfinished, not as repaired$/, (ctx) => {
    assert.match(ctx.output, /REPAIR \[unfinished\] control-plane/, ctx.output);
    assert.ok(
      !/REPAIR \[repaired\] control-plane/.test(ctx.output),
      `a recovery that never returned was reported as a repair:\n${ctx.output}`
    );
  });

  // ── recovery-is-bounded-in-attempts-04 ────────────────────────────────
  define(/^a whole-plane recovery ran on the previous sweep$/, (ctx) => {
    sweepStale();
    ctx.fixture = breakProbes(makeSweepFixture(mkdir), [], { planeMissing: true });
    ctx.scriptsPresent = true;
    const first = sweep(ctx);
    assert.equal(ensureCalls(ctx.fixture).length, 1, `the first sweep must have recovered once:\n${first.output}`);
  });

  define(/^the cooldown for that recovery has not elapsed$/, (ctx) => {
    const budget = path.join(ctx.fixture.state, 'babysitterd', 'control-plane-ensure.json');
    assert.ok(fs.existsSync(budget), 'the first sweep persisted no recovery budget, so there is no cooldown to test');
    const state = JSON.parse(fs.readFileSync(budget, 'utf8'));
    assert.ok(
      state['control-plane'] && state['control-plane']['last-ms'],
      `the budget records no attempt time: ${JSON.stringify(state)}`
    );
  });

  define(/^no second recovery is started$/, (ctx) => {
    assert.equal(
      ensureCalls(ctx.fixture).length,
      1,
      `a second recovery ran inside the cooldown (${ensureCalls(ctx.fixture).length} total)`
    );
  });

  define(/^the control plane is still reported as missing$/, (ctx) => {
    assert.match(
      ctx.output,
      /CRIT \[control-plane\]/,
      `the cooldown swallowed the alert as well as the repair:\n${ctx.output}`
    );
  });

  // ── unreadable-is-not-absent-06 ───────────────────────────────────────
  // The sibling of 05 for the one probe 05 does not cover. Scenario 01 already
  // breaks the control-plane observation, but only asserts the SWEEP survives
  // it - a silently dropped observation passes 01 unchanged, which is exactly
  // the state this ticket found and fixed. This gates invariant 3 for it.
  define(/^the control-plane observation throws this sweep$/, (ctx) => {
    sweepStale();
    // Launch scripts PRESENT on purpose. A recovery is withheld below because
    // the plane's state is UNKNOWN, not because there is nothing to recover
    // with - and only a fixture that could have recovered proves that.
    ctx.fixture = breakProbes(makeSweepFixture(mkdir), ['control-plane']);
  });

  define(/^the control-plane check is reported unavailable$/, (ctx) => {
    assert.ok(!died(ctx.output), `the sweep died instead of degrading the probe:\n${ctx.output}`);
    assert.match(
      ctx.output,
      /UNAVAILABLE \[control-plane\]/,
      `a throwing observation left no finding at all - the plane reads healthy by omission:\n${ctx.output}`
    );
    // Never a healthy reading, never an absence: the two other things it
    // could have been reported as.
    assert.ok(
      !/OK all checks green/.test(ctx.output),
      `an unread observation was folded into the all-clear:\n${ctx.output}`
    );
    assert.ok(
      !/CRIT \[control-plane\]/.test(ctx.output),
      `an unreadable observation was reported as the plane being missing:\n${ctx.output}`
    );
  });

  define(/^the reason the observation failed is carried in that finding$/, (ctx) => {
    const line = ctx.output.split('\n').find((l) => /UNAVAILABLE \[control-plane\]/.test(l));
    assert.ok(line, 'no control-plane UNAVAILABLE finding to carry a reason');
    // The fixture breaks the probe by removing tmux from every PATH entry, so
    // the exception the observer threw names it. A finding that said only
    // "unavailable" would leave a human with nowhere to start.
    assert.match(
      line,
      /tmux/,
      `the finding does not carry why the observation failed - the exception was dropped:\n${line}`
    );
  });

  define(/^no control-plane recovery is started$/, (ctx) => {
    assert.deepEqual(
      ensureCalls(ctx.fixture),
      [],
      'a recovery was started off an observation that could not be made - unreadable is not the same as missing'
    );
  });

  // ── unreadable-is-not-absent-05 ───────────────────────────────────────
  define(/^the process table cannot be gathered this sweep$/, (ctx) => {
    sweepStale();
    // The plane is UP with a live pane, so the only thing standing between
    // this sweep and a half-launch alert is the process gather - which is
    // exactly the interaction BL-802 protects and this scenario re-gates.
    ctx.fixture = breakProbes(makeSweepFixture(mkdir, { launchScripts: false }), ['ps']);
    writeStub(ctx.fixture, 'tmux', TMUX_TWO_ROLES);
  });

  define(/^the live-process check is reported unavailable$/, (ctx) => {
    assert.match(
      ctx.output,
      new RegExp(`UNAVAILABLE \\[proc-gather-${LIVE_ROLE}\\]`),
      `a failed process gather was not reported unavailable:\n${ctx.output}`
    );
  });

  define(/^no half-launch alert is raised for any role$/, (ctx) => {
    // BL-802's own contract: a gather that FAILED is not evidence the process
    // is absent. Reading it as absence is a cry-wolf CRIT, and a health signal
    // that cries wolf stops being read.
    //
    // The half-launch alert is the `proc-<role>` CRIT specifically. The
    // vanished role's own `pane-<role>` CRIT is a different finding about a
    // different fact - its session really is gone - and forbidding that would
    // be forbidding the sweep from doing its job.
    assert.ok(
      !/CRIT \[proc-[a-z]+\]/.test(ctx.output),
      `an unreadable process table was read as an absent process:\n${ctx.output}`
    );
    assert.ok(!/half-launch/.test(ctx.output), `a half-launch alert was raised off an unreadable gather:\n${ctx.output}`);
    assert.ok(
      !new RegExp(`CRIT \\[[a-z-]+-${LIVE_ROLE}\\]`).test(ctx.output),
      `the role whose gather failed raised a CRIT off that failure:\n${ctx.output}`
    );
  });
}

module.exports = { registerSteps };
