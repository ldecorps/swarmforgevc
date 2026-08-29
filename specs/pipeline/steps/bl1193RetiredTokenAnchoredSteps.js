'use strict';

// BL-1193: step handlers for "the retired-token extractor names the retired
// item, not a co-occurring word". Drives the compiled CLI against a fixture
// project root whose docs/ carries the real table row from
// docs/how-to/BL-1095-...md - the line that actually caused the incident.
//
// Scoped to this feature (BL-425): the step texts below are shared verbatim
// with BL-1267's and BL-1268's features, which drive the same CLI for
// different branches, and an unscoped registration resolves first-match
// across every handler file.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const FIXTURE_PREFIX = 'bl1193-acceptance-';
const TICKET_ID = 'BL-7700';

const FEATURE_NAME =
  "deprecator freshness gate's retired-token extractor names the retired item, not a co-occurring word";

// The live row, verbatim: its RETIRED marker names `type: bug`, while "Mint"
// sits two table columns away and is what the old extractor took.
const DOC_ROW =
  '| Mint hygiene (`backlog_hygiene_lib.bb`) | `type: bug` → `RETIRED-TICKET-TYPE … use type: defect` |';

function cliModule() {
  return require(path.join(EXT_DIR, 'out', 'tools', 'deprecate-check.js'));
}

// BL-971: sweep by prefix up front as well - a killed earlier run traps nothing.
function sweepStaleFixtures() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  }
}

const liveFixtures = new Set();
let exitHookInstalled = false;

function ensureRoot(ctx) {
  if (ctx.bl1193Root) {
    return ctx.bl1193Root;
  }
  sweepStaleFixtures();
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => {
      for (const dir of [...liveFixtures]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort on the way out */
        }
      }
    });
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  liveFixtures.add(root);
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  // The dependency, done - so the depends_on-all-done precondition the
  // retired-surface branch needs is genuinely met, not stubbed.
  fs.writeFileSync(path.join(root, 'backlog', 'done', 'BL-1-dep.yaml'), 'id: BL-1\n');
  ctx.bl1193Root = root;
  return root;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^the Article 3\.6 deprecator freshness gate is in force$/, (ctx) => {
    const cli = cliModule();
    for (const name of ['deprecateCheck', 'loadRetiredTokens', 'extractRetiredReferents']) {
      if (typeof cli[name] !== 'function') {
        throw new Error(`the freshness gate does not export ${name}`);
      }
    }
  });

  scoped(
    /^a docs line whose RETIRED marker names "([^"]+)" and which also contains the unrelated earlier word "([^"]+)"$/,
    (ctx, retiredItem, decoy) => {
      const root = ensureRoot(ctx);
      fs.mkdirSync(path.join(root, 'docs', 'how-to'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'how-to', 'BL-1095-retire.md'), `${DOC_ROW}\n`);
      if (!DOC_ROW.includes(retiredItem) || !DOC_ROW.includes(decoy)) {
        throw new Error(`the fixture doc row carries neither "${retiredItem}" nor "${decoy}": ${DOC_ROW}`);
      }
      // The row must genuinely mislead the OLD extractor, or the scenarios
      // prove nothing: the decoy has to sit earlier on the line than the
      // item the marker names.
      if (DOC_ROW.indexOf(decoy) > DOC_ROW.indexOf(retiredItem)) {
        throw new Error('the decoy does not precede the retired item - the fixture cannot reproduce the defect');
      }
      ctx.bl1193RetiredItem = retiredItem;
      ctx.bl1193Decoy = decoy;
    }
  );

  // ── 01 / 02 ─────────────────────────────────────────────────────────
  function writeTicket(ctx, description) {
    const root = ensureRoot(ctx);
    fs.writeFileSync(
      path.join(root, 'backlog', 'paused', `${TICKET_ID}-fixture.yaml`),
      `id: ${TICKET_ID}\ndepends_on: [BL-1]\ndescription: ${description}\n`
    );
  }

  scoped(
    /^a paused ticket whose depends_on are all done and whose description names "([^"]+)"$/,
    (ctx, text) => {
      writeTicket(ctx, `a slice that mentions ${text} in passing`);
    }
  );

  scoped(
    /^a paused ticket whose depends_on are all done and whose description names both "([^"]+)" and "([^"]+)"$/,
    (ctx, first, second) => {
      writeTicket(ctx, `the ${first} gate still promotes on ${second} candidates`);
    }
  );

  scoped(/^the deprecator freshness check runs for that ticket$/, (ctx) => {
    ctx.bl1193Decision = cliModule().deprecateCheck(ensureRoot(ctx), TICKET_ID);
  });

  scoped(/^the decision is "?(allow|hold)"?$/, (ctx, expected) => {
    if (ctx.bl1193Decision.decision !== expected) {
      throw new Error(
        `expected ${expected}, got ${ctx.bl1193Decision.decision}` +
          (ctx.bl1193Decision.reason ? ` (${ctx.bl1193Decision.reason})` : '')
      );
    }
  });

  scoped(/^the reason names "([^"]+)"$/, (ctx, text) => {
    const reason = ctx.bl1193Decision.reason || '';
    if (!reason.includes(text)) {
      throw new Error(`the reason does not name the retired item "${text}": ${reason}`);
    }
  });

  scoped(/^the reason does not name "([^"]+)"$/, (ctx, text) => {
    const reason = ctx.bl1193Decision.reason || '';
    if (new RegExp(`\\b${text}\\b`).test(reason)) {
      throw new Error(`the reason still names the co-occurring word "${text}": ${reason}`);
    }
  });
}

module.exports = { registerSteps };
