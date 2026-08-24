'use strict';

// BL-1101: hand-authored mutation sweep must not certify skipped mutants.
// Drives a fixture sweep that mirrors expedite_mutation_sweep.sh's mutate/
// restore/trap/verdict shape (the real script is Babashka-expedite-specific
// and too heavy for per-scenario), and asserts the live script carries the
// same SKIPPED-fails contract so the two cannot drift.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SWEEP = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'expedite_mutation_sweep.sh'
);
const FEATURE =
  'a hand-authored mutation sweep never reports success while a mutant went unrun';

function writeFixtureSweep(dir, mutants) {
  const lib = path.join(dir, 'lib.bb');
  const unit = path.join(dir, 'unit.bb');
  const prop = path.join(dir, 'prop.bb');
  const sweep = path.join(dir, 'sweep.sh');

  fs.writeFileSync(
    lib,
    [
      '#!/usr/bin/env bb',
      '(ns fixture-lib)',
      '(defn guarded [x] (when (= x :ok) :ok))',
      '(defn marker [] "ANCHOR_ONE")',
      '(defn other [] "ANCHOR_TWO")',
      '',
    ].join('\n')
  );
  // Unit kills mutants that remove "ANCHOR_ONE" from the lib; otherwise green.
  fs.writeFileSync(
    unit,
    [
      '#!/usr/bin/env bb',
      '(when-not (re-find #"ANCHOR_ONE" (slurp (System/getenv "BL1101_LIB")))',
      '  (println "FAIL: ANCHOR_ONE missing") (System/exit 1))',
      '(println "unit ok")',
      '',
    ].join('\n')
  );
  fs.writeFileSync(prop, '#!/usr/bin/env bb\n(println "ALL PROPERTIES HOLD")\n');

  const mutateCalls = mutants
    .map(
      (m) =>
        `mutate "${m.label}" '${m.from.replace(/'/g, "'\\''")}' '${m.to.replace(/'/g, "'\\''")}'`
    )
    .join('\n');

  // Mirrors expedite_mutation_sweep.sh: working-copy backup, trap restore,
  // SKIPPED/SURVIVORS arrays, fail on either, ALL MUTANTS KILLED only if clean.
  fs.writeFileSync(
    sweep,
    `#!/usr/bin/env bash
set -uo pipefail
LIB="${lib}"
UNIT="${unit}"
PROP="${prop}"
export BL1101_LIB="$LIB"
BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT
killed=0; survived=0; skipped=0
declare -a SURVIVORS=()
declare -a SKIPPED=()
mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$LIB" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (anchor not found)"
    SKIPPED+=("$label")
    skipped=$((skipped + 1)); return
  fi
  if ! bb "$UNIT" >/dev/null 2>&1; then
    echo "  killed   $label (unit)"; killed=$((killed + 1)); return
  fi
  if ! bb "$PROP" >/dev/null 2>&1; then
    echo "  killed   $label (property)"; killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}
echo "mutation sweep over $LIB"
${mutateCalls}
restore
echo
echo "mutants: killed=$killed survived=$survived skipped=$skipped"
emit_labeled_list() {
  local header="$1"
  shift
  echo "$header"
  local s
  for s in "$@"; do echo "  - $s"; done
}
fail=0
# Length-before-expand (bash 3.2 + set -u): never expand an empty array.
if [[ "\${#SURVIVORS[@]}" -gt 0 ]]; then
  emit_labeled_list "SURVIVORS (each is a real test gap):" "\${SURVIVORS[@]}"
  fail=1
fi
if [[ "\${#SKIPPED[@]}" -gt 0 ]]; then
  emit_labeled_list "SKIPPED (anchors not found — no evidence produced):" "\${SKIPPED[@]}"
  fail=1
fi
if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "ALL MUTANTS KILLED"
`
  );
  fs.chmodSync(sweep, 0o755);
  return { lib, sweep };
}

function defaultMutants() {
  return [
    { label: 'm-kill-anchor-one', from: 'ANCHOR_ONE', to: 'ANCHOR_XXX' },
    { label: 'm-kill-marker-fn', from: '(defn marker [] "ANCHOR_ONE")', to: '(defn marker [] "GONE")' },
  ];
}

const SITUATION_MUTANTS = {
  "one mutant's anchor is absent from the library": [
    { label: 'm-skip-missing', from: 'NO_SUCH_ANCHOR', to: 'X' },
    { label: 'm-kill-anchor-one', from: 'ANCHOR_ONE', to: 'ANCHOR_XXX' },
  ],
  'one mutant survives both suites': [
    { label: 'm-survive-other', from: 'ANCHOR_TWO', to: 'ANCHOR_TWO_X' },
  ],
  "one mutant's anchor is absent and a different mutant survives": [
    { label: 'm-skip-missing', from: 'NO_SUCH_ANCHOR', to: 'X' },
    { label: 'm-survive-other', from: 'ANCHOR_TWO', to: 'ANCHOR_TWO_X' },
  ],
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture library, its suites, and a sweep whose mutants target that library$/, (ctx) => {
    const real = fs.readFileSync(REAL_SWEEP, 'utf8');
    assert.match(real, /declare -a SKIPPED=\(\)/, 'live sweep must declare SKIPPED array');
    assert.match(
      real,
      /SKIPPED\+=\("\$label"\)/,
      'live sweep must append skipped labels (not silently ignore missing anchors)'
    );
    assert.match(
      real,
      /SKIPPED \(anchors not found/,
      'live sweep must report skipped labels before failing'
    );
    assert.match(real, /emit_labeled_list "SKIPPED/, 'live sweep must name skips via emit_labeled_list');
    // Architect bounce D1 / QA hitchhiker: length-guard before expand under set -u.
    assert.match(
      real,
      /\[\[ "\$\{#SKIPPED\[@\]\}" -gt 0 \]\]/,
      'live sweep must length-guard SKIPPED before expanding under set -u'
    );
    assert.match(
      real,
      /\[\[ "\$\{#SURVIVORS\[@\]\}" -gt 0 \]\]/,
      'live sweep must length-guard SURVIVORS before expanding under set -u'
    );
    // Soft/surgical lock: skip/survivor lists must set fail=1, and fail path exits before certify.
    assert.match(
      real,
      /if \[\[ "\$\{#SKIPPED\[@\]\}" -gt 0 \]\]; then\n  emit_labeled_list "SKIPPED[^\n]*\n  fail=1\nfi/,
      'live sweep must fail=1 when any mutant was skipped'
    );
    assert.match(
      real,
      /if \[\[ "\$\{#SURVIVORS\[@\]\}" -gt 0 \]\]; then\n  emit_labeled_list "SURVIVORS[^\n]*\n  fail=1\nfi/,
      'live sweep must fail=1 when any mutant survived'
    );
    assert.match(
      real,
      /if \[\[ "\$fail" -ne 0 \]\]; then\n\s*exit 1\nfi\necho "ALL MUTANTS KILLED"/,
      'live sweep must exit 1 on fail before certifying ALL MUTANTS KILLED'
    );
    ctx.bl1101 = {
      dir: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1101-')),
      mutants: defaultMutants(),
      uncommittedEdit: null,
    };
  });

  scoped(/^every mutant's anchor is present in the library$/, (ctx) => {
    ctx.bl1101.mutants = defaultMutants();
  });

  for (const [phrase, mutants] of Object.entries(SITUATION_MUTANTS)) {
    scoped(new RegExp(`^${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), (ctx) => {
      ctx.bl1101.mutants = mutants;
    });
  }

  scoped(/^two mutants' anchors are absent from the library$/, (ctx) => {
    ctx.bl1101.mutants = [
      { label: 'm-skip-a', from: 'MISSING_A', to: 'X' },
      { label: 'm-skip-b', from: 'MISSING_B', to: 'Y' },
    ];
  });

  scoped(/^one mutant's anchor is absent and the library carries an uncommitted edit$/, (ctx) => {
    ctx.bl1101.mutants = [{ label: 'm-skip-missing', from: 'NO_SUCH_ANCHOR', to: 'X' }];
    ctx.bl1101.uncommittedEdit = ';; uncommitted edit for BL-1101\n';
  });

  scoped(/^the sweep runs$/, (ctx) => {
    const { lib, sweep } = writeFixtureSweep(ctx.bl1101.dir, ctx.bl1101.mutants);
    if (ctx.bl1101.uncommittedEdit) {
      fs.appendFileSync(lib, ctx.bl1101.uncommittedEdit);
      ctx.bl1101.libBefore = fs.readFileSync(lib, 'utf8');
    }
    const res = spawnSync('bash', [sweep], { encoding: 'utf8', cwd: ctx.bl1101.dir });
    ctx.bl1101.result = {
      status: res.status,
      output: `${res.stdout || ''}${res.stderr || ''}`,
    };
    ctx.bl1101.lib = lib;
  });

  scoped(/^the sweep exits zero and reports ALL MUTANTS KILLED$/, (ctx) => {
    assert.equal(ctx.bl1101.result.status, 0, ctx.bl1101.result.output);
    assert.match(ctx.bl1101.result.output, /ALL MUTANTS KILLED/);
    assert.match(ctx.bl1101.result.output, /skipped=0/);
  });

  scoped(/^the sweep exits non-zero and does not report ALL MUTANTS KILLED$/, (ctx) => {
    assert.notEqual(ctx.bl1101.result.status, 0, ctx.bl1101.result.output);
    assert.doesNotMatch(ctx.bl1101.result.output, /ALL MUTANTS KILLED/);
  });

  scoped(/^the sweep names both unrun mutants by label$/, (ctx) => {
    assert.notEqual(ctx.bl1101.result.status, 0);
    assert.match(ctx.bl1101.result.output, /SKIPPED \(anchors not found/);
    assert.match(ctx.bl1101.result.output, /- m-skip-a/);
    assert.match(ctx.bl1101.result.output, /- m-skip-b/);
  });

  scoped(/^the sweep exits non-zero and the library still carries the uncommitted edit$/, (ctx) => {
    assert.notEqual(ctx.bl1101.result.status, 0);
    const after = fs.readFileSync(ctx.bl1101.lib, 'utf8');
    assert.equal(after, ctx.bl1101.libBefore);
    assert.match(after, /uncommitted edit for BL-1101/);
  });
}

module.exports = { registerSteps };
