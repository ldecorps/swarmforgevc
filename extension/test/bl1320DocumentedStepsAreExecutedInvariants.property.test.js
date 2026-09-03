'use strict';

// BL-1320's DECLARED invariant (property authorship rests with the coder,
// first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant  Every command and window line the how-to prints is exercised
//              against a real pack parse by this ticket's own scenarios - no
//              step is asserted in prose alone.
//
// This quantifies over the PAGE, not over a pure function: for every command
// or window line the page prints, something must actually run it. So the
// property enumerates what the page prints and checks each one is reached -
// window lines through the real parse_config, the steward command through the
// real CLI. A page that grows a new command without coverage fails here, which
// is the only way the invariant can hold as the page changes.
//
// GENERATOR REACH: the population is the page's own printed commands, so the
// run fails if it found none - an empty enumeration would satisfy every
// assertion while proving nothing.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOWTO = path.join(REPO_ROOT, 'docs', 'how-to', 'BL-1320-add-or-remove-a-seat-of-a-bottleneck-stage.md');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const FIXTURE_PREFIX = 'bl1320-property-';
const STAGE = 'coder';

function page() {
  return fs.readFileSync(HOWTO, 'utf8');
}

// Everything the page prints inside a fenced block that an operator would
// type or paste: window lines and shell commands.
function printedSteps() {
  const windowLines = [];
  const commands = [];
  let inFence = false;
  for (const raw of page().split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) continue;
    if (line.startsWith('window ')) windowLines.push(line);
    else if (/^(bb|\.\/swarm)\s/.test(line)) commands.push(line);
  }
  return { windowLines, commands };
}

function buildRoot(lines) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  for (const role of ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'coordinator']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), `${lines.join('\n')}\n`);
  return root;
}

// parse_config only - never a launch.
function parsePack(root) {
  const script = [`source '${SWARMFORGE_SH}' '${root}'`, 'parse_config', 'print -l -- "${ROLES[@]}"'].join('\n');
  const r = spawnSync('zsh', ['-c', script], { encoding: 'utf8', env: { ...process.env, SWARMFORGE_CONFIG: '' } });
  return {
    status: r.status,
    stderr: `${r.stderr || ''}`,
    roles: `${r.stdout || ''}`.split('\n').map((l) => l.trim()).filter(Boolean),
  };
}

test('BL-1320/BL-654 invariant: every window line the page prints parses, in the company the page puts it in', () => {
  const { windowLines } = printedSteps();
  assert.ok(windowLines.length > 0, 'the page prints no window line at all - the enumeration is empty');

  const bare = windowLines.find((l) => new RegExp(`^window ${STAGE}\\s`).test(l));
  assert.ok(bare, 'the page prints no bare stage line, so no extra seat it documents could ever parse');

  fc.assert(
    fc.property(fc.constantFrom(...windowLines), (line) => {
      // An extra seat is only legal beside its bare seat, which is the
      // constraint the page itself states - so that is the company each line
      // is parsed in.
      const lines = line === bare ? [bare] : [bare, line];
      const root = buildRoot(lines);
      try {
        const parsed = parsePack(root);
        assert.equal(parsed.status, 0, `a line the page prints does not parse:\n${line}\n${parsed.stderr}`);
        const seatId = line.split(/\s+/)[1];
        assert.ok(
          parsed.roles.includes(seatId),
          `the parser did not produce the seat the page's line declares (${seatId}): ${JSON.stringify(parsed.roles)}`,
        );
        return true;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: windowLines.length * 2 },
  );
});

test('BL-1320/BL-654 invariant: every shell command the page prints is one the tool actually accepts', () => {
  const { commands } = printedSteps();
  assert.ok(commands.length > 0, 'the page prints no runnable command - the enumeration is empty');

  fc.assert(
    fc.property(fc.constantFrom(...commands), (command) => {
      const argv = command.split(/\s+/);
      // Only bb-invoked project scripts are run here. A `./swarm` line is
      // deliberately NOT executed - running the launcher from a worktree is
      // out of policy, and the parse half is covered by the property above.
      if (argv[0] !== 'bb') return true;
      const script = path.join(REPO_ROOT, argv[1]);
      assert.ok(fs.existsSync(script), `the page names a script that does not exist: ${argv[1]}`);
      const r = spawnSync('bb', [script, ...argv.slice(2)], { encoding: 'utf8', cwd: REPO_ROOT });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      assert.doesNotMatch(
        out,
        /Usage:|unknown command/i,
        `the page prints a command the CLI does not accept: ${command}\n${out}`,
      );
      return true;
    }),
    { numRuns: commands.length * 2 },
  );
});
