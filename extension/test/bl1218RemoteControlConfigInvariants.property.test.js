const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

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

// A window line's flags, as the real packs write them. The rows that can
// detect this defect are the ones that NAME the flag - an omits-row composes
// identically before and after - so naming is weighted heavily and the
// generator's reach over both is asserted.
const OTHER_FLAGS = () =>
  fc.subarray(
    ['--model claude-sonnet-5', '--dangerously-skip-permissions', '--effort medium'],
    { minLength: 0 }
  );

const WINDOW_CLI = () =>
  fc
    .tuple(OTHER_FLAGS(), fc.oneof(
      { arbitrary: fc.constant('absent'), weight: 2 },
      { arbitrary: fc.constant('trailing'), weight: 3 },
      { arbitrary: fc.constant('leading'), weight: 2 },
      { arbitrary: fc.constant('bare'), weight: 1 }
    ))
    .map(([flags, placement]) => {
      if (placement === 'absent') return { cli: flags.join(' '), placement };
      if (placement === 'bare') return { cli: [...flags, FLAG].join(' '), placement };
      const named = `${FLAG} ${SESSION}`;
      const parts = placement === 'leading' ? [named, ...flags] : [...flags, named];
      return { cli: parts.join(' '), placement };
    });

const AGENT = () =>
  fc.oneof({ arbitrary: fc.constant('claude'), weight: 4 }, { arbitrary: fc.constant('codex'), weight: 1 });

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

function assertReach(seen, kinds) {
  for (const kind of kinds) {
    assert.ok(seen[kind] > 0, `generator never reached ${kind}: ${JSON.stringify(seen)}`);
  }
}

test('property (invariant 1): under config off a Claude seat carries no flag, whatever the window line says', () => {
  const seen = { absent: 0, trailing: 0, leading: 0, bare: 0 };
  fc.assert(
    fc.property(WINDOW_CLI(), ({ cli, placement }) => {
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
    { numRuns: 100 }
  );
  assertReach(seen, ['absent', 'trailing', 'leading', 'bare']);
});

test('property (invariant 3): with config on, composition is exactly the pre-BL-1218 rule', () => {
  const seen = { absent: 0, trailing: 0, leading: 0, bare: 0, claude: 0, codex: 0 };
  fc.assert(
    fc.property(AGENT(), WINDOW_CLI(), (agent, { cli, placement }) => {
      seen[placement] += 1;
      seen[agent] += 1;
      assert.equal(
        resolve(agent, 1, cli),
        legacyCompose(agent, 1, cli),
        `config on diverged from today's composition for ${agent} [${cli}]`
      );
    }),
    { numRuns: 100 }
  );
  assertReach(seen, ['absent', 'trailing', 'leading', 'bare', 'claude', 'codex']);
});

test('property (invariant 3): a non-Claude seat is never rewritten, under either config value', () => {
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
    { encoding: 'utf8' }
  );
  const script = path.join(root, '.swarmforge', 'launch', 'coder.sh');
  return fs.existsSync(script) ? fs.readFileSync(script, 'utf8') : undefined;
}

const CONFIG_SETTING = () => fc.constantFrom('off', 'on', 'absent');

test('property (invariant 2): a persisted launch script never disagrees with the config that wrote it', () => {
  const seen = { off: 0, on: 0, absent: 0, named: 0, unnamed: 0 };
  fc.assert(
    fc.property(CONFIG_SETTING(), fc.boolean(), (setting, nameFlag) => {
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
    { numRuns: 12 }
  );
  assertReach(seen, ['off', 'on', 'absent', 'named', 'unnamed']);
});
