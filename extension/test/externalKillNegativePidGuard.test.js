const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

// Hotfix 2026-10-06 (the 19:38Z and 20:32:56Z whole-swarm deaths).
//
// procps-ng 4.0.4's /usr/bin/kill (this host's) has a special case for a
// negative pid that follows a signal option: getopt reads `-21312` as the
// unknown option `-2`, and kill.c computes `pid = '0' - optopt`, i.e. the
// NEGATED FIRST DIGIT, then calls kill() on that and exits with the success
// check inverted. So `kill -INT -21312` signals process group 2, and
// `kill -INT -1xxxx` is kill(-1, SIGINT): every process the user owns, the
// live tmux server and every seat with it. Measured with signal 0, which
// delivers nothing: `/usr/bin/kill -0 -1999999` exits 1 with no "No such
// process" line (kill(-1, 0) succeeded), and `/usr/bin/kill -0 -- -1999999`
// prints "No such process". bash's and dash's builtin kill are correct;
// only an exec of the external binary is exposed - babashka's
// (process/sh "kill" ...), node's spawn/execFile('kill', ...), and a shell's
// `exec kill`, `env kill`, `xargs kill`, `/usr/bin/kill`.
//
// bl965_wrapper_cleanup_property_runner.bb ran
// (process/sh "kill" (str "-" sig) (str "-" pid)) and was the runner that
// had just started at both deaths; it survived its 20:00Z re-run only
// because that draw's pids did not start with a 1. The `--` ends option
// parsing, so the negative pid is read as a pid. This guard fails any exec
// of the external kill that passes two or more dash-led arguments (a signal
// and a negative pid) without a `--` among them. It runs in the unit lane
// because that is the lane every parcel's QA gather runs.

const SCAN_DIRS = [
  ['swarmforge', 'scripts'],
  ['specs', 'pipeline'],
  ['extension', 'src'],
  ['extension', 'scripts'],
  ['extension', 'test'],
];
const SKIP_DIRS = new Set(['node_modules', 'out', '.git', 'vendor']);
const SOURCE_EXT = new Set(['.bb', '.clj', '.js', '.mjs', '.cjs', '.ts']);
const SHELL_EXT = new Set(['.sh', '.bash']);
const SELF = path.resolve(__filename);

// The program name as a quoted literal: the shape every exec in the code
// languages takes ((process/sh "kill" ...), spawnSync('kill', ...)).
const CODE_KILL_EXEC = /["'`](?:\/usr)?(?:\/bin\/)?kill["'`]/;
// In a shell script the bare word `kill` is the safe builtin; these forms
// reach the external binary instead.
const SHELL_KILL_EXEC = /(?:\/usr)?\/bin\/kill\b|\b(?:exec|env|xargs|nohup|setsid|timeout)\b[^|;&#]*?\bkill\b/;

// A shell command ends at ; | & - the next command's dashes are not kill's.
function regionAfter(line, index, isShell) {
  const rest = line.slice(index);
  return isShell ? rest.split(/[;|&]/)[0] : rest;
}

function tokensOf(region) {
  return region
    .split(/[\s,()[\]{}]+/)
    .map((t) => t.replace(/^["'`]+|["'`;]+$/g, ''))
    .filter((t) => t.length > 0);
}

// Returns { dashed, guarded } for the kill exec on this line, or null when
// the line execs no external kill. `dashed` counts dash-led arguments after
// the program name (a signal option, a negative pid); `--` is counted as the
// guard, not as a dashed argument.
function classifyKillExec(line, isShell) {
  const m = (isShell ? SHELL_KILL_EXEC : CODE_KILL_EXEC).exec(line);
  if (!m) return null;
  const killAt = line.indexOf('kill', m.index) + 'kill'.length;
  const region = regionAfter(line, killAt, isShell);
  let dashed = 0;
  // A quoted "--" counts wherever it sits (a regex literal quoting the
  // guarded idiom, as bl1103's step does, is not an exec to flag).
  let guarded = /["'`]--["'`]/.test(region);
  for (const t of tokensOf(region)) {
    if (t === '--') guarded = true;
    else if (t.startsWith('-')) dashed += 1;
  }
  return { dashed, guarded };
}

function findExternalKillViolations(file, text) {
  const isShell = SHELL_EXT.has(path.extname(file));
  const out = [];
  text.split('\n').forEach((line, i) => {
    const site = classifyKillExec(line, isShell);
    if (site && site.dashed >= 2 && !site.guarded) {
      out.push({ file, line: i + 1, text: line.trim() });
    }
  });
  return out;
}

function walk(dir, visit) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, visit);
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if ((SOURCE_EXT.has(ext) || SHELL_EXT.has(ext)) && path.resolve(p) !== SELF) visit(p);
    }
  }
}

function scanKillExecSites(root) {
  const sites = [];
  const violations = [];
  walk(root, (file) => {
    const text = fs.readFileSync(file, 'utf8');
    const isShell = SHELL_EXT.has(path.extname(file));
    text.split('\n').forEach((line, i) => {
      const site = classifyKillExec(line, isShell);
      if (site) sites.push({ file, line: i + 1, ...site });
    });
    violations.push(...findExternalKillViolations(file, text));
  });
  return { sites, violations };
}

const repoRoot = path.join(__dirname, '..', '..');

// ── pure classifier ───────────────────────────────────────────────────────

test('flags a babashka kill exec of a signal and a negative pid with no --', () => {
  const line = '(process/sh "kill" (str "-" sig) (str "-" (.pid (:proc proc))))';
  assert.equal(findExternalKillViolations('x.bb', line).length, 1);
});

test('passes the same babashka exec once -- precedes the negative pid', () => {
  const line = '(process/sh "kill" (str "-" sig) "--" (str "-" (.pid (:proc proc))))';
  assert.deepEqual(findExternalKillViolations('x.bb', line), []);
});

test('flags a node exec of a literal signal and a template negative pid', () => {
  const line = "execFileSync('kill', ['-TERM', `-${pgid}`]);";
  assert.equal(findExternalKillViolations('x.js', line).length, 1);
});

test('flags a node exec that builds the negative pid by concatenation', () => {
  const line = "spawnSync('kill', ['-9', '-' + pgid]);";
  assert.equal(findExternalKillViolations('x.js', line).length, 1);
});

test('passes a signal with a positive pid, and a liveness probe', () => {
  assert.deepEqual(findExternalKillViolations('x.js', "spawnSync('kill', ['-9', pid]);"), []);
  assert.deepEqual(findExternalKillViolations('x.bb', '(process/sh "kill" "-0" (str pid))'), []);
});

test('in a shell script the builtin kill passes, while exec kill with a negative pid is flagged', () => {
  assert.deepEqual(findExternalKillViolations('x.sh', 'kill -TERM -"$pgid" 2>/dev/null'), []);
  assert.equal(findExternalKillViolations('x.sh', 'exec kill -TERM -"$pgid"').length, 1);
  assert.equal(findExternalKillViolations('x.sh', '/usr/bin/kill -INT -$pg').length, 1);
  assert.deepEqual(findExternalKillViolations('x.sh', '/usr/bin/kill -INT -- -$pg'), []);
  assert.deepEqual(findExternalKillViolations('x.sh', "jobs -p | xargs -r kill -9 2>/dev/null || true; rm -rf \"$ROOT\""), []);
});

test('a regex literal that quotes the guarded idiom is not flagged', () => {
  assert.deepEqual(findExternalKillViolations('x.js', '/"kill" "-KILL" "--"/.test(chokepoint),'), []);
});

// ── break-then-fix over real files ────────────────────────────────────────

test('the directory walk flags a planted offender, then passes once it carries --', () => {
  const root = mkTmpDir('sfvc-external-kill-guard-');
  const offender = path.join(root, 'nested', 'runner.bb');
  fs.mkdirSync(path.dirname(offender));
  fs.writeFileSync(offender, '(process/sh "kill" (str "-" sig) (str "-" pid))\n');
  assert.equal(scanKillExecSites(root).violations.length, 1);
  fs.writeFileSync(offender, '(process/sh "kill" (str "-" sig) "--" (str "-" pid))\n');
  assert.deepEqual(scanKillExecSites(root).violations, []);
});

// ── the real tree ─────────────────────────────────────────────────────────

const real = { sites: [], violations: [] };
for (const parts of SCAN_DIRS) {
  const { sites, violations } = scanKillExecSites(path.join(repoRoot, ...parts));
  real.sites.push(...sites);
  real.violations.push(...violations);
}

test('no external kill exec in the tree passes a negative pid without --', () => {
  assert.deepEqual(
    real.violations,
    [],
    `external kill with a negative pid and no -- (procps reads -<pid> as kill(-<first digit>); -1xxxx is every process):\n${real.violations
      .map((v) => `${path.relative(repoRoot, v.file)}:${v.line}: ${v.text}`)
      .join('\n')}`
  );
});

// Census pin (BL-1445): the scan must SEE the codebase's real group-kill
// idiom, or the zero above means nothing. Counted on 2026-10-06 with
//   grep -rnE '"kill" .*"--" \(str "-"' swarmforge/scripts
// -> handoffd_supervisor.bb x3, daemon_cycle_guard_lib.bb x1 (check_worktree_strays.bb
// passes no signal, so it has one dashed argument and is not counted here).
test('census: the scan finds the guarded group kills in handoffd_supervisor.bb and daemon_cycle_guard_lib.bb', () => {
  const guardedGroupKills = real.sites.filter((s) => s.guarded && s.dashed >= 2);
  const names = guardedGroupKills.map((s) => path.basename(s.file));
  assert.equal(names.filter((n) => n === 'handoffd_supervisor.bb').length, 3, names.join(', '));
  assert.ok(names.includes('daemon_cycle_guard_lib.bb'), names.join(', '));
  const nodeSites = real.sites.filter((s) => path.basename(s.file) === 'mergedCodeReachesDaemonsSteps.js');
  assert.equal(nodeSites.length, 2, 'the node spawnSync(\'kill\', ...) idiom must be seen too');
});
