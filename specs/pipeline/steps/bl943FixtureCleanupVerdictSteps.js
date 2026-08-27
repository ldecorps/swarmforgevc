'use strict';

// BL-943: step handlers for "A shell test's verdict comes from its
// assertions, not its fixture cleanup". Drives the six REAL
// swarmforge/scripts/test/test_handoffd_*.sh scripts unmodified - never a
// reimplementation of their scenarios. A cleanup failure is injected via an
// env-seam stub `rm` prepended to PATH (never chmod, which engineering.prompt
// bans outright for failure simulation) - the same idiom these fixtures
// already use for a fake tmux.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

const FEATURE = "A shell test's verdict comes from its assertions, not its fixture cleanup";

const KNOWN_SCRIPTS = [
  'test_handoffd_aged_note_rotate_wiring.sh',
  'test_handoffd_ambulance_wiring.sh',
  'test_handoffd_rule_proposal_rotate_wiring.sh',
  'test_handoffd_wake_attribution_wiring.sh',
  'test_handoffd_priority_rotate_wiring.sh',
  'test_handoffd_starve_rotate_wiring.sh',
];

function knownScript(name) {
  if (!KNOWN_SCRIPTS.includes(name)) {
    throw new Error(`unknown <script> token: ${name}`);
  }
  return name;
}

let trackedRoots = [];
let trackedFiles = [];
afterEach(() => {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
  while (trackedFiles.length) {
    fs.rmSync(trackedFiles.pop(), { force: true });
  }
});

function mkTmp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedRoots.push(root);
  return root;
}

// Builds a stub `rm` reached purely through PATH (the scripts call `rm` as
// a bare command). failCalls is either '*' (fail every invocation) or a
// comma-joined list of 1-indexed call numbers to fail (e.g. '1' - fail only
// the first cleanup this run performs, leaving every later one to succeed
// for real). Falls through to the real /bin/rm otherwise, so scenarios that
// never target this stub's failure condition still actually remove their
// fixture roots.
function buildStubRmBin(stubRoot, failCalls) {
  const binDir = path.join(stubRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const counterFile = path.join(stubRoot, 'rm-call-count');
  fs.writeFileSync(counterFile, '0');
  const script = `#!/usr/bin/env bash
count_file="${counterFile}"
n=$(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$count_file"
fail_calls="${failCalls}"
if [[ "$fail_calls" == "*" ]]; then
  exit 1
fi
IFS=',' read -ra targets <<< "$fail_calls"
for t in "\${targets[@]}"; do
  if [[ "$n" == "$t" ]]; then
    exit 1
  fi
done
exec /bin/rm "$@"
`;
  const rmPath = path.join(binDir, 'rm');
  fs.writeFileSync(rmPath, script);
  fs.chmodSync(rmPath, 0o755);
  return binDir;
}

function runScript(scriptPath, { stubBinDir } = {}) {
  const env = { ...process.env };
  if (stubBinDir) env.PATH = `${stubBinDir}:${env.PATH}`;
  // spawnSync (not execFileSync): execFileSync only returns stdout on the
  // SUCCESS path (stderr is silently discarded unless the process throws),
  // which made scenario 03's stderr assertion see an empty string on a
  // passing (exit 0) run even though the script's own WARN line was really
  // there - spawnSync always captures both streams regardless of exit code.
  const result = spawnSync('bash', [scriptPath], { encoding: 'utf8', env });
  return { exitCode: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a fixture-cleanup failure can be injected without altering filesystem permission bits$/,
    (ctx) => {
      ctx.stubRoot = mkTmp('sfvc-bl943-');
      // Nothing built yet - the specific fail-calls pattern is chosen by
      // the scenario's own Given steps below (built vs. non-chmod is the
      // structural guarantee: buildStubRmBin never touches a mode bit).
    },
    FEATURE
  );

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^the daemon-fixture wiring test "([^"]+)"$/,
    (ctx, script) => {
      ctx.script = knownScript(script);
    },
    FEATURE
  );

  registry.defineScoped(
    /^every assertion in it passes$/,
    (ctx) => {
      ctx.forceAssertionFailure = false;
    },
    FEATURE
  );

  registry.defineScoped(
    /^its fixture cleanup is forced to fail$/,
    (ctx) => {
      ctx.stubBinDir = buildStubRmBin(ctx.stubRoot, '*');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the test is run$/,
    (ctx) => {
      const scriptPath = ctx.brokenScriptPath || path.join(TEST_SCRIPTS_DIR, ctx.script);
      ctx.result = runScript(scriptPath, { stubBinDir: ctx.stubBinDir });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the run exits zero$/,
    (ctx) => {
      assert.equal(ctx.result.exitCode, 0, `expected exit 0, got ${ctx.result.exitCode}. stdout:\n${ctx.result.stdout}\nstderr:\n${ctx.result.stderr}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the run prints its final all-scenarios-passed line$/,
    (ctx) => {
      assert.ok(
        /ALL PASS/.test(ctx.result.stdout),
        `expected a final ALL PASS line, got stdout:\n${ctx.result.stdout}`
      );
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the fixture cleanup of its first scenario is forced to fail$/,
    (ctx) => {
      // Each scenario's cleanup calls `rm` exactly once, in scenario
      // order - failing call #1 targets precisely the first scenario's
      // cleanup, whichever fixture root it happens to be (never predicted
      // ahead of time, since mktemp -d picks it at run time).
      ctx.stubBinDir = buildStubRmBin(ctx.stubRoot, '1');
    },
    FEATURE
  );

  registry.defineScoped(
    /^every one of its scenarios prints a passed line$/,
    (ctx) => {
      const passLines = (ctx.result.stdout.match(/^PASS:/gm) || []).length;
      assert.ok(
        passLines >= 4,
        `expected at least 4 scenario PASS: lines (starve_rotate has scenarios A-D), got ${passLines}. stdout:\n${ctx.result.stdout}`
      );
      assert.ok(/ALL PASS/.test(ctx.result.stdout), `expected the run to reach its end, got stdout:\n${ctx.result.stdout}`);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^a warning naming the surviving fixture root is written to standard error$/,
    (ctx) => {
      assert.match(ctx.result.stderr, /WARN: cleanup could not remove fixture root: \S+/, `expected a WARN line on stderr, got:\n${ctx.result.stderr}`);
    },
    FEATURE
  );

  // ── Scenario 04 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^one of its assertions is forced to fail$/,
    (ctx) => {
      ctx.forceAssertionFailure = true;
      // BL-943 test-only injection, distinct from the production seam: a
      // literal copy of the real script, with an unconditional fail() call
      // spliced in right after its FIRST `trap cleanup_a EXIT` (so a real
      // fixture root exists and the EXIT trap is already armed - the exact
      // "genuine failure + cleanup also forced to fail" shape, not a
      // failure before any fixture/trap exists), is written ALONGSIDE the
      // real scripts (so its own `$SCRIPT_DIR/../handoffd.bb` relative
      // lookup still resolves) and run instead of the real file - proving
      // the fix does not swallow a genuine failure, without touching the
      // real script's own content. Removed in afterEach either way.
      const original = fs.readFileSync(path.join(TEST_SCRIPTS_DIR, ctx.script), 'utf8');
      const broken = original.replace(
        /^trap cleanup_a EXIT$/m,
        'trap cleanup_a EXIT\nfail "BL-943 injected assertion failure"'
      );
      assert.notEqual(broken, original, 'expected to find the first `trap cleanup_a EXIT` line to inject after');
      const brokenPath = path.join(TEST_SCRIPTS_DIR, 'bl943-injected-failure-scratch.sh');
      fs.writeFileSync(brokenPath, broken);
      fs.chmodSync(brokenPath, 0o755);
      trackedFiles.push(brokenPath);
      ctx.brokenScriptPath = brokenPath;
    },
    FEATURE
  );

  registry.defineScoped(
    /^the run exits non-zero$/,
    (ctx) => {
      assert.notEqual(ctx.result.exitCode, 0, `expected a non-zero exit, got 0. stdout:\n${ctx.result.stdout}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the run prints a failed line naming the assertion$/,
    (ctx) => {
      assert.match(ctx.result.stderr, /FAIL: BL-943 injected assertion failure/, `expected the injected FAIL: line on stderr, got:\n${ctx.result.stderr}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
