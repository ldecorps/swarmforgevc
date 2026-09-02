'use strict';

// BL-1326: BL-848 stamp-off of Cursor hotfix db7e3f2bda, "Restaff bob BoB
// starting cast: Anthropic seats, coder on qwen3.8-max."
//
// This CONFIRMS OR REFUTES what landed. It reimplements nothing, re-staffs
// nothing, and writes nothing to the ledger (invariants 1 and 2). It also
// does NOT re-review the two BL-1322 ticket files this commit's diff happens
// to carry - those are BL-1322's own record (invariant 3).
//
// Scenario 02 EXECUTES the REAL extra_cli_targets_qwen_cloud out of the REAL
// swarmforge.sh, via lib/bl1326QwenRemapPredicateCli.zsh, against the CLI
// tokens of the SHIPPED conf. A source-text assertion could not tell "only
// the coder seat matches" from "the predicate no longer matches anything",
// and the whole claim of this restaff is which seats the remap still catches.
//
// NAMING: the ticket's required_wiring anchor still says
// `bl1323BobRestaffAnthropicStartingCastSteps` - stale from the
// BL-1323 -> BL-1326 remap (BL-1323 is now a different, live ticket about
// main-sync deadlock hints). Named for BL-1326 here so the handler matches
// its own feature file and cannot collide with the real BL-1323's; the
// discrepancy is raised to the specifier by note.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE =
  'Swarm stamp-off for the bob pack restaff to an Anthropic starting cast with a coder-only Qwen Token Plan seat';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HOTFIX = 'db7e3f2bda';
const PACK = 'swarmforge/packs/bob-multi-provider-mono-router.conf';
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const PREDICATE_CLI = path.join(__dirname, 'lib', 'bl1326QwenRemapPredicateCli.zsh');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

// Explicit KNOWN_VALUES for the Outline - an Outline that accepts any
// placeholder asserts nothing about which seat was exercised.
const KNOWN_ROLES = ['coder', 'specifier', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const KNOWN_MODELS = ['qwen3.8-max', 'claude-sonnet-5'];
const KNOWN_EFFORTS = ['high', 'medium'];

function git(...args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
}

// The conf AS LANDED, read from the commit rather than the working tree, so
// this reviews what db7e3f2bda actually shipped.
function packText() {
  return git('show', `${HOTFIX}:${PACK}`);
}

// One parsed window line: role, agent, and the CLI tokens the launcher would
// pass through (everything from the first flag onwards).
function windows(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^window\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) {
      continue;
    }
    const [, role, agent, rest] = m;
    const flagIdx = rest.indexOf('--');
    out.set(role, {
      role,
      agent,
      cli: flagIdx === -1 ? '' : rest.slice(flagIdx).trim(),
      raw: line,
    });
  }
  return out;
}

function configValue(text, key) {
  const m = text.match(new RegExp(`^config\\s+${key}\\s+(\\S+)`, 'm'));
  return m ? m[1] : undefined;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────

  scoped(/^the landed sources at commit db7e3f2bda$/, (ctx) => {
    ctx.bl1326 = {};
    assert.equal(git('cat-file', '-t', HOTFIX).trim(), 'commit', `${HOTFIX} must be reachable`);
    assert.match(
      git('log', '-1', '--format=%B', HOTFIX),
      /Hotfix-Certification:\s*pending/,
      `${HOTFIX} is not pending certification - a stamp-off has nothing to review`
    );
    // Only the pack conf changed: no launcher code moved. Asserted, because
    // "no launcher code moves" is what puts the remap predicate out of scope.
    const changed = git('diff', '--name-only', `${HOTFIX}^`, HOTFIX)
      .split('\n')
      .filter(Boolean)
      // The two BL-1322 ticket files this commit also carries are BL-1322's
      // own record and explicitly not this ticket's subject (invariant 3).
      .filter((p) => !p.includes('BL-1322'));
    assert.deepEqual(changed, [PACK], `only the pack conf may have changed, got: ${changed.join(', ')}`);
  });

  // ── Given ───────────────────────────────────────────────────────────────

  scoped(/^the bob-multi-provider-mono-router pack$/, (ctx) => {
    ctx.bl1326.text = packText();
  });

  scoped(/^the bob-multi-provider-mono-router pack's window block$/, (ctx) => {
    ctx.bl1326.text = packText();
    ctx.bl1326.windows = windows(ctx.bl1326.text);
    assert.ok(ctx.bl1326.windows.size > 0, 'the pack must declare window lines');
  });

  scoped(/^the bob-multi-provider-mono-router pack's header comment$/, (ctx) => {
    const text = packText();
    ctx.bl1326.text = text;
    // The header is the comment block before the first `config` line.
    const firstConfig = text.indexOf('\nconfig ');
    const raw = firstConfig === -1 ? text : text.slice(0, firstConfig);
    ctx.bl1326.header = raw;
    // The prose WRAPS across comment lines ("... do not treat\n# this file
    // as ..."), so a sentence-level assertion has to read the header as
    // prose, not as lines. Strip the comment markers and collapse
    // whitespace; matching the raw text would fail on where the author
    // happened to wrap, which is not what any of these steps is about.
    ctx.bl1326.headerProse = raw
      .split('\n')
      .map((l) => l.replace(/^#\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  });

  // ── When ────────────────────────────────────────────────────────────────

  scoped(/^the window block is read$/, (ctx) => {
    ctx.bl1326.windows = windows(ctx.bl1326.text);
  });

  scoped(/^each window's pack CLI is evaluated against the qwen-cloud remap predicate$/, (ctx) => {
    const specs = [...ctx.bl1326.windows.values()].map((w) => `${w.role}|${w.cli}`);
    const out = execFileSync('zsh', [PREDICATE_CLI, SWARMFORGE_SH, ...specs], { encoding: 'utf8' });
    ctx.bl1326.remap = new Map(
      out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [role, verdict] = line.split(/\s+/);
          return [role, verdict];
        })
    );
  });

  scoped(/^the review completes with every scenario green$/, (ctx) => {
    ctx.bl1326.reviewGreen = true;
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^the window for role "([^"]+)" names the claude agent$/, (ctx, role) => {
    assert.ok(KNOWN_ROLES.includes(role), `unknown role "${role}"`);
    const w = ctx.bl1326.windows.get(role);
    assert.ok(w, `no window line for role "${role}"`);
    assert.equal(w.agent, 'claude');
  });

  scoped(/^the window for role "([^"]+)" names model "([^"]+)"$/, (ctx, role, model) => {
    assert.ok(KNOWN_ROLES.includes(role), `unknown role "${role}"`);
    assert.ok(KNOWN_MODELS.includes(model), `unknown model "${model}"`);
    const w = ctx.bl1326.windows.get(role);
    assert.match(w.cli, new RegExp(`--model\\s+${model.replace('.', '\\.')}(\\s|$)`));
  });

  scoped(/^the window for role "([^"]+)" carries effort "([^"]+)"$/, (ctx, role, effort) => {
    assert.ok(KNOWN_ROLES.includes(role), `unknown role "${role}"`);
    assert.ok(KNOWN_EFFORTS.includes(effort), `unknown effort "${effort}"`);
    assert.match(ctx.bl1326.windows.get(role).cli, new RegExp(`--effort\\s+${effort}(\\s|$)`));
  });

  scoped(/^only the window for role "([^"]+)" targets the Qwen cloud gateway$/, (ctx, role) => {
    assert.ok(KNOWN_ROLES.includes(role), `unknown role "${role}"`);
    assert.equal(ctx.bl1326.remap.get(role), 'qwen-cloud');
    const matching = [...ctx.bl1326.remap.entries()].filter(([, v]) => v === 'qwen-cloud').map(([r]) => r);
    assert.deepEqual(matching, [role], `exactly one seat may remap, got: ${matching.join(', ')}`);
  });

  scoped(/^every other window targets no remap$/, (ctx) => {
    for (const [role, verdict] of ctx.bl1326.remap) {
      if (role !== 'coder') {
        assert.equal(verdict, 'none', `${role} unexpectedly targets the Qwen cloud gateway`);
      }
    }
  });

  scoped(/^no window line names role "([^"]+)"$/, (ctx, role) => {
    assert.equal(windows(ctx.bl1326.text).has(role), false, `${role} must not be a window line`);
  });

  scoped(/^the pack's coordinator_agent config is "([^"]+)"$/, (ctx, want) => {
    assert.equal(configValue(ctx.bl1326.text, 'coordinator_agent'), want);
  });

  scoped(/^the pack's coordinator_model config is "([^"]+)"$/, (ctx, want) => {
    assert.equal(configValue(ctx.bl1326.text, 'coordinator_model'), want);
  });

  scoped(/^the header states Anthropic is the starting point for every seat except the resident coder$/, (ctx) => {
    assert.match(ctx.bl1326.headerProse, /starting point\*? is Anthropic on every seat/i);
    assert.match(ctx.bl1326.headerProse, /except the resident HOME \(coder\)/i);
  });

  scoped(/^the header warns against treating the file as an already-diversified multi-vendor mix$/, (ctx) => {
    assert.match(ctx.bl1326.headerProse, /do not treat this file as the old multi-vendor mix/i);
  });

  scoped(/^the PREREQ section names an Anthropic subscription for every non-coder seat$/, (ctx) => {
    assert.match(ctx.bl1326.headerProse, /PREREQ/);
    assert.match(ctx.bl1326.headerProse, /Anthropic subscription \(claude\) for every non-coder seat/i);
  });

  scoped(/^the PREREQ section names BAILIAN_TOKEN_PLAN_API_KEY or QWEN_API_KEY for the coder seat only$/, (ctx) => {
    assert.match(ctx.bl1326.headerProse, /BAILIAN_TOKEN_PLAN_API_KEY.*QWEN_API_KEY.*for the coder seat/i);
  });

  // Invariant 2: green scenarios leave the ledger row exactly as they found it.
  scoped(/^the hotfix ledger entry for commit db7e3f2bda is still awaiting a human decision$/, (ctx) => {
    assert.equal(ctx.bl1326.reviewGreen, true);
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
  });
}

module.exports = { registerSteps };
