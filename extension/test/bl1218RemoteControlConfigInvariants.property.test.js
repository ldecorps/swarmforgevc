const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

// BL-1218 declared invariants:
// 1. A seat launched under config remote_control off carries no
//    remote-control flag, whatever its window line says.
// 2. A persisted launch script never disagrees with the config that was
//    effective when it was written.
// 3. With config on or absent, launch composition is byte-for-byte what it
//    is today.
//
// Invariants 1 and 3 are properties of the pure decision
// (remote_control_launch_lib.sh) and run against it directly. Invariant 2
// is a property of what actually lands on disk, so it drives the REAL
// swarmforge.sh write_role_launch_script under zsh.
//
// Runs ONLY via `npm run test:properties`.

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS, 'remote_control_launch_lib.sh');
const SWARMFORGE_SH = path.join(SCRIPTS, 'swarmforge.sh');
const SESSION = 'SwarmForge-Coder';
const FLAG = '--remote-control';

// A window line's flags, as the real packs write them.
const OTHER_FLAGS = () =>
  fc.subarray(
    ['--model claude-sonnet-5', '--dangerously-skip-permissions', '--effort medium'],
    { minLength: 0 }
  );

// BL-1587: extracted so a fixed placement can be composed BY CONSTRUCTION
// (an outer loop over the placements) while the flags themselves stay
// randomized - the same composition the old combined WINDOW_CLI() generator
// used, just no longer the only way to reach a given placement.
function composeWindowCli(flags, placement) {
  if (placement === 'absent') return flags.join(' ');
  if (placement === 'bare') return [...flags, FLAG].join(' ');
  const named = `${FLAG} ${SESSION}`;
  const parts = placement === 'leading' ? [named, ...flags] : [...flags, named];
  return parts.join(' ');
}

const PLACEMENTS = ['absent', 'trailing', 'leading', 'bare'];

const WINDOW_CLI_FOR_PLACEMENT = (placement) =>
  OTHER_FLAGS().map((flags) => ({ cli: composeWindowCli(flags, placement), placement }));

// The original combined generator, kept for the one test below whose
// `cases > 0` assertion is not a reach floor (shape 3) - left unchanged.
const WINDOW_CLI = () =>
  fc
    .tuple(OTHER_FLAGS(), fc.oneof(
      { arbitrary: fc.constant('absent'), weight: 2 },
      { arbitrary: fc.constant('trailing'), weight: 3 },
      { arbitrary: fc.constant('leading'), weight: 2 },
      { arbitrary: fc.constant('bare'), weight: 1 }
    ))
    .map(([flags, placement]) => ({ cli: composeWindowCli(flags, placement), placement }));

const AGENTS = ['claude', 'codex'];

function resolve(agent, rcDefault, cli) {
  const script = `set -euo pipefail
source ${JSON.stringify(LIB)}
printf '%s' "$(resolve_remote_control_cli ${JSON.stringify(agent)} ${JSON.stringify(String(rcDefault))} ${JSON.stringify(SESSION)} ${JSON.stringify(cli)})"`;
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `lib call failed: ${result.stderr}`);
  return result.stdout;
}

// The pre-BL-1218 rule, modelled here rather than assumed: the flag was
// appended only when the agent was claude, the default was on, and the line
// did not already mention one. Everything else passed through untouched.
function legacyCompose(agent, rcDefault, cli) {
  if (agent === 'claude' && rcDefault === 1 && !cli.includes(FLAG)) {
    return `${cli} ${FLAG} ${SESSION}`;
  }
  return cli;
}

// BL-1587: every placement is reached BY CONSTRUCTION - an outer loop over
// PLACEMENTS, each cell drawing runsPerCell(100, 4) times - rather than
// hoped for by a single weighted draw. The draw budget of 100 is unchanged;
// only how it is spent changes.
const INVARIANT1_CELL_RUNS = runsPerCell(100, PLACEMENTS.length);

test('property (invariant 1): under config off a Claude seat carries no flag, whatever the window line says', () => {
  const seen = { absent: 0, trailing: 0, leading: 0, bare: 0 };
  for (const placement of PLACEMENTS) {
    fc.assert(
      fc.property(WINDOW_CLI_FOR_PLACEMENT(placement), ({ cli, placement }) => {
        seen[placement] += 1;
        const resolved = resolve('claude', 0, cli);
        assert.ok(
          !resolved.includes(FLAG),
          `config off left a remote-control flag behind.\nwindow line: [${cli}]\nresolved:    [${resolved}]`
        );
        // Stripping must not eat the rest of the line.
        for (const flag of cli.split(' ')) {
          if (!flag || flag === FLAG || flag === SESSION) continue;
          assert.ok(resolved.includes(flag), `stripping the flag ate ${flag}: [${resolved}]`);
        }
      }),
      { numRuns: INVARIANT1_CELL_RUNS }
    );
  }
  assertReachFloor(seen, PLACEMENTS, INVARIANT1_CELL_RUNS, 'placement');
});

// BL-1587: both axes (agent x placement) reached BY CONSTRUCTION - an outer
// loop over their product, each cell drawing runsPerCell(100, 8) times. The
// draw budget of 100 and the per-draw body are unchanged.
const INVARIANT3_CELLS = AGENTS.flatMap((agent) => PLACEMENTS.map((placement) => ({ agent, placement })));
const INVARIANT3_CELL_RUNS = runsPerCell(100, INVARIANT3_CELLS.length);

test('property (invariant 3): with config on, composition is exactly the pre-BL-1218 rule', () => {
  const seen = { absent: 0, trailing: 0, leading: 0, bare: 0, claude: 0, codex: 0 };
  for (const { agent, placement } of INVARIANT3_CELLS) {
    fc.assert(
      fc.property(WINDOW_CLI_FOR_PLACEMENT(placement), ({ cli, placement }) => {
        seen[placement] += 1;
        seen[agent] += 1;
        assert.equal(
          resolve(agent, 1, cli),
          legacyCompose(agent, 1, cli),
          `config on diverged from today's composition for ${agent} [${cli}]`
        );
      }),
      { numRuns: INVARIANT3_CELL_RUNS }
    );
  }
  assertReachFloor(seen, ['absent', 'trailing', 'leading', 'bare', 'claude', 'codex'], INVARIANT3_CELL_RUNS, 'agent/placement');
});

test('property (invariant 3): a non-Claude seat is never rewritten, under either config value', () => {
  // BL-1587: not a reach floor after all - `assert.ok(cases > 0)` only
  // checks that fc.assert ran at least one case, which is true for any
  // numRuns >= 1 regardless of what the generator produced. Left unchanged.
  let cases = 0;
  fc.assert(
    fc.property(WINDOW_CLI(), fc.constantFrom(0, 1), ({ cli }, rcDefault) => {
      cases += 1;
      assert.equal(resolve('codex', rcDefault, cli), cli, 'a non-Claude window line was rewritten');
    }),
    { numRuns: 40 }
  );
  assert.ok(cases > 0);
});

// ── invariant 2: what actually lands on disk ────────────────────────────────

const INDEX_OF_ROLE = `
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= \${#ROLES[@]}; i++ )); do
    [[ "\${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}
`;

function writeLaunchScript(root, confText) {
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  fs.writeFileSync(path.join(root, 'swarmforge', 'roles', 'coder.prompt'), 'role prompt\n');
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), confText);
  spawnSync(
    'zsh',
    ['-c', `source '${SWARMFORGE_SH}' '${root}'; parse_config; ${INDEX_OF_ROLE} write_role_launch_script "$(index_of_role coder)"`],
    // Decide BL-1318's staffing gate ourselves - this fixture carries no
    // role matrix, so it must not depend on whether the pane exports the hatch.
    { encoding: 'utf8', env: { ...process.env, PACK_STAFFING_SKIP_GATE: '1' } }
  );
  const script = path.join(root, '.swarmforge', 'launch', 'coder.sh');
  return fs.existsSync(script) ? fs.readFileSync(script, 'utf8') : undefined;
}

// BL-1587: setting x nameFlag reached BY CONSTRUCTION - an outer loop over
// their product (3 settings x 2 flag placements = 6 cells), each cell
// drawing runsPerCell(12, 6) times. The draw budget of 12 is unchanged.
const CONFIG_SETTINGS = ['off', 'on', 'absent'];
const INVARIANT2_CELLS = CONFIG_SETTINGS.flatMap((setting) => [true, false].map((nameFlag) => ({ setting, nameFlag })));
const INVARIANT2_CELL_RUNS = runsPerCell(12, INVARIANT2_CELLS.length);

test('property (invariant 2): a persisted launch script never disagrees with the config that wrote it', () => {
  const seen = { off: 0, on: 0, absent: 0, named: 0, unnamed: 0 };
  for (const { setting, nameFlag } of INVARIANT2_CELLS) {
    fc.assert(
      fc.property(fc.constant(setting), fc.constant(nameFlag), (setting, nameFlag) => {
        seen[setting] += 1;
        seen[nameFlag ? 'named' : 'unnamed'] += 1;
        const root = mkTmpDir('sfvc-bl1218-prop-');
        try {
          const configLine = setting === 'absent' ? '' : `config remote_control ${setting}\n`;
          const windowFlags = `--model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low${
            nameFlag ? ` ${FLAG} ${SESSION}` : ''
          }`;
          const written = writeLaunchScript(root, `${configLine}window coder claude coder ${windowFlags}\n`);
          assert.ok(written, `no launch script was written for config ${setting}`);
          assert.equal(
            written.includes(FLAG),
            setting !== 'off',
            `the persisted script disagrees with config ${setting} (window line ${nameFlag ? 'names' : 'omits'} the flag)`
          );
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: INVARIANT2_CELL_RUNS }
    );
  }
  assertReachFloor(seen, ['off', 'on', 'absent', 'named', 'unnamed'], INVARIANT2_CELL_RUNS, 'setting/nameFlag');
});
