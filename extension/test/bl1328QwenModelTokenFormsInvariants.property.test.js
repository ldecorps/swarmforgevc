'use strict';

// BL-1328's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`.
//
//   invariant 1  extra_cli_targets_qwen_cloud detects a qwen* model whether
//                the --model value arrives as a separate token pair or a
//                single --model=<value> token - both forms treated
//                identically everywhere the function is called.
//   invariant 2  The fix never changes matching for a NON-qwen --model value,
//                in either token form - a sibling Anthropic seat's own
//                --model stays undetected exactly as before.
//   invariant 3  The precedence asymmetry between the two call sites is
//                DOCUMENTED at both, not silently reconciled - this ticket
//                changes no precedence.
//
// Invariants 1 and 2 drive the SHIPPED predicate (extracted from
// swarmforge.sh and eval'd under zsh, never a copy). Invariant 3 quantifies
// over the source rather than over a pure function - it is a claim about what
// this parcel did and did not change - so it is measured against the file and
// against this parcel's own diff.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const PREDICATE_CLI = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1330QwenRemapPredicateCli.zsh');

// One zsh process answers for many CLI strings, so a property run is one
// spawn rather than one per draw.
function predicateVerdicts(cliStrings) {
  const specs = cliStrings.map((cli, i) => `seat${i}|${cli}`);
  const r = spawnSync('zsh', [PREDICATE_CLI, SWARMFORGE_SH, ...specs], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error(`the predicate driver failed: ${r.stdout}${r.stderr}`);
  const lines = `${r.stdout}`.trim().split('\n');
  assert.equal(lines.length, cliStrings.length, `expected one verdict per input: ${r.stdout}`);
  return lines.map((line) => line.endsWith('qwen-cloud'));
}

const QWEN_MODELS = ['qwen3.8-max', 'qwen3-coder-plus', 'qwen2.5-72b', 'qwen'];
const OTHER_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'gpt-5', 'mistral-large', 'claude-qwen-lookalike'];
const NOISE = ['--effort low', '--verbose', '--dangerously-skip-permissions', ''];

// Both token forms for one model, built from the SAME model string, so the
// pair is a genuine same-input comparison rather than two independent draws.
function bothForms(model, before, after) {
  return {
    space: [before, `--model ${model}`, after].filter(Boolean).join(' '),
    equals: [before, `--model=${model}`, after].filter(Boolean).join(' '),
  };
}

test('BL-1328/BL-654 invariant 1: a qwen model is detected in both token forms', () => {
  // GENERATOR REACH (by construction): every draw produces BOTH forms of the
  // same model, so the equals form - the one that used to fall through - can
  // never go unexercised. Drawing a form at random would let a pass happen
  // with only the already-working form seen.
  let pairs = 0;
  fc.assert(
    fc.property(fc.constantFrom(...QWEN_MODELS), fc.constantFrom(...NOISE), fc.constantFrom(...NOISE), (model, before, after) => {
      pairs += 1;
      const forms = bothForms(model, before, after);
      const [spaceHit, equalsHit] = predicateVerdicts([forms.space, forms.equals]);
      assert.equal(spaceHit, true, `the space form stopped matching: [${forms.space}]`);
      assert.equal(equalsHit, true, `the equals form is not detected: [${forms.equals}]`);
      assert.equal(spaceHit, equalsHit, 'the two token forms are not treated identically');
      return true;
    }),
    { numRuns: 8 },
  );
  assert.ok(pairs > 0, 'no form pair was exercised');
}, 120000);

test('BL-1328/BL-654 invariant 2: a non-qwen model stays undetected in either form', () => {
  // The dangerous direction: a widened matcher that starts claiming a sibling
  // Anthropic seat would remap ANTHROPIC_BASE_URL for a seat that must keep
  // its subscription auth. `claude-qwen-lookalike` is in the pool on purpose -
  // it CONTAINS "qwen" and must still not match, since only a value that
  // STARTS with qwen is a Token Plan model.
  let seen = 0;
  fc.assert(
    fc.property(fc.constantFrom(...OTHER_MODELS), fc.constantFrom(...NOISE), fc.constantFrom(...NOISE), (model, before, after) => {
      seen += 1;
      const forms = bothForms(model, before, after);
      const [spaceHit, equalsHit] = predicateVerdicts([forms.space, forms.equals]);
      assert.equal(spaceHit, false, `a non-qwen model matched in the space form: [${forms.space}]`);
      assert.equal(equalsHit, false, `a non-qwen model matched in the equals form: [${forms.equals}]`);
      return true;
    }),
    { numRuns: 8 },
  );
  assert.ok(seen > 0, 'no non-qwen model was exercised');
}, 120000);

test('BL-1328/BL-654 invariant 3: the asymmetry is documented at both sites and neither precedence moved', () => {
  const source = fs.readFileSync(SWARMFORGE_SH, 'utf8');

  // Documented at BOTH sites.
  assert.equal(
    source.split('\n').filter((l) => l.includes('BL-1328 PRECEDENCE ASYMMETRY')).length,
    2,
    'the asymmetry is not named at both call sites',
  );

  // ...and NEITHER precedence moved: the billing_guard site still checks
  // qwen-cloud first, the pane-env site still checks OpenRouter first. This
  // ticket documents the asymmetry; a parcel that quietly reconciled it would
  // be a different, unreviewed change.
  const guardSite = source.slice(source.indexOf('if [[ "${SWARMFORGE_USE_QWEN:-}" == "1" ]] || extra_cli_targets_qwen_cloud'));
  const guardBlock = guardSite.slice(0, guardSite.indexOf('\n  fi'));
  assert.ok(
    guardBlock.indexOf('extra_cli_targets_qwen_cloud') < guardBlock.indexOf('role_uses_openrouter'),
    'the billing_guard site no longer prefers qwen-cloud',
  );
  const paneSite = source.slice(source.indexOf('  elif role_uses_openrouter "$role"; then\n    # OpenRouter-backed claude role: same ephemeral'));
  assert.ok(
    paneSite.indexOf('role_uses_openrouter') < paneSite.indexOf('extra_cli_targets_qwen_cloud'),
    'the pane-env site no longer prefers OpenRouter',
  );

  // And measured, not asserted in prose: the NET change this branch makes to
  // swarmforge.sh (origin/main..HEAD, so a bounce's revert and its reapply
  // cancel out instead of being scanned as edits of their own) may add
  // executable lines only inside the detection helper. A branch reordering
  // would show up here as an added executable line outside it.
  // origin/main against the WORKING TREE, not against HEAD: this runs as a
  // pre-commit gate too, where the change is staged and not yet committed,
  // and what matters is what the branch will carry either way.
  const netDiff = execFileSync('git', ['diff', 'origin/main', '--', 'swarmforge/scripts/swarmforge.sh'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const addedExecutable = netDiff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'));
  const helper = source.slice(source.indexOf('extra_cli_targets_qwen_cloud() {'));
  const helperBody = helper.slice(0, helper.indexOf('\n}\n'));
  for (const line of addedExecutable) {
    assert.ok(
      helperBody.includes(line),
      `BL-1328 added executable swarmforge.sh code outside the detection helper: ${JSON.stringify(line)}`
    );
  }
  // Once this work is on origin/main the net diff is empty and the question
  // is settled there, not here - that is not a vacuous pass, it is the check
  // having nothing left to measure.
  if (netDiff.trim().length > 0) {
    assert.ok(
      addedExecutable.some((line) => line.includes('--model=qwen*')),
      'the branch changes swarmforge.sh but carries no equals-form check'
    );
  }

});
