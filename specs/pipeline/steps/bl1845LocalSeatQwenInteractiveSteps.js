'use strict';

// BL-1845: step handlers for "A local-model seat's qwen runs interactive,
// so its pane shows its work and takes typed input". Drives the REAL
// write_role_launch_script from swarmforge.sh over a real mkdtemp fixture,
// the same technique bl1052LocalModelSeatSteps.js's composeLaunchScript and
// bl1837LocalSeatCardPathSteps.js already use - never a reimplementation
// of the launch-body text, which lives only in swarmforge.sh.
//
// Stamp-off ticket (hotfix c885d0c071 already landed the one launch line,
// `-i` before the kickoff): this handler reviews what is already there, it
// never re-applies the fix.
//
// BL-425/stepRegistry.js: every pattern here is registered SCOPED to this
// feature's own text (registry.defineScoped(..., FEATURE)) - BL-1837's
// handler builds the same launch script but is scoped to its own, distinct
// feature text, so the two never collide as an unscoped pair would.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');

const FEATURE = "BL-1845 A local-model seat's qwen runs interactive, so its pane shows its work and takes typed input";

// window <role> <agent> <worktree-name> --model <model>
function parseWindowLine(windowLine) {
  const parts = windowLine.trim().split(/\s+/);
  if (parts[0] !== 'window') {
    throw new Error(`bl1845: expected a line starting with "window", got: ${windowLine}`);
  }
  return { role: parts[1], agent: parts[2] };
}

function mkFixtureRoot() {
  const root = mkProcessTmpDir('bl1845-qwen-interactive-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  for (const role of ['specifier', 'coder', 'documenter']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  return root;
}

function generateLaunchScript(root, windowLine, role) {
  const stage = role.split('@')[0];
  // BL-982: a stage's additional seat (role@variant) requires the bare
  // stage-named seat to exist too - parcels address the stage, never the
  // variant.
  const confLines = ['config active_backlog_max_depth -1'];
  if (role !== stage) {
    confLines.push(`window ${stage} claude ${stage} --model claude-sonnet-5`);
  }
  confLines.push(windowLine);
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), confLines.join('\n') + '\n');

  const indexOfRoleSnippet = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;
  execFileSync(
    'zsh',
    [
      '-c',
      `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${indexOfRoleSnippet} ` +
        `write_role_launch_script "$(index_of_role '${role}')"`,
    ],
    { encoding: 'utf8', env: { ...process.env, SWARMFORGE_LOCAL_MODEL_ENDPOINT_STATUS: 'healthy', PACK_STAFFING_SKIP_GATE: '1' } }
  );
  return fs.readFileSync(path.join(root, '.swarmforge', 'launch', `${role}.sh`), 'utf8');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the pack staffs "([^"]+)"$/, (ctx, windowLine) => {
    ctx.windowLine = windowLine;
    const { role } = parseWindowLine(windowLine);
    ctx.role = role;
    ctx.root = mkFixtureRoot();
  });

  scoped(/^the seat's launch script is generated$/, (ctx) => {
    ctx.launchScript = generateLaunchScript(ctx.root, ctx.windowLine, ctx.role);
    ctx.qwenLine = ctx.launchScript.split('\n').find((line) => line.includes('qwen --auth-type'));
    assert.ok(ctx.qwenLine, `expected a qwen launch line in:\n${ctx.launchScript}`);
  });

  scoped(/^qwen's interactive prompt option carries the kickoff prompt$/, (ctx) => {
    // -i's value is the next shell token: a double-quoted string (the
    // kickoff, which itself contains single-quoted substrings for the
    // prompt-file path - a bare `includes('-i')` text search would also
    // match "--auth-type" or any other flag containing "i", so this reads
    // the actual token immediately after a standalone `-i`.
    const m = /(?:^|\s)-i\s+"((?:[^"\\]|\\.)*)"/.exec(ctx.qwenLine);
    assert.ok(m, `expected a standalone -i followed by a double-quoted kickoff in: ${ctx.qwenLine}`);
    ctx.kickoff = m[1];
  });

  scoped(/^that kickoff names a file under "([^"]+)" and "([^"]+)"$/, (ctx, promptsDir, readyScript) => {
    assert.ok(ctx.kickoff.includes(promptsDir), `expected the kickoff to name a file under "${promptsDir}": ${ctx.kickoff}`);
    assert.ok(ctx.kickoff.includes(readyScript), `expected the kickoff to mention "${readyScript}": ${ctx.kickoff}`);
  });

  scoped(/^no prompt reaches qwen through "([^"]+)", "([^"]+)" or a bare argument$/, (ctx, shortFlag, longFlag) => {
    // "a bare argument" = qwen's trailing token is NOT a standalone quoted
    // string with no preceding -i (the pre-hotfix shape); -i's own
    // presence (asserted by scenario 01) already proves this is not a
    // bare-argument invocation, so this scenario independently checks the
    // two flag spellings qwen also treats as one-shot.
    const flagPattern = new RegExp(`(?:^|\\s)${shortFlag.replace(/^-/, '-')}(?:\\s|$)`);
    assert.ok(!flagPattern.test(ctx.qwenLine), `expected no "${shortFlag}" flag in: ${ctx.qwenLine}`);
    assert.ok(!ctx.qwenLine.includes(longFlag), `expected no "${longFlag}" flag in: ${ctx.qwenLine}`);
    assert.ok(/(?:^|\s)-i(?:\s|$)/.test(ctx.qwenLine), `expected -i (interactive) present, never a bare-argument invocation: ${ctx.qwenLine}`);
  });
}

module.exports = { registerSteps };
