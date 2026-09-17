'use strict';

// BL-1608: step handlers for "the claim path attributes a Work note's
// ticket from its message again". Scenario 01 is a source-text census of
// swarmforge/scripts/ready_for_next_task.bb (BL-1445: a census, not a
// hope) - no reimplementation of the Babashka logic. Scenario 02 drives
// the REAL claim-task-name function through a real `bb -e` subprocess,
// loading the actual script (guarded so its own -main never fires - see
// the script's own `(when (= *file* (System/getProperty "babashka.file")))`
// tail) with a real fixture handoff file on disk.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT_FILE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'ready_for_next_task.bb');

const FEATURE = "BL-1608 The claim path attributes a Work note's ticket from its message again";

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // -- Scenario 01 -----------------------------------------------------------
  scoped(/^the source of swarmforge\/scripts\/ready_for_next_task\.bb is read$/, (ctx) => {
    ctx.bl1608source = fs.readFileSync(SCRIPT_FILE, 'utf8');
  });

  scoped(
    /^the claim predicate and the claim-moment effort apply both resolve the task through the shared attribution$/,
    (ctx) => {
      const difficultyMatch = ctx.bl1608source.match(
        /\(defn-?\s+difficulty-allows-claim\?[\s\S]*?\n\(defn/
      );
      const effortMatch = ctx.bl1608source.match(/\(defn-?\s+apply-effort-for-task![\s\S]*?\n\(defn/);
      assert.ok(difficultyMatch, 'could not locate difficulty-allows-claim?\'s body');
      assert.ok(effortMatch, 'could not locate apply-effort-for-task!\'s body');
      assert.ok(
        difficultyMatch[0].includes('claim-task-name'),
        'difficulty-allows-claim? does not resolve the task through claim-task-name'
      );
      assert.ok(
        effortMatch[0].includes('claim-task-name'),
        'apply-effort-for-task! does not resolve the task through claim-task-name'
      );
    }
  );

  scoped(/^neither of them reads the task header directly for a mutation cost$/, (ctx) => {
    assert.ok(
      !ctx.bl1608source.includes('mutation-cost-for-task (handoff-lib/header-field'),
      'a claim-time reader still passes a bare task-header read to mutation-cost-for-task'
    );
  });

  scoped(/^exactly (\d+) call sites of the shared attribution exist in that file$/, (ctx, count) => {
    const matches = ctx.bl1608source.match(/\(claim-task-name /g) || [];
    assert.equal(
      matches.length,
      Number(count),
      `expected exactly ${count} call site(s) of claim-task-name, found ${matches.length}`
    );
  });

  // -- Scenario 02 (Outline) ---------------------------------------------------
  scoped(/^a handoff file whose headers (.+) and whose message is (.+)$/, (ctx, headersText, messageText) => {
    const taskMatch = headersText.match(/task\s+(\S+)/);
    const headerLine = taskMatch ? `task: ${taskMatch[1]}\n` : '';
    const message = messageText.trim();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1608-claim-task-name-'));
    const file = path.join(dir, 'fixture.handoff');
    fs.writeFileSync(
      file,
      `type: note\nto: coder\npriority: 10\n${headerLine}message: ${message}\n\n${message}\n`
    );
    ctx.bl1608file = file;
  });

  scoped(/^the shared attribution resolves the task for it$/, (ctx) => {
    const script = `
(load-file "${SCRIPT_FILE.replace(/\\/g, '\\\\')}")
(println (or (ready-for-next-task/claim-task-name "${ctx.bl1608file.replace(/\\/g, '\\\\')}") "NIL"))
`;
    const out = execFileSync('bb', ['-e', script], { encoding: 'utf8' });
    ctx.bl1608resolved = out.trim().split('\n').pop();
  });

  scoped(/^it resolves (\S+)$/, (ctx, resolved) => {
    const expected = resolved === 'nothing' ? 'NIL' : resolved;
    assert.equal(ctx.bl1608resolved, expected);
  });
}

module.exports = { registerSteps };
