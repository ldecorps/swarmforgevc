'use strict';

// BL-1029: step handlers for "every respawn path's launch argument survives a
// quote-bearing install path".
//
// Scenario 01 constructs the argument through the REAL code path
// (shell_quote_lib.bb's launch-command, which every respawn site now calls)
// and then EVALUATES it in an actual shell, comparing what comes back to what
// went in. Deliberately not a text or substring comparison: this defect
// already survived one property runner behind a `str/includes?` check on the
// raw path, which passes whether the escaping is correct or broken.
//
// Scenarios 02 and 03 enumerate the construction sites from the TREE - never
// a hand-maintained list of files, which is precisely what goes stale the day
// an eighth site is written. The test tree beneath swarmforge/scripts/ is out
// of scope for that enumeration, and it is the only exclusion: a test that
// asserts about the shape has to be able to name the shape.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SHELL_QUOTE_LIB = path.join(SCRIPTS_DIR, 'shell_quote_lib.bb');

const FEATURE = "every respawn path's launch argument survives a quote-bearing install path";

const HELPER_FILE = 'shell_quote_lib.bb';
const HELPER_FN = 'launch-command';

// A code line building a shell command string that runs a launch script.
const CONSTRUCTION_RE = /"zsh /;
// The pre-fix shape specifically: a launch path interpolated between bare
// single quotes.
const BARE_QUOTE_RE = /"zsh '"/;

// Every .bb directly under swarmforge/scripts/ - production code. Checked at
// authoring time that no .bb lives anywhere below it except test/.
function productionScripts() {
  return fs
    .readdirSync(SCRIPTS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.bb'))
    .map((e) => e.name)
    .sort();
}

// Prose must never trip a gate that exists to catch calls - this ticket's own
// helper names the pre-fix construction in its header comment.
function codeLines(content) {
  return content.split('\n').filter((l) => !l.trim().startsWith(';'));
}

function enumerateSites() {
  const sites = [];
  for (const name of productionScripts()) {
    const content = fs.readFileSync(path.join(SCRIPTS_DIR, name), 'utf8');
    for (const line of codeLines(content)) {
      if (CONSTRUCTION_RE.test(line)) {
        sites.push({ file: name, line: line.trim(), bareQuoted: BARE_QUOTE_RE.test(line) });
      }
    }
  }
  return sites;
}

// Word-boundary, not substring: a plain `includes` counts a helper that has
// been RENAMED (launch-command-renamed contains launch-command), so the
// routing check would keep reporting green after exactly the change it exists
// to notice. Found while running this ticket's own qa_e2e step 3.
const HELPER_CALL_RE = new RegExp(`${HELPER_FN}(?![\\w-])`);

function filesCallingHelper() {
  return productionScripts().filter((name) =>
    codeLines(fs.readFileSync(path.join(SCRIPTS_DIR, name), 'utf8')).some((l) => HELPER_CALL_RE.test(l))
  );
}

// The real constructor, called through bb - not a JavaScript restatement of
// the quoting rule, which could agree with itself while the shell disagrees.
function launchArgumentFor(launchPath) {
  const result = spawnSync(
    'bb',
    [
      '-e',
      `(load-file "${SHELL_QUOTE_LIB}") (print (shell-quote-lib/launch-command (first *command-line-args*)))`,
      launchPath,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, `could not construct the launch argument: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

// Evaluates the argument the way tmux does - hands the whole string to a
// shell. `printf %s` rather than `echo` so nothing in the path is
// interpreted on the way back out.
function evaluateInRealShell(argument) {
  const result = spawnSync('sh', ['-c', `printf '%s' ${argument}`], { encoding: 'utf8' });
  return { status: result.status, recovered: result.stdout };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── scenario 01 ─────────────────────────────────────────────────────────

  scoped(/^a persisted launch script at path (.+)$/, (ctx, launchPath) => {
    assert.ok(fs.existsSync(SHELL_QUOTE_LIB), `the shared helper is missing: ${SHELL_QUOTE_LIB}`);
    ctx.launchPath = launchPath;
  });

  scoped(/^a respawn command's launch argument is constructed for it$/, (ctx) => {
    assert.ok(ctx.launchPath, 'no launch path was established');
    ctx.command = launchArgumentFor(ctx.launchPath);
    assert.ok(
      ctx.command.startsWith('zsh '),
      `the respawn command does not run zsh: ${JSON.stringify(ctx.command)}`
    );
    // The argument tmux hands the shell, minus the `zsh` verb.
    ctx.argument = ctx.command.slice(4);
  });

  scoped(/^evaluating that argument in a real shell recovers exactly (.+)$/, (ctx, expected) => {
    assert.equal(expected, ctx.launchPath, 'the row asserts a different path from the one it set up');
    const { status, recovered } = evaluateInRealShell(ctx.argument);
    assert.equal(
      status,
      0,
      `the argument is not valid shell (exit ${status}): ${JSON.stringify(ctx.argument)}`
    );
    assert.equal(
      recovered,
      expected,
      `the shell recovered ${JSON.stringify(recovered)}, not the path it was given`
    );
  });

  // ── scenarios 02 and 03 ────────────────────────────────────────────────

  scoped(/^the swarm scripts tree$/, (ctx) => {
    assert.ok(fs.existsSync(SCRIPTS_DIR), `the scripts tree is missing: ${SCRIPTS_DIR}`);
    ctx.scriptsPresent = productionScripts();
    assert.ok(ctx.scriptsPresent.length > 10, 'the scripts tree looks empty - the enumeration would be vacuous');
  });

  scoped(/^every respawn launch-argument construction is enumerated from that tree$/, (ctx) => {
    assert.ok(ctx.scriptsPresent, 'the scripts tree was never established');
    ctx.sites = enumerateSites();
    ctx.routedFiles = filesCallingHelper();
  });

  scoped(/^each one is produced by the shared quoting helper$/, (ctx) => {
    for (const site of ctx.sites) {
      assert.equal(
        site.file,
        HELPER_FILE,
        `${site.file} builds a launch command outside the shared helper: ${site.line}`
      );
    }
    // The other half of the same rule: the helper is not merely the only
    // place that BUILDS one, it is the place the sites reach.
    assert.ok(
      ctx.routedFiles.length > 1,
      `only ${ctx.routedFiles.length} file(s) reach ${HELPER_FN} - the sites are not routed through it`
    );
  });

  scoped(/^none interpolates a launch path directly into a quoted shell string$/, (ctx) => {
    const offenders = ctx.sites.filter((s) => s.bareQuoted);
    assert.deepEqual(
      offenders.map((s) => `${s.file}: ${s.line}`),
      [],
      'a launch path is still interpolated into a bare-quoted shell string'
    );
  });

  scoped(/^at least one construction site is found$/, (ctx) => {
    assert.ok(
      ctx.sites.length > 0,
      'the enumeration found no construction site at all - it is not looking at the tree, so scenario 02 proves nothing'
    );
  });
}

module.exports = { registerSteps };
