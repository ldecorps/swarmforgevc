'use strict';

// BL-730: step handlers for "Pipeline teardown reports survivors from its
// own root only". Drives the REAL pipeline_survivor_scan_lib.sh (sourced by
// kill_pipeline_swarm.sh) via a real bash subprocess against a fixture
// SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE ps snapshot — never a reimplementation
// of the scan in JS. Scenario 03 (self-match) has the subprocess embed its
// OWN real pid into the fixture with argv genuinely mentioning "handoffd.bb",
// so the self-exclusion guard is exercised against a real running process,
// not a simulated one.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pipeline_survivor_scan_lib.sh');

const FEATURE_NAME = 'Pipeline teardown reports survivors from its own root only';

// engineering.prompt Scenario Outline rule: every Examples: column value is
// validated against an explicit KNOWN_VALUES lookup, never a bare passthrough.
const KNOWN_NAMED = { yes: true, no: false };
const KNOWN_STATUS = { zero: 0, 'non-zero': 'nonzero' };

function knownNamed(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_NAMED, value)) {
    throw new Error(`pipeline-teardown-survivor-scope: unrecognized <named> example value "${value}"`);
  }
  return KNOWN_NAMED[value];
}

function knownStatus(value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_STATUS, value)) {
    throw new Error(`pipeline-teardown-survivor-scope: unrecognized <status> example value "${value}"`);
  }
  return KNOWN_STATUS[value];
}

function mkFixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl730-acceptance-'));
}

// Runs `pipeline_survivor_scan "$root"` for the given fixture ps lines
// (pid + argv pairs). When selfMentionsHandoffd is set, the subprocess adds
// a line for its OWN $$ with argv genuinely mentioning "handoffd.bb" instead
// of any Node-side simulation.
function runScan(root, processes, selfMentionsHandoffd) {
  const dir = mkFixtureDir();
  const psFile = path.join(dir, 'ps.txt');
  const script = `
set -euo pipefail
source "${LIB}"
{
  echo "  1 init"
  ${processes.map((p) => `echo "${p.pid} ${p.argv}"`).join('\n  ')}
  ${selfMentionsHandoffd ? 'echo "$$ bash acceptance-runner handoffd.bb"' : ''}
} > "${psFile}"
export SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE="${psFile}"
if pipeline_survivor_scan "${root}"; then
  ec=1
else
  ec=0
fi
echo "EXIT_CODE:$ec"
echo "LINES_START"
printf '%s\\n' "$pipeline_survivor_lines"
echo "LINES_END"
`;
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  if (res.status !== 0 && res.stderr) {
    throw new Error(`runScan subprocess errored: ${res.stderr}`);
  }
  const stdout = res.stdout || '';
  const exitMatch = /EXIT_CODE:(\d+)/.exec(stdout);
  const linesMatch = /LINES_START\n([\s\S]*?)LINES_END/.exec(stdout);
  return {
    exitCode: exitMatch ? Number(exitMatch[1]) : null,
    lines: linesMatch ? linesMatch[1] : '',
  };
}

function registerSteps(registry) {
  registry.defineScoped(
    /^a pipeline teardown of the root "([^"]+)"$/,
    (ctx, root) => {
      ctx.root = root;
      ctx.processes = [];
      ctx.nextPid = 30000;
      ctx.selfMentionsHandoffd = false;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a running process "([^"]+)"$/,
    (ctx, argv) => {
      const pid = ctx.nextPid++;
      ctx.processes.push({ pid, argv });
      ctx.lastPid = pid;
    },
    FEATURE_NAME
  );

  registry.defineScoped(/^no running process belongs to the root being torn down$/, () => {}, FEATURE_NAME);

  registry.defineScoped(
    /^the scanning shell's own command line mentions "handoffd\.bb"$/,
    (ctx) => {
      ctx.selfMentionsHandoffd = true;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the teardown checks for survivors$/,
    (ctx) => {
      const result = runScan(ctx.root, ctx.processes, ctx.selfMentionsHandoffd);
      ctx.exitCode = result.exitCode;
      ctx.lines = result.lines;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the survivor report names that process: "([^"]+)"$/,
    (ctx, namedExample) => {
      const expected = knownNamed(namedExample);
      const named = ctx.lines.includes(`${ctx.lastPid} `);
      if (named !== expected) {
        throw new Error(
          `expected survivor report to ${expected ? '' : 'NOT '}name pid ${ctx.lastPid}, ` +
            `got lines: ${JSON.stringify(ctx.lines)}`
        );
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the teardown exit status is "([^"]+)"$/,
    (ctx, statusExample) => {
      const expected = knownStatus(statusExample);
      if (expected === 0) {
        if (ctx.exitCode !== 0) {
          throw new Error(`expected zero exit status, got ${ctx.exitCode}`);
        }
      } else if (ctx.exitCode === 0) {
        throw new Error(`expected a non-zero exit status, got 0`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the survivor report is empty$/,
    (ctx) => {
      if (ctx.lines.trim().length !== 0) {
        throw new Error(`expected an empty survivor report, got: ${JSON.stringify(ctx.lines)}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
