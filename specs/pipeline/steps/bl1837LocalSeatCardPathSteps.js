'use strict';

// BL-1837: step handlers for "A local-model seat's launch hands qwen its
// card by a path qwen reads back verbatim". Drives the REAL
// write_role_launch_script (and write_agent_instruction_file, to produce a
// real composed card to compare against) from swarmforge.sh over a real
// mkdtemp fixture, the same way swarmforge/scripts/test/test_local_model_seat.sh
// does - never a reimplementation of the launch-script text, which lives
// only in swarmforge.sh.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');

const FEATURE = "BL-1837 A local-model seat's launch hands qwen its card by a path qwen reads back verbatim";

// window <role> <agent> <worktree-name> --model <model>
function parseWindowLine(windowLine) {
  const parts = windowLine.trim().split(/\s+/);
  if (parts[0] !== 'window') {
    throw new Error(`bl1837: expected a line starting with "window", got: ${windowLine}`);
  }
  return { role: parts[1], agent: parts[2] };
}

function mkFixtureRoot() {
  const root = mkProcessTmpDir('bl1837-seat-card-path-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  for (const role of ['specifier', 'coder', 'documenter']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function runLaunchScriptWrite(root, windowLine, role) {
  const { role: seatRole } = parseWindowLine(windowLine);
  const stage = seatRole.split('@')[0];
  // BL-982: a stage's additional seat (role@variant) requires the bare
  // stage-named seat to exist too - parcels address the stage, never the
  // variant. A minimal, otherwise-inert bare seat on a harmless agent, only
  // when the window line under test is itself the additional one.
  const lines = [`config active_backlog_max_depth -1`];
  if (seatRole !== stage) {
    lines.push(`window ${stage} claude ${stage} --model claude-sonnet-5`);
  }
  lines.push(windowLine);
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), lines.join('\n') + '\n');
  const indexOfRoleSnippet = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;
  // The same invocation shape test_local_model_seat.sh uses: source
  // swarmforge.sh (which only defines functions/parses argv, never
  // launches anything, per that file's own established pattern), run
  // parse_config, find the role's index, then write_agent_instruction_file
  // + write_role_launch_script - the same two calls launch_role makes,
  // minus the tmux respawn (BL-1837's own scope is the text those two
  // writers produce, not the pane spawn).
  execFileSync(
    'zsh',
    [
      '-c',
      `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${indexOfRoleSnippet} ` +
        `idx="$(index_of_role '${role}')"; ` +
        `write_agent_instruction_file "\${ROLES[$idx]}" "$(role_prompt_card_path "\${ROLES[$idx]}" "\${AGENTS[$idx]}")" "\${AGENTS[$idx]}" "" "\${STAGES[$idx]}"; ` +
        `write_role_launch_script "$idx"`,
    ],
    { encoding: 'utf8', env: { ...process.env, SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS: 'healthy', PACK_STAFFING_SKIP_GATE: '1' } }
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a pack whose window line is "([^"]+)"$/, (ctx, windowLine) => {
    ctx.windowLine = windowLine;
    const { role, agent } = parseWindowLine(windowLine);
    ctx.role = role;
    ctx.agent = agent;
    ctx.root = mkFixtureRoot();
  });

  scoped(/^the swarm writes the seat's launch script$/, (ctx) => {
    runLaunchScriptWrite(ctx.root, ctx.windowLine, ctx.role);
    ctx.launchScriptPath = path.join(ctx.root, '.swarmforge', 'launch', `${ctx.role}.sh`);
    assert.ok(fs.existsSync(ctx.launchScriptPath), `expected a launch script at ${ctx.launchScriptPath}`);
    ctx.launchScript = fs.readFileSync(ctx.launchScriptPath, 'utf8');
  });

  scoped(/^the qwen prompt in it contains no "@"$/, (ctx) => {
    const qwenLine = ctx.launchScript.split('\n').find((line) => line.includes('qwen --auth-type'));
    assert.ok(qwenLine, `expected a qwen launch line in:\n${ctx.launchScript}`);
    assert.ok(!qwenLine.includes('@'), `expected no "@" in the qwen launch line: ${qwenLine}`);
  });

  scoped(/^the card path it names holds the seat's composed coder card$/, (ctx) => {
    // The role's own "@" mapped to "-", per role_prompt_card_path.
    const cardPath = path.join(ctx.root, '.swarmforge', 'prompts', `${ctx.role.replace(/@/g, '-')}.md`);
    assert.ok(
      ctx.launchScript.includes(cardPath),
      `expected the launch script to name ${cardPath}:\n${ctx.launchScript}`
    );
    assert.ok(fs.existsSync(cardPath), `expected a composed card at ${cardPath}`);
    // The card's own CONTENT is prompt_engine_lib.bb's tested domain (BL-546
    // et al) - this ticket is about WHERE the seat's launch prompt points,
    // so a non-empty file at the resolved path is what proves the card is
    // really there, not a hand-picked substring of local-compact's own text.
    const card = fs.readFileSync(cardPath, 'utf8');
    assert.ok(card.trim().length > 0, `expected a non-empty composed card at ${cardPath}`);
  });

  scoped(/^the qwen prompt in it does not contain "([^"]+)"$/, (ctx, phrase) => {
    const qwenLine = ctx.launchScript.split('\n').find((line) => line.includes('qwen --auth-type'));
    assert.ok(qwenLine, `expected a qwen launch line in:\n${ctx.launchScript}`);
    assert.ok(!qwenLine.includes(phrase), `expected the qwen launch line not to contain "${phrase}": ${qwenLine}`);
  });

  scoped(/^it appends the system prompt file "([^"]+)"$/, (ctx, relPath) => {
    const expected = path.join(ctx.root, relPath);
    assert.ok(
      ctx.launchScript.includes(expected),
      `expected the launch script to append ${expected}:\n${ctx.launchScript}`
    );
  });
}

module.exports = { registerSteps };
