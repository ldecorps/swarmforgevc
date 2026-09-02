'use strict';

// BL-1330: BL-848 stamp-off of Cursor hotfix 441fd35112, "Restaff bob BoB
// starting cast: Anthropic seats, coder on qwen3.8-max."
//
// This CONFIRMS OR REFUTES what landed. It reimplements nothing, re-staffs
// nothing, and writes nothing to the ledger.
//
// DUPLICATE LANDING, reported not adjudicated: 441fd35112's diff is
// BYTE-IDENTICAL to db7e3f2bda's (BL-1326's subject), with a different parent
// and neither an ancestor of the other. 441fd35112 is the one reachable from
// main; db7e3f2bda is NOT. Both carry hotfix-ledger rows and both have active
// stamp-off tickets, so the human is currently asked to certify one change
// twice. Asserted below so the finding cannot rot, and raised to the
// specifier by note. This parcel reviews the commit its own ticket names.
//
// Scenario 03 EXECUTES the REAL extra_cli_targets_qwen_cloud via
// lib/bl1330QwenRemapPredicateCli.zsh. That driver was written for BL-1326
// and shared with it; when BL-1326 was RETIRED as a duplicate (ab47a05670)
// the retirement deleted it on main, and this handler is its only remaining
// caller - so BL-1330 owns it now. Left where a retired ticket's cleanup had
// removed it, this scenario would have broken the moment BL-1330 landed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'Swarm stamp-off for the bob pack Anthropic-starting-cast restaff';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HOTFIX = '441fd35112';
const TWIN = 'db7e3f2bda';
const PACK = 'swarmforge/packs/bob-multi-provider-mono-router.conf';
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const PREDICATE_CLI = path.join(__dirname, 'lib', 'bl1330QwenRemapPredicateCli.zsh');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

const KNOWN_ROLES = ['coder', 'specifier', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const KNOWN_MODELS = ['qwen3.8-max', 'claude-sonnet-5'];
const KNOWN_EFFORTS = ['high', 'medium'];

function git(...args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
}

function packText() {
  return git('show', `${HOTFIX}:${PACK}`);
}

function windows(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^window\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) {
      continue;
    }
    const [, role, agent, rest] = m;
    const flagIdx = rest.indexOf('--');
    out.set(role, { role, agent, cli: flagIdx === -1 ? '' : rest.slice(flagIdx).trim() });
  }
  return out;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────

  scoped(/^the landed sources at commit 441fd35112$/, (ctx) => {
    ctx.bl1330 = {};
    assert.equal(git('cat-file', '-t', HOTFIX).trim(), 'commit', `${HOTFIX} must be reachable`);
    assert.match(
      git('log', '-1', '--format=%B', HOTFIX),
      /Hotfix-Certification:\s*pending/,
      `${HOTFIX} is not pending certification - a stamp-off has nothing to review`
    );
    // This commit is the one actually on main. Its byte-identical twin is
    // not - which is the whole of the duplicate-landing finding, asserted
    // here so it fails loudly if either fact ever changes.
    let onMain = true;
    try {
      git('merge-base', '--is-ancestor', HOTFIX, 'main');
    } catch {
      onMain = false;
    }
    assert.equal(onMain, true, `${HOTFIX} must be the landing reachable from main`);
    ctx.bl1330.text = packText();
  });

  // ── Given ───────────────────────────────────────────────────────────────

  scoped(/^the bob-multi-provider-mono-router pack$/, (ctx) => {
    ctx.bl1330.text = packText();
  });

  scoped(/^the bob pack launch scripts generated from the landed conf$/, (ctx) => {
    ctx.bl1330.text = packText();
    ctx.bl1330.windows = windows(ctx.bl1330.text);
    ctx.bl1330.launcher = fs.readFileSync(SWARMFORGE_SH, 'utf8');
  });

  // ── When ────────────────────────────────────────────────────────────────

  scoped(/^the window block is read$/, (ctx) => {
    ctx.bl1330.windows = windows(ctx.bl1330.text);
    assert.ok(ctx.bl1330.windows.size > 0, 'the pack must declare window lines');
  });

  scoped(/^each window's --model value is checked against the remap predicate$/, (ctx) => {
    const wins = windows(ctx.bl1330.text);
    const specs = [...wins.values()].map((w) => `${w.role}|${w.cli}`);
    const out = execFileSync('zsh', [PREDICATE_CLI, SWARMFORGE_SH, ...specs], { encoding: 'utf8' });
    ctx.bl1330.remap = new Map(
      out.trim().split('\n').filter(Boolean).map((l) => {
        const [role, verdict] = l.split(/\s+/);
        return [role, verdict];
      })
    );
  });

  scoped(/^the review inspects the commit's changed paths$/, (ctx) => {
    ctx.bl1330.changed = git('diff', '--name-only', `${HOTFIX}^`, HOTFIX).split('\n').filter(Boolean);
  });

  scoped(/^the review completes with every scenario green$/, (ctx) => {
    ctx.bl1330.reviewGreen = true;
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^the window for role "([^"]+)" names the claude agent$/, (ctx, role) => {
    assert.ok(KNOWN_ROLES.includes(role), `unknown role "${role}"`);
    const w = ctx.bl1330.windows.get(role);
    assert.ok(w, `no window line for role "${role}"`);
    assert.equal(w.agent, 'claude');
  });

  scoped(/^the window for role "([^"]+)" names model "([^"]+)"$/, (ctx, role, model) => {
    assert.ok(KNOWN_ROLES.includes(role), `unknown role "${role}"`);
    assert.ok(KNOWN_MODELS.includes(model), `unknown model "${model}"`);
    assert.match(ctx.bl1330.windows.get(role).cli, new RegExp(`--model\\s+${model.replace('.', '\\.')}(\\s|$)`));
  });

  scoped(/^the window for role "([^"]+)" carries effort "([^"]+)"$/, (ctx, role, effort) => {
    assert.ok(KNOWN_ROLES.includes(role), `unknown role "${role}"`);
    assert.ok(KNOWN_EFFORTS.includes(effort), `unknown effort "${effort}"`);
    assert.match(ctx.bl1330.windows.get(role).cli, new RegExp(`--effort\\s+${effort}(\\s|$)`));
  });

  scoped(/^no window line names role "([^"]+)"$/, (ctx, role) => {
    assert.equal(windows(ctx.bl1330.text).has(role), false, `${role} must not be a window line`);
  });

  // Scenario 02, as AMENDED 2026-09-02 (734f6da6f6) after this parcel
  // reported the original clause unsatisfiable. The old wording asserted over
  // diff TEXT ("touches no coordinator-related line") and would have refused
  // a correct hotfix over comment churn; the amended clause asserts the
  // BEHAVIOUR that actually matters - the coordinator's staffing did not move.
  scoped(/^the coordinator agent, model and effort are unchanged by commit 441fd35112$/, () => {
    const coordConfig = (rev) =>
      git('show', `${rev}:${PACK}`)
        .split('\n')
        .filter((l) => /^config coordinator/.test(l))
        .join('\n');
    const before = coordConfig(`${HOTFIX}^`);
    const after = coordConfig(HOTFIX);
    assert.equal(after, before, "the coordinator's staffing must not move in a restaff of the other seats");
    // Named explicitly, so this cannot pass on two identically-empty reads.
    assert.match(after, /coordinator_agent claude/);
    assert.match(after, /coordinator_model claude-sonnet-5/);
    assert.match(after, /coordinator_effort medium/);
  });

  scoped(/^only the coder window targets the Qwen cloud gateway$/, (ctx) => {
    assert.equal(ctx.bl1330.remap.get('coder'), 'qwen-cloud');
    const matching = [...ctx.bl1330.remap.entries()].filter(([, v]) => v === 'qwen-cloud').map(([r]) => r);
    assert.deepEqual(matching, ['coder'], `exactly one seat may remap, got: ${matching.join(', ')}`);
  });

  scoped(/^every other window carries no Token Plan remap$/, (ctx) => {
    for (const [role, verdict] of ctx.bl1330.remap) {
      if (role !== 'coder') {
        assert.equal(verdict, 'none', `${role} unexpectedly targets the Qwen cloud gateway`);
      }
    }
  });

  // Scenario 04. NO LAUNCHER IS RUN: generating real launch scripts means
  // executing swarmforge.sh, which spawns tmux sessions and agents. What
  // DETERMINES the answer is executed instead - the same per-seat predicate,
  // run for real - and the two gates are shown to key off it. The evidence
  // file states this limit rather than implying scripts were generated.
  scoped(/^only the coder seat's launch script declares CLAUDE_CODE_MAX_CONTEXT_TOKENS$/, (ctx) => {
    const specs = [...ctx.bl1330.windows.values()].map((w) => `${w.role}|${w.cli}`);
    const out = execFileSync('zsh', [PREDICATE_CLI, SWARMFORGE_SH, ...specs], { encoding: 'utf8' });
    const remap = out.trim().split('\n').filter(Boolean).map((l) => l.split(/\s+/));
    const matching = remap.filter(([, v]) => v === 'qwen-cloud').map(([r]) => r);
    assert.deepEqual(matching, ['coder']);
    // The launch-script guard that writes the 1M export is gated on that
    // same predicate, for a claude seat.
    assert.match(
      ctx.bl1330.launcher,
      /extra_cli_targets_qwen_cloud "\$extra_cli"; then[\s\S]{0,900}?CLAUDE_CODE_MAX_CONTEXT_TOKENS/,
      'the 1M declaration must be gated on the per-seat qwen predicate'
    );
    ctx.bl1330.remapMatching = matching;
  });

  scoped(/^only the coder seat's pane env carries QWEN_API_KEY$/, (ctx) => {
    assert.deepEqual(ctx.bl1330.remapMatching, ['coder']);
    // The pane-env branch is gated on the SAME predicate, per seat index.
    assert.match(
      ctx.bl1330.launcher,
      /elif \[\[ "\$agent" == "claude" \]\] && extra_cli_targets_qwen_cloud "\$\{EXTRA_CLI_ARGS\[\$index\]:-\}"; then[\s\S]{0,700}?QWEN_API_KEY=/,
      'the QWEN_API_KEY pane env must be gated on the per-seat qwen predicate'
    );
  });

  scoped(/^no other seat's launch script or pane env carries either$/, (ctx) => {
    // Follows from the two gates above plus the executed predicate: no
    // non-coder window matches, so neither branch is reached for them.
    for (const [role, verdict] of ctx.bl1330.remap ?? []) {
      if (role !== 'coder') {
        assert.equal(verdict, 'none');
      }
    }
    assert.deepEqual(ctx.bl1330.remapMatching, ['coder']);
  });

  scoped(/^the only changed file under swarmforge\/ is the bob pack conf$/, (ctx) => {
    const underSwarmforge = ctx.bl1330.changed.filter((p) => p.startsWith('swarmforge/'));
    assert.deepEqual(underSwarmforge, [PACK]);
  });

  scoped(/^no file under swarmforge\/scripts\/ or extension\/ appears in the diff$/, (ctx) => {
    const code = ctx.bl1330.changed.filter((p) => p.startsWith('swarmforge/scripts/') || p.startsWith('extension/'));
    assert.deepEqual(code, [], `no launcher or extension code may change: ${code.join(', ')}`);
  });

  scoped(/^the hotfix ledger entry for commit 441fd35112 is still awaiting a human decision$/, (ctx) => {
    assert.equal(ctx.bl1330.reviewGreen, true);
    const ledger = fs.readFileSync(LEDGER, 'utf8');
    const entry = ledger.split(/\n(?=\s*-\s)/).find((block) => block.includes(HOTFIX));
    assert.ok(entry, `no hotfix-ledger entry for ${HOTFIX}`);
    assert.match(entry, /state:\s*(pending|awaiting-human|stamp-open)/, `ledger row is no longer awaiting a human: ${entry}`);
    assert.doesNotMatch(entry, /state:\s*(certified|waived)/);
    assert.equal(
      git('status', '--porcelain', '--', 'backlog/hotfix-ledger.yaml').trim(),
      '',
      'a stamp-off must never modify the hotfix ledger'
    );
    // The duplicate-landing finding, asserted so it cannot rot: the twin
    // still has its own ledger row, and is still not on main.
    assert.ok(ledger.includes(TWIN), `${TWIN}'s row is expected to still exist - the finding depends on it`);
    let twinOnMain = true;
    try {
      git('merge-base', '--is-ancestor', TWIN, 'main');
    } catch {
      twinOnMain = false;
    }
    assert.equal(twinOnMain, false, `${TWIN} is now on main - the duplicate-landing finding must be revised`);
  });
}

module.exports = { registerSteps };
