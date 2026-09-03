'use strict';

// BL-1320: step handlers for the operator step that adds or removes a seat of
// a bottleneck stage.
//
// The point of this feature is that the how-to's commands are NOT believed on
// prose alone, so every scenario that names a window line extracts that line
// FROM THE PAGE and runs it through the REAL parser - swarmforge.sh's
// parse_config, sourced directly, exactly as swarmforge's own
// test_coordinator_config_pack_override.sh does. Nothing here launches a
// swarm: `source ... ; parse_config` stops at the parse, which is what the
// scenarios are about and is the only safe way to run this from a worktree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const HOWTO = path.join(REPO_ROOT, 'docs', 'how-to', 'BL-1320-add-or-remove-a-seat-of-a-bottleneck-stage.md');
const FIXTURE_PREFIX = 'bl1320-acceptance-';
const STAGE = 'coder';
const STALE_AFTER_MS = 10 * 60 * 1000;

// Age-guarded (BL-971 wants a pre-run sweep; scenarios run concurrently, so an
// unguarded prefix sweep would delete a sibling's live root).
function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(os.tmpdir(), entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {
      // A root another scenario is removing right now is not this sweep's business.
    }
  }
}
sweepStaleFixtures();

function howto() {
  return fs.readFileSync(HOWTO, 'utf8');
}

// The documented lines, taken from the page rather than restated here - which
// is the whole discipline this feature exists to enforce.
function documentedWindowLines() {
  const lines = howto()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('window '));
  const bare = lines.find((l) => new RegExp(`^window ${STAGE}\\s`).test(l));
  const extra = lines.find((l) => new RegExp(`^window ${STAGE}@`).test(l));
  assert.ok(bare, 'the how-to no longer prints a bare stage window line');
  assert.ok(extra, 'the how-to no longer prints a second-seat window line');
  return { bare, extra };
}

function buildRoot(windowLines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'constitution.prompt'), 'constitution\n');
  for (const role of ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'coordinator']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), `${windowLines.join('\n')}\n`);
  return root;
}

// Sources swarmforge.sh and runs parse_config only, then reports what the
// parser built. Never launches anything.
function parsePack(root) {
  const script = [
    `source '${SWARMFORGE_SH}' '${root}'`,
    'parse_config',
    'print -l -- "${ROLES[@]}"',
    'echo "---MODELS---"',
    'print -l -- "${EXTRA_CLI_ARGS[@]}"',
  ].join('\n');
  const r = spawnSync('zsh', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_CONFIG: '' },
  });
  const out = `${r.stdout || ''}`;
  const [rolesBlock = '', modelsBlock = ''] = out.split('---MODELS---');
  return {
    status: r.status,
    stderr: `${r.stderr || ''}`,
    roles: rolesBlock.split('\n').map((l) => l.trim()).filter(Boolean),
    extraArgs: modelsBlock.split('\n').map((l) => l.trim()).filter(Boolean),
  };
}

function state(ctx) {
  if (!ctx.bl1320) ctx.bl1320 = {};
  return ctx.bl1320;
}

const FEATURE =
  'BL-1320 the operator step for adding or removing a seat of a bottleneck stage is documented and executable as written';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the how-to page documenting how to add and remove a seat of a stage$/, (ctx) => {
    const st = state(ctx);
    assert.ok(fs.existsSync(HOWTO), `the how-to page is missing: ${HOWTO}`);
    st.page = howto();
  });

  scoped(/^a fixture pack carrying the how-to's documented second-seat window line$/, (ctx) => {
    const st = state(ctx);
    const { bare, extra } = documentedWindowLines();
    st.documented = { bare, extra };
    st.root = buildRoot([bare, extra]);
  });

  scoped(/^a fixture pack with two seats of one stage$/, (ctx) => {
    const st = state(ctx);
    const { bare, extra } = documentedWindowLines();
    st.documented = { bare, extra };
    st.root = buildRoot([bare, extra]);
  });

  scoped(/^the how-to's documented removal step is applied to that pack$/, (ctx) => {
    const st = state(ctx);
    // The page says: delete the `window <stage>@<seat>` line, and only that
    // line. Applied literally here.
    const conf = path.join(st.root, 'swarmforge', 'swarmforge.conf');
    const kept = fs
      .readFileSync(conf, 'utf8')
      .split('\n')
      .filter((l) => !new RegExp(`^window ${STAGE}@`).test(l.trim()));
    fs.writeFileSync(conf, kept.join('\n'));
  });

  scoped(/^the pack is parsed for launch$/, (ctx) => {
    const st = state(ctx);
    st.parsed = parsePack(st.root);
    assert.equal(st.parsed.status, 0, `the documented pack did not parse:\n${st.parsed.stderr}`);
  });

  scoped(/^the stage has two seats$/, (ctx) => {
    const st = state(ctx);
    const seats = st.parsed.roles.filter((r) => r === STAGE || r.startsWith(`${STAGE}@`));
    assert.equal(seats.length, 2, `expected two seats of ${STAGE}, parser reported ${JSON.stringify(st.parsed.roles)}`);
  });

  // The last step of scenario 01 (BL-971/tempDirTrapGuard): st.root is built
  // in an earlier step and this feature has no scenario-end hook, so cleanup
  // has to live in the terminal step - guarded by try/finally, since a
  // failing assertion above must not leak the root either.
  scoped(/^each seat carries its own model$/, (ctx) => {
    const st = state(ctx);
    try {
      const models = [st.documented.bare, st.documented.extra].map((line) => {
        const m = line.match(/--model\s+(\S+)/);
        assert.ok(m, `a documented window line names no model: ${line}`);
        return m[1];
      });
      assert.notEqual(models[0], models[1], 'the page gives both seats the same model, so "its own model" is untested');
      for (const model of models) {
        assert.ok(
          st.parsed.extraArgs.some((a) => a.includes(model)),
          `the parser did not carry ${model} through: ${JSON.stringify(st.parsed.extraArgs)}`,
        );
      }
    } finally {
      fs.rmSync(st.root, { recursive: true, force: true });
    }
  });

  scoped(/^the stage has one seat$/, (ctx) => {
    const st = state(ctx);
    const seats = st.parsed.roles.filter((r) => r === STAGE || r.startsWith(`${STAGE}@`));
    assert.equal(seats.length, 1, `expected one seat of ${STAGE}, got ${JSON.stringify(seats)}`);
  });

  // Terminal step of scenario 02 - same try/finally reasoning as scenario 01
  // above: the assertion must not be able to skip cleanup.
  scoped(/^that seat is the bare stage-named seat$/, (ctx) => {
    const st = state(ctx);
    try {
      assert.ok(st.parsed.roles.includes(STAGE), `the bare ${STAGE} seat is gone: ${JSON.stringify(st.parsed.roles)}`);
    } finally {
      fs.rmSync(st.root, { recursive: true, force: true });
    }
  });

  scoped(/^the how-to's tier guidance is read for a stage whose constraint is capacity at a difficulty band$/, (ctx) => {
    state(ctx).page = howto();
  });

  scoped(/^it names the model tier to add for that band$/, (ctx) => {
    const page = state(ctx).page;
    assert.match(page, /--seat-tier hard/, 'the tier guidance names no hard tier');
    assert.match(page, /--seat-tier easy/, 'the tier guidance names no easy tier');
    assert.match(page, /difficulty band|high difficulty band|band/i, 'the guidance never mentions a difficulty band');
  });

  scoped(/^it names the steward command that lists the models ranked for that role$/, (ctx) => {
    const page = state(ctx).page;
    const match = page.match(/([^\n`]*model_steward_cli\.bb role-matrix [^\n`]*)/);
    assert.ok(match, 'the page names no role-matrix steward command');
    // Run the command the page prints, against the real CLI, so a renamed
    // subcommand fails here rather than misleading an operator.
    const printed = match[1].trim();
    const argv = printed.split(/\s+/);
    const cliIndex = argv.findIndex((a) => a.endsWith('model_steward_cli.bb'));
    const r = spawnSync('bb', [path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_cli.bb'), ...argv.slice(cliIndex + 1)], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    assert.doesNotMatch(
      out,
      /Usage|unknown command/i,
      `the steward command the page prints is not one the CLI accepts: ${printed}\n${out}`,
    );
  });

  scoped(/^the how-to's add step is read$/, (ctx) => {
    state(ctx).page = howto();
  });

  scoped(/^it states that a stage declaring an extra seat must also declare its bare stage-named seat$/, (ctx) => {
    const page = state(ctx).page;
    assert.match(page, /must also keep its bare\s+stage-named seat|must also declare its bare/i,
      'the page does not state the bare-seat constraint');

    // Stated is not enough: the page also prints the refusal an operator will
    // see, so break the constraint for real and confirm the parser refuses
    // with what the page promised.
    const { bare, extra } = documentedWindowLines();
    const root = buildRoot([extra]);
    try {
      const parsed = parsePack(root);
      assert.notEqual(parsed.status, 0, 'declaring an extra seat with no bare seat was accepted');
      assert.match(
        parsed.stderr,
        /no bare '?coder'? seat|the stage-named seat must exist/,
        `the parser's refusal is not the one the page warns about:\n${parsed.stderr}`,
      );
      assert.ok(
        page.includes('the stage-named seat must exist because parcels address the stage'),
        'the page quotes a refusal the parser does not actually print',
      );
      assert.ok(bare, 'the page prints no bare line to restore');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
