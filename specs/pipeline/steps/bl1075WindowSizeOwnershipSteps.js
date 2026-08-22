'use strict';

// BL-1075: step handlers for "the swarm applies only the tmux options it can
// keep".
//
// Against a REAL tmux server on its own private socket, never the call sites.
// The ticket is explicit about that - the whole defect is a scope rule that is
// invisible in the source, because both writers look correct and the window
// option simply beats the server global. Every scenario here starts a
// throwaway server, tiles it the way paneTailer.applyPaneSettings does
// (`set-option -g window-size manual`, then `resize-window` per role), runs the
// REAL hardening, and reads the server back.
//
// focus-events is turned ON in the fixture before hardening runs. It is `off`
// BY DEFAULT on a fresh tmux server, so asserting "off afterwards" would
// otherwise pass with the hardening deleted - measured, and caught by running
// exactly that break.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');
// BL-948: a fixture that builds a control socket roots under a SHORT base -
// os.tmpdir() resolves under /var/folders/<hash>/<hash>/T/ on macOS and the
// socket path overruns swarm_socket_lib.bb's 100-char guard, so scenarios die
// on the refusal instead of on what they assert. BL-458: a tmux server this
// file starts DETACHES and outlives the runner, so the root is tracked for
// reaping on the throw and signal paths too, not only in afterEach.
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { track, reap } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const CONTROL_PLANE_LIB = path.join(SCRIPTS_DIR, 'control_plane_lib.bb');
const HOW_TO = path.join(REPO_ROOT, 'docs', 'how-to', 'BL-tmux-wsl-segfault-upgrade.md');

const FEATURE = 'BL-1075 the swarm applies only the tmux options it can keep';

// Explicit known values per the Scenario Outline handler rule: a row the
// handlers do not know is a hard failure, never a passthrough. The four rows
// are the four call paths the ticket enumerates; `shell launch` and
// `shell ensure` both reach harden_tmux_server, `plane restore` and
// `plane already up` both reach control_plane_lib's harden-server!.
const KNOWN_PATHS = new Map([
  ['shell launch', 'shell'],
  ['shell ensure', 'shell'],
  ['plane restore', 'bb'],
  ['plane already up', 'bb'],
]);

let trackedRoots = [];
afterEach(() => {
  while (trackedRoots.length) {
    // reap() kills the fixture tmux server by socket path and untracks the
    // root; the shared exit/SIGINT/SIGTERM hook covers the paths where a
    // scenario throws before reaching here.
    reap(trackedRoots.pop());
  }
});

function tmux(socket, args) {
  return spawnSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' });
}

function tmuxOut(socket, args) {
  return (tmux(socket, args).stdout || '').trim();
}

// The sizes paneTailer asks for: a selected tile is taller than the rest
// (BL-040/043/051), which is why this is per role and not one number.
const DEFAULT_SIZES = [
  ['swarmforge-coder', 24],
  ['swarmforge-QA', 60],
];

function startTiledServer(ctx, sizes) {
  const root = mkSocketFixtureRoot('bl1075-');
  track(root);
  trackedRoots.push(root);
  // The socket is deliberately NOT `<root>/.swarmforge/tmux/<name>.sock`:
  // fixtureReaper REFUSES to kill anything matching the live swarm's own
  // socket shapes, however a fixture's sessions are named (BL-817 - these
  // fixtures reuse real session names like swarmforge-coder, so reaping by
  // name would kill the running swarm). An arbitrary fixture name is the
  // convention every other fixture here follows, and it is what makes this
  // server reapable at all.
  const socket = path.join(root, 'bl1075.sock');
  // The pointer file is how reap() finds a fixture's tmux server - without it
  // the shared exit/SIGINT/SIGTERM hook has nothing to kill and the server
  // survives the runner. Measured: six leaked servers before this line.
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${socket}\n`);
  for (const [session] of sizes) {
    tmux(socket, ['new-session', '-d', '-s', session, 'sleep 300']);
  }
  tmux(socket, ['set-option', '-g', 'focus-events', 'on']);
  // Exactly what applyPaneSettings does, in that order.
  tmux(socket, ['set-option', '-g', 'window-size', 'manual']);
  for (const [session, rows] of sizes) {
    tmux(socket, ['resize-window', '-t', session, '-x', '200', '-y', String(rows)]);
  }
  ctx.socket = socket;
  ctx.sizes = sizes;
}

function hardenViaShell(socket) {
  return spawnSync(
    'zsh',
    [
      '-f',
      '-c',
      `source '${SWARMFORGE_SH}' '${REPO_ROOT}' >/dev/null 2>&1 || true\nTMUX_SOCKET='${socket}'\nharden_tmux_server\necho HARDENED`,
    ],
    { encoding: 'utf8' }
  );
}

function hardenViaBb(socket) {
  return spawnSync(
    'bb',
    [
      '-e',
      `(load-file "${CONTROL_PLANE_LIB}") (control-plane-lib/harden-server! "${socket}") (println "HARDENED")`,
    ],
    { encoding: 'utf8' }
  );
}

function harden(ctx, kind) {
  const result = kind === 'shell' ? hardenViaShell(ctx.socket) : hardenViaBb(ctx.socket);
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  assert.match(out, /HARDENED/, `the ${kind} hardening did not complete: ${out}`);
  ctx.hardened = kind;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── scenarios 01 and 02 ────────────────────────────────────────────────

  scoped(/^a live control-plane server on the swarm socket$/, (ctx) => {
    assert.ok(fs.existsSync(SWARMFORGE_SH), `the launcher under test is missing: ${SWARMFORGE_SH}`);
    startTiledServer(ctx, DEFAULT_SIZES);
    // The premise the whole ticket rests on, measured rather than assumed: a
    // window the panel resized answers `manual` while the global does not.
    assert.equal(
      tmuxOut(ctx.socket, ['show-options', '-w', '-v', '-t', DEFAULT_SIZES[0][0], 'window-size']),
      'manual',
      'resize-window did not arm `manual` in the window options - the premise of this ticket no longer holds'
    );
  });

  scoped(/^the swarm hardens that server$/, (ctx) => {
    assert.ok(ctx.socket, 'no server was started');
    // Both implementations, because scenario 01 is about what the swarm
    // applies, not about one of the two places it applies it from.
    harden(ctx, 'shell');
    harden(ctx, 'bb');
  });

  scoped(/^no window-size mitigation is applied at a scope the tiling panel overrides$/, (ctx) => {
    // `largest` is the value only the hardening ever wrote; the panel writes
    // `manual` there itself, so finding `largest` means the hardening put back
    // a mitigation the panel overrides per window.
    assert.notEqual(
      tmuxOut(ctx.socket, ['show-options', '-gv', 'window-size']),
      'largest',
      'the hardening applied a server-scope window-size the tiling panel overrides per window'
    );
    for (const [session] of ctx.sizes) {
      assert.equal(
        tmuxOut(ctx.socket, ['show-options', '-w', '-v', '-t', session, 'window-size']),
        'manual',
        `${session} is not under the panel's own window-size - the scope this ticket is about`
      );
    }
  });

  scoped(/^the swarm reaches the "(.+)" path$/, (ctx, pathName) => {
    assert.ok(
      KNOWN_PATHS.has(pathName),
      `unknown path "${pathName}" - the handlers know ${[...KNOWN_PATHS.keys()].join('; ')}`
    );
    harden(ctx, KNOWN_PATHS.get(pathName));
  });

  scoped(/^focus-events is off on that server$/, (ctx) => {
    assert.ok(ctx.hardened, 'nothing hardened the server');
    assert.equal(
      tmuxOut(ctx.socket, ['show-options', '-gv', 'focus-events']),
      'off',
      'the live knob was dropped along with the inert one'
    );
  });

  // ── scenario 03 ────────────────────────────────────────────────────────

  scoped(/^the panel is tiling a coder window at (\d+) rows and a QA window at (\d+) rows$/, (ctx, coderRows, qaRows) => {
    startTiledServer(ctx, [
      ['swarmforge-coder', Number(coderRows)],
      ['swarmforge-QA', Number(qaRows)],
    ]);
  });

  scoped(/^the panel applies its pane settings$/, (ctx) => {
    // The panel's sizing is already in force from the fixture; what this
    // scenario is about is that hardening does not disturb it, so both
    // hardening paths run between the sizing and the assertions.
    harden(ctx, 'shell');
    harden(ctx, 'bb');
  });

  scoped(/^the (\w+) window is (\d+) rows$/, (ctx, role, rows) => {
    const session = `swarmforge-${role}`;
    assert.ok(
      ctx.sizes.some(([s]) => s === session),
      `the scenario asks about ${session}, which the fixture never sized`
    );
    assert.equal(
      tmuxOut(ctx.socket, ['display-message', '-p', '-t', session, '#{window_height}']),
      rows,
      `${session} lost the rows the panel asked for`
    );
  });

  // ── scenario 04 ────────────────────────────────────────────────────────

  scoped(/^the tmux upgrade how-to$/, (ctx) => {
    assert.ok(fs.existsSync(HOW_TO), `the how-to is missing: ${HOW_TO}`);
    ctx.howTo = fs.readFileSync(HOW_TO, 'utf8');
  });

  scoped(/^its soft-mitigation list is read$/, (ctx) => {
    assert.ok(ctx.howTo, 'the how-to was never read');
    // Sentences, not lines: the doc is hard-wrapped, so "as a soft\nmitigation"
    // spans two lines and a line-based match would miss it. Scoped to the
    // soft-mitigation list, so prose elsewhere is free to explain why the
    // option was dropped.
    ctx.mitigationSentences = ctx.howTo
      .replace(/\s+/g, ' ')
      .split(/(?<=\.) /)
      .map((s) => s.trim())
      .filter((s) => /soft mitigation/i.test(s));
    assert.ok(
      ctx.mitigationSentences.length > 0,
      'the how-to names no soft mitigation at all - the check would be vacuous'
    );
  });

  scoped(/^it does not name a window-size option$/, (ctx) => {
    const offenders = ctx.mitigationSentences.filter((s) => /window-size/.test(s));
    assert.deepEqual(offenders, [], 'the how-to still offers a window-size option as a soft mitigation');
    // The sentence that survives must still say what DOES carry the load.
    assert.match(
      ctx.howTo,
      /version upgrade/i,
      'the how-to no longer says the version upgrade is what protects the host'
    );
  });
}

module.exports = { registerSteps };
