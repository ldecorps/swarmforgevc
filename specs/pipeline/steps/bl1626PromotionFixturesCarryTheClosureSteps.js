'use strict';

// BL-1626: step handlers for "Promotion fixtures carry the promote script's
// whole closure" (specifier-authored feature, lands with this handler in the
// same parcel - BL-233, BL-1371).
//
// Scenario 01 drives each named handler's own fixture-scripts-dir builder
// (exported for exactly this purpose) and diffs its real contents against
// the derived load-file closure of promotion_gates_cli.bb - never a
// hand-maintained list (BL-1538).
//
// Scenario 02 drives bl1100's own fixture-root builder, resolves the
// freshness gate's CLI path the way promote_and_route_next.sh itself does,
// and runs the real gate CLI against the fixture's own paused ticket.
//
// Scenario 03 is the census (BL-1445): every step handler whose source
// copies promote_and_route_next.sh or promotion_gates_cli.bb into a fixture
// is found by grepping the handler directory, and each such file is
// asserted to require one of the two closure-deriving helpers
// (computeClosure/diffClosureAgainstList from operatorRuntimeBbClosure.js,
// or copyScriptClosure/copyLiveScriptClosureInto from pinnedRepoFixture.js) -
// never a bare fs.copyFileSync of either name with no closure helper in the
// same file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = "BL-1626 Promotion fixtures carry the promote script's whole closure";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const STEPS_DIR = __dirname;

const { computeClosure } = require('./lib/operatorRuntimeBbClosure.js');
const bl803 = require('./bl803PromoteRouteSedBsdPortabilitySteps.js');
const bl1028 = require('./bl1028PromotionRefusalSteps.js');
const bl1100 = require('./bl1100PromotionProseNeverBlocksSteps.js');

// Explicit known values per the Scenario Outline handler rule (engineering
// rules): each Examples: <handler> value is looked up here, never passed
// through as a bare filename - the feature's own literal names the two red
// handlers by their historical ticket-prefixed name, not their file's actual
// basename (bl803's file carries "Bsd", bl1028's keeps its shorter working
// name); the map is the one place that translation happens.
const KNOWN_HANDLERS = new Map([
  ['bl803PromoteRouteSedPortabilitySteps.js', bl803.buildFixtureScriptsDir],
  ['bl1028PromotionMustNotBypassARefusedIntegrityCommitSteps.js', bl1028.buildFixtureScriptsDir],
]);

// The two closure-deriving helpers a handler that copies the promote chain
// must require one of - never a bare fs.copyFileSync list.
const CLOSURE_HELPER_NAMES = ['computeClosure', 'diffClosureAgainstList', 'copyScriptClosure', 'copyLiveScriptClosureInto'];

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the fixture scripts directory that the (\S+) step handler builds$/, (ctx, handler) => {
    const build = KNOWN_HANDLERS.get(handler);
    assert.ok(build, `unknown handler in Examples: ${handler} - add it to KNOWN_HANDLERS`);
    ctx.fixtureScriptsDir = build();
  });

  scoped(/^its contents are diffed against the derived load-file closure of promotion_gates_cli\.bb$/, (ctx) => {
    const closure = computeClosure(SCRIPTS_DIR, 'promotion_gates_cli.bb');
    const present = new Set(fs.readdirSync(ctx.fixtureScriptsDir));
    ctx.missingFromFixture = [...closure].filter((f) => !present.has(f)).sort();
  });

  scoped(/^no library is missing from the fixture$/, (ctx) => {
    assert.deepEqual(
      ctx.missingFromFixture,
      [],
      `fixture at ${ctx.fixtureScriptsDir} is missing: ${ctx.missingFromFixture.join(', ')}`
    );
  });

  scoped(/^the fixture root that the bl1100 step handler builds, holding one paused fixture ticket$/, (ctx) => {
    const { root, ticketId } = bl1100.buildFixtureRootWithPausedTicket();
    ctx.bl1100Root = root;
    ctx.bl1100TicketId = ticketId;
  });

  scoped(/^the copied promote_and_route_next\.sh resolves the deprecate-check CLI from that root$/, (ctx) => {
    // Same two-branch resolution promote_and_route_next.sh's deprecate_check_cli
    // performs: $ROOT/extension/... first, else relative to the copied
    // script's own directory.
    const rootCli = path.join(ctx.bl1100Root, 'extension', 'out', 'tools', 'deprecate-check.js');
    const scriptDirCli = path.join(ctx.bl1100Root, 'swarmforge', 'scripts', '..', '..', 'extension', 'out', 'tools', 'deprecate-check.js');
    ctx.resolvedCli = fs.existsSync(rootCli) ? rootCli : fs.existsSync(scriptDirCli) ? scriptDirCli : null;
  });

  scoped(/^it finds the repository's compiled CLI$/, (ctx) => {
    const real = fs.realpathSync(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'deprecate-check.js'));
    assert.ok(ctx.resolvedCli, `the fixture's freshness gate found no deprecate-check CLI under ${ctx.bl1100Root}`);
    assert.equal(fs.realpathSync(ctx.resolvedCli), real);
  });

  scoped(/^the gate's answer for the fixture ticket is allow$/, (ctx) => {
    const out = execFileSync('node', [ctx.resolvedCli, ctx.bl1100Root, ctx.bl1100TicketId], { encoding: 'utf8' });
    const decision = JSON.parse(out).decision;
    assert.equal(decision, 'allow', `expected allow, got ${decision}: ${out}`);
  });

  scoped(/^the step handlers that copy promote_and_route_next\.sh or promotion_gates_cli\.bb into a fixture are listed$/, (ctx) => {
    const files = fs.readdirSync(STEPS_DIR).filter((f) => f.endsWith('.js'));
    ctx.copiers = files.filter((f) => {
      const text = fs.readFileSync(path.join(STEPS_DIR, f), 'utf8');
      return /promote_and_route_next\.sh|promotion_gates_cli\.bb/.test(text) && /copyFileSync|copyScriptClosure|copyLiveScriptClosureInto|computeClosure/.test(text);
    });
  });

  scoped(/^at least 3 handlers are listed and the count is reported$/, (ctx) => {
    assert.ok(ctx.copiers.length >= 3, `found ${ctx.copiers.length} copier handlers: ${ctx.copiers.join(', ')}`);
    // eslint-disable-next-line no-console
    console.log(`BL-1626 census: ${ctx.copiers.length} handlers copy the promote chain: ${ctx.copiers.join(', ')}`);
  });

  scoped(/^every listed handler builds its fixture through a closure-deriving helper$/, (ctx) => {
    const withoutHelper = ctx.copiers.filter((f) => {
      const text = fs.readFileSync(path.join(STEPS_DIR, f), 'utf8');
      return !CLOSURE_HELPER_NAMES.some((name) => text.includes(name));
    });
    assert.deepEqual(
      withoutHelper,
      [],
      `these handlers copy the promote chain with no closure-deriving helper: ${withoutHelper.join(', ')}`
    );
  });
}

module.exports = { registerSteps };
