'use strict';

// BL-1324 declared invariants (ticket YAML `invariants:`), each encoded as
// an executable property. Runs ONLY via `npm run test:properties`.
//
// 1. "This stamp-off never reimplements, rewrites or reverts the hotfix -
//    review confirms or refutes landed commit 4ed88430b2 only."
// 2. "Green tests alone never write certified or waived into the hotfix
//    ledger; only a recorded human decision does (BL-848)."
// 3. "A sibling Anthropic (non-qwen) claude seat in the same mixed pack is
//    never remapped onto the Token Plan endpoint by this hotfix - only a
//    seat whose own --model is qwen* is affected."
//
// Invariant 3 drives the REAL swarmforge.sh under `zsh -f` against a
// throwaway fixture root. A JS re-statement of the matcher would be a
// reimplementation of the very code under review and could not exhibit the
// defect this invariant guards (a sibling Anthropic seat silently losing
// first-party auth), so nothing here re-implements it.
//
// Generator reach (the asserted floor, not a hoped-for one): the sibling
// generator does NOT draw a model and a decoy independently - every case is
// a collision candidate BY CONSTRUCTION, built by taking the very qwen
// model id the matcher looks for and placing it everywhere in the seat's
// CLI EXCEPT immediately after a `--model` token. Independent draws would
// almost never produce a string containing "qwen" at all, and the property
// would pass against a matcher that scanned for a bare substring.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');
const HOTFIX_COMMIT = '4ed88430b2';
const CONTEXT_VAR = 'CLAUDE_CODE_MAX_CONTEXT_TOKENS';
const TOKEN_PLAN_HOST = 'token-plan.ap-southeast-1.maas.aliyuncs.com';
const REMAP_CALL = 'qwen_guard_map_anthropic_compat';
const SUBSCRIPTION_GUARD = 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN';

// The hotfix-owned artifacts. Invariant 1 quantifies over these.
const HOTFIX_PATHS = [
  'swarmforge/scripts/swarmforge.sh',
  'swarmforge/packs/bob-multi-provider-mono-router.conf',
];

const PROVIDER_KEYS = [
  'QWEN_API_KEY',
  'BAILIAN_CODING_PLAN_API_KEY',
  'BAILIAN_TOKEN_PLAN_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_API_BASE',
  'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'OPENROUTER_API_KEY',
  'MISTRAL_API_KEY',
  'CEREBRAS_API_KEY',
  'PERPLEXITY_API_KEY',
  'GEMINI_API_KEY',
  'SWARMFORGE_GEMINI_API_KEY',
  'SWARMFORGE_USE_QWEN',
  CONTEXT_VAR,
];

function git(...args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
  });
}

// Anchored extraction, so the comparison survives unrelated edits moving
// the code and still catches an edit to the hotfix's own lines.
function hotfixRegions(text) {
  const lines = text.split('\n');
  const grab = (startRe, endRe, label) => {
    const start = lines.findIndex((l) => startRe.test(l));
    assert.notEqual(start, -1, `hotfix region "${label}" not found`);
    const rel = lines.slice(start + 1).findIndex((l) => endRe.test(l));
    assert.notEqual(rel, -1, `hotfix region "${label}" has no end`);
    return lines.slice(start, start + rel + 2).join('\n');
  };
  return {
    matcher: grab(/^extra_cli_targets_qwen_cloud\(\) \{$/, /^\}$/, 'matcher'),
    billingGuard: grab(
      /extra_cli_targets_qwen_cloud "\$extra_cli"/,
      /^\s*elif role_uses_openrouter "\$role"; then$/,
      'billing guard'
    ),
    paneEnv: grab(
      /elif \[\[ "\$agent" == "claude" \]\] && extra_cli_targets_qwen_cloud "\$\{EXTRA_CLI_ARGS\[\$index\]:-\}"/,
      /^\s*fi$/,
      'pane env'
    ),
  };
}

function fixtureEnv(overrides = {}) {
  const env = { ...process.env };
  for (const name of PROVIDER_KEYS) delete env[name];
  env.PACK_STAFFING_SKIP_GATE = '1';
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

function makeFixtureRoot() {
  const root = fs.realpathSync(mkTmpDir('bl1324-prop-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  fs.writeFileSync(path.join(root, 'swarmforge', 'roles', 'coder.prompt'), 'role prompt\n');
  return root;
}

// One zsh process evaluates MANY generated strings, so a property can draw a
// realistic number of cases without paying a process spawn per draw.
function matchesBatch(extraClis) {
  const root = makeFixtureRoot();
  try {
    const calls = extraClis
      .map((s, i) => `extra_cli_targets_qwen_cloud ${JSON.stringify(s)} && echo "${i} TRUE" || echo "${i} FALSE"`)
      .join('\n');
    const r = spawnSync('zsh', ['-f', '-c', `source '${SWARMFORGE_SH}' '${root}'\n${calls}`], {
      encoding: 'utf8',
      env: fixtureEnv(),
    });
    const verdicts = new Map();
    for (const line of `${r.stdout}`.split('\n')) {
      const m = /^(\d+) (TRUE|FALSE)$/.exec(line.trim());
      if (m) verdicts.set(Number(m[1]), m[2] === 'TRUE');
    }
    assert.equal(
      verdicts.size,
      extraClis.length,
      `the matcher produced ${verdicts.size} verdicts for ${extraClis.length} inputs: ${r.stderr}`
    );
    return extraClis.map((_, i) => verdicts.get(i));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function buildLaunchScript(extraCli, env) {
  const root = makeFixtureRoot();
  try {
    fs.writeFileSync(
      path.join(root, 'swarmforge', 'swarmforge.conf'),
      `config active_backlog_max_depth -1\nwindow coder claude coder ${extraCli}\n`
    );
    const r = spawnSync(
      'zsh',
      ['-f', '-c', `source '${SWARMFORGE_SH}' '${root}'; parse_config; write_role_launch_script 1 >/dev/null`],
      { encoding: 'utf8', env }
    );
    const script = path.join(root, '.swarmforge', 'launch', 'coder.sh');
    assert.ok(fs.existsSync(script), `no launch script for "${extraCli}": ${r.stdout}${r.stderr}`);
    return fs.readFileSync(script, 'utf8');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Generators. Every sibling case is a collision candidate BY CONSTRUCTION.
// ---------------------------------------------------------------------------

const qwenModel = fc
  .tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 0, max: 9 }), fc.constantFrom('max', 'plus', 'turbo', 'coder'))
  .map(([maj, min, tier]) => `qwen${maj}.${min}-${tier}`);

const anthropicModel = fc.constantFrom(
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-haiku-4-5-20251001',
  'claude-fable-5-1'
);

const noiseFlag = fc.constantFrom(
  '--dangerously-skip-permissions',
  '--effort high',
  '--effort medium',
  '--permission-mode acceptEdits'
);

// A sibling seat: an Anthropic --model, PLUS the qwen id smuggled into every
// position that is NOT "the token right after --model". If the matcher ever
// degraded to a substring scan, or read the wrong index, one of these flips.
const siblingSeat = fc
  .tuple(anthropicModel, qwenModel, fc.constantFrom(0, 1, 2, 3, 4), fc.array(noiseFlag, { maxLength: 2 }))
  .map(([model, qwen, shape, noise]) => {
    const decoy = [
      `--fallback-model ${qwen}`, // qwen* as ANOTHER flag's value
      `--model=${qwen}`, // the single-token form the matcher does not read
      `${qwen}`, // a bare positional token
      `--notes for-${qwen}-seats`, // qwen* embedded mid-value
      `--model-hint ${qwen}`, // a flag whose NAME merely starts with --model
    ][shape];
    return [`--model ${model}`, decoy, ...noise].join(' ');
  });

// A qwen-targeted seat: the space-separated `--model <qwen*>` pair the
// matcher is specified to detect, with arbitrary surrounding flags and
// arbitrary flag ordering, so "detected" is not an artefact of position.
const qwenSeat = fc
  .tuple(qwenModel, fc.array(noiseFlag, { maxLength: 3 }), fc.boolean())
  .map(([qwen, noise, leading]) =>
    (leading ? [...noise, `--model ${qwen}`] : [`--model ${qwen}`, ...noise]).join(' ')
  );

// ---------------------------------------------------------------------------

describe('BL-1324 stamp-off invariants', () => {
  it('invariant 1: no revision of this stamp-off rewrote, reverted or retouched the hotfix', () => {
    // Quantifies over two case kinds, both reaching every revision that has
    // touched a hotfix-owned artifact since the hotfix landed - not HEAD
    // alone:
    //   content    - the swarmforge.sh hotfix regions must be byte-identical
    //                to 4ed88430b2 at HEAD and at each such revision;
    //   attribution - no revision that changed ANY hotfix-owned artifact may
    //                be attributed to this stamp-off ticket. (The pack conf
    //                was legitimately restaffed later by an operator commit,
    //                441fd35112, so content equality is the wrong test for
    //                it; who changed it is the right one.)
    const touching = (p) => git('rev-list', `${HOTFIX_COMMIT}..HEAD`, '--', p).split('\n').filter(Boolean);
    const shPath = HOTFIX_PATHS[0];
    const cases = [
      // The checked-out file too, not only committed revisions: a working
      // tree that rewrote the hotfix would otherwise reach every other
      // gate in this parcel before anything noticed.
      { kind: 'worktree', p: shPath, rev: 'working tree' },
      { kind: 'content', p: shPath, rev: 'HEAD' },
      ...touching(shPath).map((rev) => ({ kind: 'content', p: shPath, rev })),
      ...HOTFIX_PATHS.flatMap((p) => touching(p).map((rev) => ({ kind: 'attribution', p, rev }))),
    ];
    assert.ok(
      cases.some((c) => c.kind === 'attribution'),
      'the revision walk reached no revision that touched a hotfix artifact - the attribution face would be vacuous'
    );

    const landedRegions = hotfixRegions(git('show', `${HOTFIX_COMMIT}:${shPath}`));

    fc.assert(
      fc.property(fc.constantFrom(...cases), ({ kind, p, rev }) => {
        if (kind === 'content' || kind === 'worktree') {
          const text = kind === 'worktree'
            ? fs.readFileSync(path.join(REPO_ROOT, p), 'utf8')
            : git('show', `${rev}:${p}`);
          const seen = hotfixRegions(text);
          for (const key of Object.keys(landedRegions)) {
            assert.equal(seen[key], landedRegions[key], `region "${key}" of ${p} differs at ${rev}`);
          }
          return;
        }
        const subject = git('log', '-1', '--format=%s', rev).trim();
        assert.ok(
          !/BL-1324/.test(subject),
          `this stamp-off parcel modified hotfix-owned ${p} at ${rev} ("${subject}")`
        );
      }),
      { numRuns: Math.max(16, cases.length * 4) }
    );
  });

  it('invariant 2: no artifact this parcel authors writes certified or waived into the reviewed commit\'s ledger row', () => {
    // The ledger legitimately carries decided rows for OTHER commits, so the
    // property is scoped to the row for 4ed88430b2 and to any parcel-authored
    // artifact that so much as names the commit alongside a verdict word.
    const parcelPaths = git('diff', '--name-only', `${HOTFIX_COMMIT}..HEAD`)
      .split('\n')
      .filter((p) => p && /BL-1324|bl1324/i.test(p) && fs.existsSync(path.join(REPO_ROOT, p)));

    const ledgerRow = () => {
      const lines = fs.readFileSync(LEDGER, 'utf8').split('\n');
      const start = lines.findIndex((l) => l.trim() === `- commit: ${HOTFIX_COMMIT}`);
      assert.notEqual(start, -1, 'no ledger row for the reviewed commit');
      const end = lines.slice(start + 1).findIndex((l) => /^- commit: /.test(l.trim()));
      return lines.slice(start, end === -1 ? lines.length : start + 1 + end).join('\n');
    };

    fc.assert(
      fc.property(fc.constantFrom('certified', 'waived'), (verdict) => {
        assert.doesNotMatch(
          ledgerRow(),
          new RegExp(`state:\\s*${verdict}\\b`),
          `the ledger row for ${HOTFIX_COMMIT} reads "${verdict}" with no recorded human decision (BL-848)`
        );
        for (const p of parcelPaths) {
          const text = fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
          for (const line of text.split('\n')) {
            assert.ok(
              !(new RegExp(`state:\\s*${verdict}\\b`).test(line) && /4ed88430b2/.test(text)),
              `${p} writes state: ${verdict} for the reviewed commit`
            );
          }
        }
      }),
      { numRuns: 12 }
    );

    const row = ledgerRow();
    assert.match(row, /human_decision:\s*null/, 'human_decision is not null - a decision was recorded by a test run');
    assert.match(row, /decided_at:\s*null/, 'decided_at is not null');
    assert.match(row, /stamp_ticket:\s*BL-1324/, 'the ledger row no longer links this stamp-off ticket');
  });

  it('invariant 3: only a seat whose own --model is qwen* is remapped; a sibling Anthropic seat is untouched', () => {
    // Face A (batched, wide): the matcher itself. Collision candidates by
    // construction - each sibling string CONTAINS a real qwen model id.
    const siblings = fc.sample(siblingSeat, 120);
    const qwens = fc.sample(qwenSeat, 120);
    assert.ok(
      siblings.every((s) => /qwen\d/.test(s)),
      'the sibling generator produced a case with no qwen id in it - the collision floor is not met'
    );
    for (const [i, verdict] of matchesBatch(siblings).entries()) {
      assert.equal(verdict, false, `a sibling Anthropic seat was detected as qwen-targeted: "${siblings[i]}"`);
    }
    for (const [i, verdict] of matchesBatch(qwens).entries()) {
      assert.equal(verdict, true, `a qwen-targeted seat was not detected: "${qwens[i]}"`);
    }

    // Face B (narrow, end-to-end): the generated launch script - the
    // artifact that actually decides which endpoint the seat authenticates
    // against. Fewer runs: each one composes a real launch script.
    fc.assert(
      fc.property(siblingSeat, (extraCli) => {
        const script = buildLaunchScript(extraCli, fixtureEnv());
        assert.ok(!script.includes(REMAP_CALL), `sibling seat remapped onto Token Plan: "${extraCli}"`);
        assert.ok(!script.includes(TOKEN_PLAN_HOST), `sibling seat names the Token Plan host: "${extraCli}"`);
        assert.ok(script.includes(SUBSCRIPTION_GUARD), `sibling seat lost first-party auth: "${extraCli}"`);
      }),
      { numRuns: 8 }
    );

    fc.assert(
      fc.property(qwenSeat, (extraCli) => {
        const script = buildLaunchScript(extraCli, fixtureEnv());
        assert.ok(script.includes(REMAP_CALL), `qwen-targeted seat was not remapped: "${extraCli}"`);
        assert.ok(
          script.includes(`export ${CONTEXT_VAR}="\${${CONTEXT_VAR}:-1000000}"`),
          `qwen-targeted seat did not declare ${CONTEXT_VAR}: "${extraCli}"`
        );
      }),
      { numRuns: 8 }
    );
  });
});
