'use strict';

// BL-1328: step handlers for the qwen-cloud --model token forms and the
// documented OpenRouter/qwen precedence asymmetry.
//
// Scenario 01 EXECUTES the REAL extra_cli_targets_qwen_cloud, extracted from
// the shipped swarmforge/scripts/swarmforge.sh and eval'd under zsh - the
// same driver posture BL-1330's own steps use, for the same two reasons: a
// copy of the predicate would drift from the shipped one silently, and
// sourcing swarmforge.sh outright would run the swarm launcher.
//
// Scenario 02 is a source check, because what it asserts IS a property of the
// source: two call sites whose precedence disagrees, each carrying a comment
// naming the other. There is no behaviour to execute - no live pack combines
// OpenRouter routing with a qwen* --model, and this ticket deliberately does
// not make one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const PREDICATE_CLI = path.join(__dirname, 'lib', 'bl1330QwenRemapPredicateCli.zsh');

const FEATURE =
  'BL-1328 Qwen-cloud --model detection covers the equals-sign form; OpenRouter/qwen precedence documented';

// Scenario Outline cells, validated against explicit known values rather than
// passed through (engineering.prompt, Acceptance Pipeline).
const KNOWN_CLI_ARGS = new Set(['--model=qwen3.8-max', '--model qwen3.8-max', '--model=claude-sonnet-5']);
const KNOWN_OUTCOMES = new Set(['reports', 'does not report']);

function state(ctx) {
  if (!ctx.bl1328) ctx.bl1328 = {};
  return ctx.bl1328;
}

// Runs the SHIPPED predicate against one CLI string and returns its verdict.
function predicateVerdict(cliArgs) {
  const r = spawnSync('zsh', [PREDICATE_CLI, SWARMFORGE_SH, `seat|${cliArgs}`], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(`the predicate driver failed: ${r.stdout}${r.stderr}`);
  const line = `${r.stdout}`.trim().split('\n').pop();
  assert.match(line, /^seat (qwen-cloud|none)$/, `unexpected driver output: ${line}`);
  return line.endsWith('qwen-cloud') ? 'reports' : 'does not report';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^the swarmforge\.sh launch pipeline's qwen-cloud detection helper$/, (ctx) => {
    const source = fs.readFileSync(SWARMFORGE_SH, 'utf8');
    assert.match(source, /^extra_cli_targets_qwen_cloud\(\) \{$/m, 'the detection helper is gone from swarmforge.sh');
    state(ctx).source = source;
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^a role's extra CLI args contain "(.+)"$/, (ctx, cliArgs) => {
    assert.ok(KNOWN_CLI_ARGS.has(cliArgs), `unknown cli_args cell: ${cliArgs}`);
    state(ctx).cliArgs = cliArgs;
  });

  scoped(/^extra_cli_targets_qwen_cloud evaluates those args$/, (ctx) => {
    const st = state(ctx);
    st.verdict = predicateVerdict(st.cliArgs);
  });

  scoped(/^it (reports|does not report) a qwen-cloud target$/, (ctx, outcome) => {
    const st = state(ctx);
    assert.ok(KNOWN_OUTCOMES.has(outcome), `unknown outcome cell: ${outcome}`);
    assert.equal(st.verdict, outcome, `the shipped predicate answered "${st.verdict}" for [${st.cliArgs}]`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the billing_guard construction site prefers qwen-cloud over OpenRouter$/, (ctx) => {
    const source = state(ctx).source ?? fs.readFileSync(SWARMFORGE_SH, 'utf8');
    const site = source.slice(source.indexOf('if [[ "${SWARMFORGE_USE_QWEN:-}" == "1" ]] || extra_cli_targets_qwen_cloud'));
    const guardBlock = site.slice(0, site.indexOf('\n  fi'));
    assert.ok(
      guardBlock.indexOf('extra_cli_targets_qwen_cloud') < guardBlock.indexOf('role_uses_openrouter'),
      'the billing_guard site no longer prefers qwen-cloud - the documented asymmetry has changed',
    );
    state(ctx).source = source;
  });

  scoped(/^the launch_role pane-env construction site prefers OpenRouter over qwen-cloud$/, (ctx) => {
    const source = state(ctx).source ?? fs.readFileSync(SWARMFORGE_SH, 'utf8');
    const paneSite = source.slice(source.indexOf('  elif role_uses_openrouter "$role"; then\n    # OpenRouter-backed claude role: same ephemeral'));
    assert.ok(paneSite.length > 0, 'the pane-env OpenRouter branch is gone');
    assert.ok(
      paneSite.indexOf('role_uses_openrouter') < paneSite.indexOf('extra_cli_targets_qwen_cloud'),
      'the pane-env site no longer prefers OpenRouter - the documented asymmetry has changed',
    );
    state(ctx).source = source;
  });

  scoped(/^the swarmforge\.sh source is inspected$/, (ctx) => {
    state(ctx).inspected = fs.readFileSync(SWARMFORGE_SH, 'utf8');
  });

  scoped(/^both sites carry an explicit comment naming the asymmetry and that no live pack combines the two today$/, (ctx) => {
    const source = state(ctx).inspected;
    const notes = source.split('\n').filter((line) => line.includes('BL-1328 PRECEDENCE ASYMMETRY'));
    assert.equal(notes.length, 2, `expected the asymmetry named at BOTH sites, found ${notes.length}`);

    // Each note must say which order ITS site takes, name the other site, and
    // say plainly that the combination is dormant today - a comment that only
    // says "see the other site" sends the reader in a circle.
    const [billingNote, paneNote] = ['billing_guard', 'pane-env'].map((which) => {
      const marker = source.indexOf(
        which === 'billing_guard'
          ? '# BL-1328 PRECEDENCE ASYMMETRY, documented deliberately rather than\n    # reconciled (the human'
          : '# BL-1328 PRECEDENCE ASYMMETRY, documented deliberately rather than\n    # reconciled: THIS site checks role_uses_openrouter FIRST',
      );
      assert.ok(marker >= 0, `the ${which} site's asymmetry comment is missing or reworded past recognition`);
      return source.slice(marker, marker + 1400);
    });

    for (const [label, note] of [['billing_guard', billingNote], ['pane-env', paneNote]]) {
      assert.match(note, /No live pack\s*\n?\s*#?\s*combines the two today|no live pack combines/i, `the ${label} note does not say the combination is dormant today`);
      assert.match(note, /credential\/endpoint\s*\n?\s*#?\s*mismatch/i, `the ${label} note does not say what would go wrong`);
    }
    assert.match(billingNote, /pane-env site in launch_role does the\s*\n?\s*#?\s*OPPOSITE/i, 'the billing_guard note does not name the other site');
    assert.match(paneNote, /billing_guard construction site does the\s*\n?\s*#?\s*OPPOSITE/i, 'the pane-env note does not name the other site');
  });
}

module.exports = { registerSteps };
