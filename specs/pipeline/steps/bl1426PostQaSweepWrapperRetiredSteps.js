'use strict';

// BL-1426: step handlers for "The never-parsed post-QA sweep wrapper is
// retired". Every scenario reads the parcel's own tracked tree - a
// read-only live-tree read, never a fixture, since the tree at this commit
// IS the contract (the feature's own framing).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HOWTO = path.join(REPO_ROOT, 'docs', 'how-to', 'BL-668-post-qa-deterministic-branch-sweep.md');

const FEATURE = 'BL-1426 The never-parsed post-QA sweep wrapper is retired';

// A pure READER pass, never a load: reads every top-level form in order and
// evaluates NOTHING, so an entry call (e.g. post_qa_branch_sweep.bb's own
// trailing invocation, were it still there) never runs - that's BL-1427's
// business, not this ticket's (see the ticket's own "How" direction).
// Mirrors bb_load_analyse_driver.bb's strip-shebang convention (present on
// most direct scripts, absent on library .bb files) so the reader never
// has to special-case either shape.
const READER_SCRIPT = `
(require '[clojure.string :as str])
(defn strip-shebang [text]
  (if (str/starts-with? text "#!")
    (let [nl (.indexOf text "\\n")] (if (neg? nl) "" (subs text (inc nl))))
    text))
(let [target (System/getenv "BL1426_READER_TARGET")
      text (strip-shebang (slurp target))]
  (with-open [rdr (clojure.lang.LineNumberingPushbackReader. (java.io.StringReader. text))]
    (loop []
      (let [form (read {:eof ::eof} rdr)]
        (when-not (identical? form ::eof)
          (recur))))))
`;

function readFormByForm(absPath) {
  const result = spawnSync('bb', ['-e', READER_SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, BL1426_READER_TARGET: absPath },
    timeout: 20000,
  });
  return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}` };
}

// Fenced code blocks only (```...```), never a prose mention - the
// retirement sentence in the how-to legitimately names the file (scenario
// 03's own comment in the feature file).
function fencedBlocks(text) {
  const blocks = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the tree is inspected for the manual sweep entry points$/, (ctx) => {
    ctx.wrapperExists = fs.existsSync(path.join(SCRIPTS_DIR, 'post_qa_branch_sweep.bb'));
    ctx.shimExists = fs.existsSync(path.join(SCRIPTS_DIR, 'post_qa_branch_sweep.sh'));
  });

  scoped(/^neither post_qa_branch_sweep\.bb nor post_qa_branch_sweep\.sh exists under swarmforge\/scripts$/, (ctx) => {
    assert.equal(ctx.wrapperExists, false, 'post_qa_branch_sweep.bb still exists under swarmforge/scripts');
    assert.equal(ctx.shimExists, false, 'post_qa_branch_sweep.sh still exists under swarmforge/scripts');
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^every \.bb file directly under swarmforge\/scripts is read form by form$/, (ctx) => {
    const files = fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.bb'));
    assert.ok(files.length > 0, 'expected at least one .bb file directly under swarmforge/scripts');
    ctx.readFailures = [];
    for (const entry of files) {
      const abs = path.join(SCRIPTS_DIR, entry.name);
      const { ok, output } = readFormByForm(abs);
      if (!ok) {
        ctx.readFailures.push({ file: entry.name, output });
      }
    }
  });

  scoped(/^none of them fails to read$/, (ctx) => {
    assert.deepEqual(ctx.readFailures, [], `expected every .bb to read cleanly, got failures: ${JSON.stringify(ctx.readFailures, null, 2)}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the post-QA branch sweep how-to is read$/, (ctx) => {
    ctx.howtoText = fs.readFileSync(HOWTO, 'utf8');
  });

  scoped(/^it contains no fenced command that invokes the sweep by hand$/, (ctx) => {
    const offending = fencedBlocks(ctx.howtoText).filter(
      (block) => block.includes('post_qa_branch_sweep.bb') || block.includes('post_qa_branch_sweep.sh')
    );
    assert.deepEqual(offending, [], `expected no fenced block invoking the sweep by hand, got: ${JSON.stringify(offending)}`);
  });
}

module.exports = { registerSteps };
