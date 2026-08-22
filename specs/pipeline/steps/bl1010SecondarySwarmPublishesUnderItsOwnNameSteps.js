'use strict';

// BL-1010: step handlers for "A secondary swarm publishes fleet status under
// its own name".
//
// Scenarios 01 and 02 drive the REAL readSwarmName and the REAL
// emitFleetStatus - the exact functions handoffd's fleet-status-sweep shells
// out to - against real checkout fixtures and a redirected rendezvous dir.
// Stubbing the file reads would test nothing that failed: the whole defect was
// which FILE the resolver consulted.
//
// Scenario 03 compares the two languages' default literals by READING both
// from source. No import can bridge TypeScript and Babashka, so a "kept in
// sync" comment is not a gate and drift there fails silently.
//
// Scenario 04 drives the bring-up message the daemon now logs when the
// compiled publisher is absent, and additionally asserts handoffd.bb actually
// calls it - a message nothing emits would satisfy the scenario while the
// daemon went on printing module-not-found.
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'A secondary swarm publishes fleet status under its own name';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const { readSwarmName, DEFAULT_SWARM_NAME } = require(path.join(EXT_DIR, 'out', 'bridge', 'holisticProjections'));
const { emitFleetStatus } = require(path.join(EXT_DIR, 'out', 'tools', 'emit-fleet-status'));

// Explicit known values per the Scenario Outline handler rule: `absent` is the
// only magic word the Examples use. Every other cell is a literal swarm name,
// which is passed through as data - but `absent` must never be written to disk
// as if it were a name, which is exactly what a passthrough handler would do.
const ABSENT = 'absent';

function makeCheckout({ identity, conf }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1010acc-'));
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  if (identity !== ABSENT && identity !== undefined) {
    fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'),
      `swarm_name\t${identity}\nswarm_mode\tautonomous\n`);
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'),
    (conf === ABSENT || conf === undefined)
      ? 'config active_backlog_max_depth 3\n'
      : `config active_backlog_max_depth 3\nconfig swarm_name ${conf}\n`);
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'),
    ['coordinator\tswarmforge-coordinator\t0', 'coder\tswarmforge-coder\t0'].join('\n') + '\n');
  return root;
}

function cleanup(ctx) {
  for (const dir of ctx.tempDirs || []) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ctx.tempDirs = [];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a swarm checkout$/, (ctx) => {
    ctx.tempDirs = [];
    ctx.identity = ABSENT;
    ctx.conf = ABSENT;
  });

  scoped(/^a checkout whose identity file names swarm "?([^"\s]+)"?$/, (ctx, identity) => {
    ctx.identity = identity;
  });

  scoped(/^whose conf names swarm ([^\s]+)$/, (ctx, conf) => {
    ctx.conf = conf;
  });

  scoped(/^the swarm's own name is looked up$/, (ctx) => {
    const root = makeCheckout({ identity: ctx.identity, conf: ctx.conf });
    ctx.tempDirs.push(root);
    try {
      ctx.resolved = readSwarmName(root);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the resolved swarm name is ([^\s]+)$/, (ctx, expected) => {
    assert.notEqual(expected, ABSENT, 'a resolved name is never "absent" - that word only describes an input');
    assert.equal(ctx.resolved, expected,
      `identity=${ctx.identity} conf=${ctx.conf}: the identity file must win, then the conf, then the default`);
  });

  scoped(/^fleet status is published for that checkout$/, (ctx) => {
    if (ctx.noCompiledOutput) {
      // Scenario 04: nothing to run. The daemon's own decision is what is
      // under test, so drive the message it logs.
      ctx.failureMessage = execFileSync('bb', ['-e', `(require '[babashka.fs :as fs])
(load-file "${path.join(SCRIPTS, 'node_tool_bringup_lib.bb')}")
(println (node-tool-bringup-lib/missing-tool-message "emit-fleet-status.js" "${ctx.missingPath}"))`],
        { encoding: 'utf8' }).trim();
      return;
    }
    const root = makeCheckout({ identity: ctx.identity, conf: ctx.conf });
    const fleetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1010fleet-'));
    ctx.tempDirs.push(root, fleetDir);
    try {
      ctx.doc = emitFleetStatus(root, 1_700_000_000_000, { ...process.env, SWARMFORGE_FLEET_DIR: fleetDir });
      ctx.written = fs.readdirSync(fleetDir).sort();
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the published document identifies the swarm as "([^"]+)"$/, (ctx, name) => {
    assert.equal(ctx.doc.identity.name, name,
      'the published document must carry the name from the identity file, not the conf default');
  });

  scoped(/^no fleet status is written under the name "([^"]+)"$/, (ctx, forbidden) => {
    assert.ok(!ctx.written.includes(forbidden),
      `publishing must never write under ${forbidden} - that is the clobber this ticket prevents; wrote ${ctx.written.join(', ')}`);
    // Stronger, and the reason this scenario is worth having: only the swarm's
    // own name may appear at all. Checking merely that "primary" is absent
    // would pass if some third name were also written.
    assert.deepEqual(ctx.written, [ctx.identity],
      `only ${ctx.identity} may be written; found ${ctx.written.join(', ')}`);
  });

  scoped(/^the TypeScript and Babashka swarm-name readers$/, (ctx) => {
    ctx.tsDefault = DEFAULT_SWARM_NAME;
    const bb = fs.readFileSync(path.join(SCRIPTS, 'swarm_identity_lib.bb'), 'utf8');
    const m = bb.match(/\(def default-swarm-name\s+"([^"]+)"\)/);
    assert.ok(m, 'swarm_identity_lib.bb must still declare default-swarm-name as a literal to compare against');
    ctx.bbDefault = m[1];
  });

  scoped(/^their default swarm name literals are compared$/, (ctx) => {
    ctx.literalsMatch = ctx.tsDefault === ctx.bbDefault;
  });

  scoped(/^the two literals are identical$/, (ctx) => {
    assert.ok(ctx.literalsMatch,
      `TypeScript says "${ctx.tsDefault}", Babashka says "${ctx.bbDefault}" - no import can bridge these, so drift here is silent`);
  });

  scoped(/^a checkout with no compiled extension output$/, (ctx) => {
    ctx.noCompiledOutput = true;
    ctx.missingPath = '/some/checkout/extension/out/tools/emit-fleet-status.js';
  });

  scoped(/^the reported failure names the compile step required to bring that swarm up$/, (ctx) => {
    assert.ok(/npm run compile/.test(ctx.failureMessage),
      `the failure must name the command to run; got: ${ctx.failureMessage}`);
    assert.ok(/extension\//.test(ctx.failureMessage),
      `the failure must name where to run it - npm runs from extension/, never the repo root; got: ${ctx.failureMessage}`);
    // And the daemon must actually use it: a helpful message nothing emits
    // would satisfy this scenario while handoffd went on logging node's own
    // module-not-found, which is the defect.
    const daemon = fs.readFileSync(path.join(SCRIPTS, 'handoffd.bb'), 'utf8');
    assert.ok(/node-tool-bringup-lib\/missing-tool-message/.test(daemon),
      "handoffd.bb's fleet-status sweep must report this message, not node's module-not-found");
  });
}

module.exports = { registerSteps };
