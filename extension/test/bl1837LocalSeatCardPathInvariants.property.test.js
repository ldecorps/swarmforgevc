'use strict';

// BL-1837 declared invariant (ticket YAML `invariants:`), encoded as an
// executable property. Runs ONLY via `npm run test:properties`.
//
// "No local-model seat's launch prompt contains an '@' character."
//
// Drives the REAL swarmforge.sh (write_agent_instruction_file +
// write_role_launch_script, the same two calls launch_role makes) under
// `zsh -f` against a throwaway fixture root, for a generated variant
// suffix on a local-model seat's role name - never a JS re-statement of
// role_prompt_card_path, which would be a reimplementation of the code
// under test and could not exhibit the defect this invariant guards (qwen
// rewriting "@<path>" as a file reference before the model ever sees it).
//
// Generator reach (the asserted floor, not a hoped-for one): every
// generated case IS an "@"-bearing role name by construction (`coder@` +
// the drawn suffix) - the shape every real local-model seat with more than
// one instance uses (coder@iq3, coder@2, ...). An independent draw over
// arbitrary strings would almost never happen to contain "@" at all, and
// the property would pass against a matcher that never even exercised the
// mapping this ticket adds.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

// Alphanumeric only: a real seat variant (iq3, 2, fable, extra, ...) never
// carries characters a shell window-line parser or a path would choke on -
// this property is about the "@" mapping, not conf-line quoting.
const variantArb = fc.stringMatching(/^[a-zA-Z0-9]{1,12}$/);

function fixtureEnv() {
  return { ...process.env, SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS: 'healthy', PACK_STAFFING_SKIP_GATE: '1' };
}

function makeFixtureRoot() {
  const root = fs.realpathSync(mkTmpDir('bl1837-prop-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  fs.writeFileSync(path.join(root, 'swarmforge', 'roles', 'coder.prompt'), 'role prompt\n');
  return root;
}

// One zsh process writes MANY generated seats' launch scripts, so a
// property can draw a realistic number of cases without paying a process
// spawn per draw.
function qwenLinesForVariants(variants) {
  const root = makeFixtureRoot();
  try {
    const confLines = [
      'config active_backlog_max_depth -1',
      'window coder claude coder --model claude-sonnet-5',
      ...variants.map(
        (v, i) => `window coder@${v}-${i} local-model coder-${v}-${i} --model ista-iq3s-coder:latest`
      ),
    ];
    fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), confLines.join('\n') + '\n');
    const indexOfRoleSnippet = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;
    const perSeatCalls = variants
      .map(
        (v, i) =>
          `idx="$(index_of_role 'coder@${v}-${i}')"; ` +
          `write_agent_instruction_file "\${ROLES[$idx]}" "$(role_prompt_card_path "\${ROLES[$idx]}" "\${AGENTS[$idx]}")" "\${AGENTS[$idx]}" "" "\${STAGES[$idx]}"; ` +
          `write_role_launch_script "$idx" >/dev/null`
      )
      .join('\n');
    const r = spawnSync(
      'zsh',
      ['-c', `source '${SWARMFORGE_SH}' '${root}'\nparse_config\n${indexOfRoleSnippet}\n${perSeatCalls}`],
      { encoding: 'utf8', env: fixtureEnv() }
    );
    assert.equal(r.status, 0, `fixture launch-script write failed: ${r.stderr}`);
    return variants.map((v, i) => {
      const script = fs.readFileSync(path.join(root, '.swarmforge', 'launch', `coder@${v}-${i}.sh`), 'utf8');
      const qwenLine = script.split('\n').find((line) => line.includes('qwen --auth-type'));
      assert.ok(qwenLine, `expected a qwen launch line for variant "${v}" in:\n${script}`);
      return qwenLine;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test(
  'BL-1837 invariant: no local-model seat launch prompt contains an "@" character',
  () => {
    fc.assert(
      fc.property(fc.array(variantArb, { minLength: 1, maxLength: 8 }), (variants) => {
        const qwenLines = qwenLinesForVariants(variants);
        for (let i = 0; i < variants.length; i += 1) {
          assert.ok(
            !qwenLines[i].includes('@'),
            `variant "${variants[i]}" (seat coder@${variants[i]}-${i}): expected no "@" in the qwen launch line: ${qwenLines[i]}`
          );
        }
        return true;
      }),
      { numRuns: 15 }
    );
  },
  propertyLaneTimeoutMs(30000)
);

// Hardener pass (2026-10-01): checked whether role_prompt_card_path's
// global "@" replace (bash `${role//@/-}`) could be weakened to a
// first-occurrence-only replace (`${role/@/-}`) without any test here
// noticing - every generated case above carries exactly one "@", which
// cannot discriminate the two forms. EQUIVALENT, not a gap (BL-234): a
// role name with a SECOND "@" can never reach this function at all -
// parse_config's own seat-id validation (`"$seat_suffix" == *"@"*` ->
// "expected <stage>@<seat> with a single '@'", swarmforge.sh ~line 1045)
// refuses any window line whose role carries more than one "@" before
// AGENTS/ROLES are ever populated. Confirmed directly: driving
// qwenLinesForVariants with a variant containing an embedded "@"
// (constructing a two-"@" role) fails at parse_config with exactly that
// error, never reaching role_prompt_card_path - so no test could exercise
// the global-vs-first-occurrence distinction even by construction.
