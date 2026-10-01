'use strict';

// BL-1845 declared invariants (ticket YAML `invariants:`), each encoded as
// an executable property. Runs ONLY via `npm run test:properties`.
//
// 1. "Every launch the swarm writes for a local-model seat starts qwen
//    interactive: the kickoff reaches qwen only as the value of its
//    interactive prompt option."
// 2. "Every other agent's generated launch script is byte-identical before
//    and after this change."
//
// Both drive the REAL swarmforge.sh (write_role_launch_script) under
// `zsh -c` against throwaway fixture roots - never a reimplementation of
// the launch-body text, which lives only there.
//
// Invariant 2's "before/after this change" is read as: mutating the
// local-model branch's own kickoff-delivery line can never change any
// OTHER agent's generated launch script, since the two live in independent
// branches of the same `case` statement. This is proven, not argued from
// code shape (the BL-1842 bounce's own lesson): a throwaway copy of
// swarmforge.sh has the local-model branch's own kickoff mechanism
// deliberately broken (reverted to the pre-hotfix bare argument), and
// every other agent's generated script is asserted byte-identical between
// the real file and the broken copy.
//
// Generator reach: invariant 1's generator draws real role@variant seat
// names and model ids, so every run genuinely exercises a distinct launch
// script, not one fixed example. Invariant 2's generator draws from the
// REAL set of other supported agents (claude, aider, gemini, vibe,
// cursor), each with a role name that also varies, so a regression
// touching any one agent's branch would be caught, not only local-model's
// neighbour in the `case` statement.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');

function fixtureEnv() {
  return { ...process.env, SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS: 'healthy', PACK_STAFFING_SKIP_GATE: '1' };
}

function makeFixtureRoot(extraRoles = []) {
  const root = fs.realpathSync(mkTmpDir('bl1845-prop-'));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), '');
  for (const role of new Set(['coder', ...extraRoles])) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

const indexOfRoleSnippet = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function generateLaunchScript(swarmforgeShPath, root, windowLine, role) {
  const stage = role.split('@')[0];
  const confLines = ['config active_backlog_max_depth -1'];
  if (role !== stage) {
    // BL-982: a stage's additional seat (role@variant) requires the bare
    // stage-named seat to exist too.
    confLines.push(`window ${stage} claude ${stage} --model claude-sonnet-5`);
  }
  confLines.push(windowLine);
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), confLines.join('\n') + '\n');
  const r = execFileSync(
    'zsh',
    ['-c', `source '${swarmforgeShPath}' '${root}'; parse_config; ${indexOfRoleSnippet} write_role_launch_script "$(index_of_role '${role}')"`],
    { encoding: 'utf8', env: fixtureEnv() }
  );
  void r;
  return fs.readFileSync(path.join(root, '.swarmforge', 'launch', `${role}.sh`), 'utf8');
}

// ── Invariant 1: every local-model launch starts qwen interactive ─────────

const variantArb = fc.stringMatching(/^[a-zA-Z0-9]{1,10}$/);
const modelArb = fc.constantFrom('ista-iq3s-coder:latest', 'qwen2.5-coder:7b-instruct', 'llama3.1:8b');

test(
  'BL-1845 invariant 1: every local-model launch hands qwen its kickoff only via the interactive prompt option',
  () => {
    fc.assert(
      fc.property(variantArb, modelArb, (variant, model) => {
        const role = `coder@${variant}`;
        const root = makeFixtureRoot();
        try {
          const script = generateLaunchScript(SWARMFORGE_SH, root, `window ${role} local-model coder-${variant} --model ${model}`, role);
          const qwenLine = script.split('\n').find((l) => l.includes('qwen --auth-type'));
          assert.ok(qwenLine, `expected a qwen launch line for "${role}":\n${script}`);
          const m = /(?:^|\s)-i\s+"((?:[^"\\]|\\.)*)"/.exec(qwenLine);
          assert.ok(m, `expected a standalone -i followed by a double-quoted kickoff: ${qwenLine}`);
          assert.ok(!/(?:^|\s)-p(?:\s|$)/.test(qwenLine), `expected no -p flag: ${qwenLine}`);
          assert.ok(!qwenLine.includes('--prompt'), `expected no --prompt flag: ${qwenLine}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 12 }
    );
  },
  propertyLaneTimeoutMs(30000)
);

// ── Invariant 2: every OTHER agent's launch is unaffected ─────────────────

// {agent, a window line builder, a role to generate} - every entry drawn
// from the REAL set of other supported agents (validate_agent's own
// allow-list), each on ITS OWN role so a regression scoped to one agent's
// branch could not hide behind another's.
const OTHER_AGENT_CASES = [
  { agent: 'claude', windowLine: (role) => `window ${role} claude ${role} --model claude-sonnet-5` },
  { agent: 'aider', windowLine: (role) => `window ${role} aider ${role} --model openai/qwen3-14b:latest --openai-api-base http://127.0.0.1:11434/v1 --seat-tier easy` },
  { agent: 'gemini', windowLine: (role) => `window ${role} gemini ${role} --model gemini-2.5-pro` },
  { agent: 'cursor', windowLine: (role) => `window ${role} cursor ${role} --model auto` },
];
const otherAgentCaseArb = fc.constantFrom(...OTHER_AGENT_CASES);
const otherAgentRoleArb = fc.stringMatching(/^[a-z]{3,10}$/);

function brokenSwarmforgeShCopy() {
  // swarmforge.sh sources sibling scripts (e.g. harness_env_scrub.sh) by a
  // path relative to its OWN directory - copying the file alone breaks
  // that, so the whole scripts/ directory is copied and only the copy's
  // swarmforge.sh is mutated.
  const dir = fs.realpathSync(mkTmpDir('bl1845-broken-copy-'));
  fs.cpSync(SCRIPTS_DIR, dir, { recursive: true });
  const copyPath = path.join(dir, 'swarmforge.sh');
  const original = fs.readFileSync(SWARMFORGE_SH, 'utf8');
  const needle = 'qwen --auth-type openai -y${qwen_cli:+ $qwen_cli} -i \\"\\${RESUME_NOTE}';
  assert.ok(original.includes(needle), 'bl1845 property: the local-model qwen launch line text moved - update this test\'s needle');
  const broken = original.replace(needle, 'qwen --auth-type openai -y${qwen_cli:+ $qwen_cli} \\"\\${RESUME_NOTE}');
  assert.notEqual(broken, original, 'bl1845 property: the mutation did not change the file');
  fs.writeFileSync(copyPath, broken);
  fs.chmodSync(copyPath, 0o755);
  return { dir, copyPath };
}

test(
  'BL-1845 invariant 2: mutating the local-model branch never changes another agent\'s generated launch script',
  () => {
    const { dir: brokenDir, copyPath: brokenSh } = brokenSwarmforgeShCopy();
    const brokenScriptsDir = brokenDir;
    try {
      fc.assert(
        fc.property(otherAgentCaseArb, otherAgentRoleArb, ({ agent, windowLine }, role) => {
          const rootReal = makeFixtureRoot([role]);
          const rootBroken = makeFixtureRoot([role]);
          try {
            const realScript = generateLaunchScript(SWARMFORGE_SH, rootReal, windowLine(role), role);
            const brokenScript = generateLaunchScript(brokenSh, rootBroken, windowLine(role), role);
            // Normalize the two incidental path differences every pair of
            // calls produces regardless of this invariant - each fixture
            // root is its own fresh mkdtemp, and the broken copy's own
            // SCRIPT_DIR differs from the real SCRIPTS_DIR - neither is
            // what this property is about.
            const normalize = (script, root, scriptsDir) =>
              script.split(root).join('<ROOT>').split(scriptsDir).join('<SCRIPTS_DIR>');
            assert.equal(
              normalize(realScript, rootReal, SCRIPTS_DIR),
              normalize(brokenScript, rootBroken, brokenScriptsDir),
              `agent "${agent}" role "${role}": launch script changed when the UNRELATED local-model branch was mutated`
            );
            return true;
          } finally {
            fs.rmSync(rootReal, { recursive: true, force: true });
            fs.rmSync(rootBroken, { recursive: true, force: true });
          }
        }),
        { numRuns: 8 }
      );
    } finally {
      fs.rmSync(brokenDir, { recursive: true, force: true });
    }
  },
  propertyLaneTimeoutMs(30000)
);
