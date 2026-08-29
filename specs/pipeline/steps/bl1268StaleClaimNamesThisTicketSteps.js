'use strict';

// BL-1268: step handlers for "the freshness gate's generic-claim branch fires
// on a claim about this ticket, not any prose mention". Drives the testable
// module - extension/out/tools/deprecate-check.js - against ticket YAML
// fixtures written into a temp root, never the live backlog. Compiled output
// only: run `npm run compile` in extension/ first.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const FIXTURE_PREFIX = 'bl1268-acceptance-';
const TICKET_ID = 'BL-4242';

function deprecateCheckModule() {
  return require(path.join(EXT_DIR, 'out', 'tools', 'deprecate-check.js'));
}

// BL-971: a killed earlier run traps nothing, so sweep by prefix up front as
// well as removing this run's own fixture on the way out.
function sweepStaleFixtures() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  }
}

const liveFixtures = new Set();
let exitHookInstalled = false;

function ensureFixtureRoot(ctx) {
  if (!ctx.bl1268Root) {
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
    ctx.bl1268Root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
    liveFixtures.add(ctx.bl1268Root);
    ctx.bl1268Cleanup = () => {
      liveFixtures.delete(ctx.bl1268Root);
      fs.rmSync(ctx.bl1268Root, { recursive: true, force: true });
    };
  }
  return ctx.bl1268Root;
}

// The claim shapes the Examples table names, each written the way a real
// ticket writes it: a cross-reference sits in notes and names the OTHER
// ticket; a self-claim states this ticket's own disposition.
const CLAIM_SHAPES = {
  'a notes line saying another ticket was superseded':
    'notes: |\n  Related: BL-900 was superseded by BL-901 on 2026-08-01, which is\n  why this slice reads the newer surface.\n',
  "a notes line saying another ticket's logic was retired":
    'notes: |\n  Background: BL-900 had its dead logic retired in BL-901; nothing here\n  depends on it any more.\n',
  'a closed_as field naming this ticket as superseded-by': `closed_as: superseded-by-BL-901\n`,
  'a description sentence calling this ticket itself obsolete':
    'description: |\n  This ticket is obsolete now that the surface it targets is gone.\n',
};

function writeTicket(root, folder, id, body) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), body);
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^the Article 3\.6 deprecator freshness gate is in force$/, (ctx) => {
    const module = deprecateCheckModule();
    for (const name of ['deprecateCheck', 'evaluateDeprecatorFreshness', 'findSelfClaim']) {
      if (typeof module[name] !== 'function') {
        throw new Error(`the freshness gate does not export ${name}`);
      }
    }
    ctx.bl1268Module = module;
  });

  // ── claim-must-name-this-ticket-01 / reason-names-the-claim-it-found-03 ──
  registry.define(/^a paused ticket whose text carries "(.+)"$/, (ctx, shape) => {
    const body = CLAIM_SHAPES[shape];
    if (!body) {
      throw new Error(
        `unknown claim shape "${shape}"; the handler knows: ${Object.keys(CLAIM_SHAPES).join(' | ')}`
      );
    }
    ctx.bl1268Ticket = `id: ${TICKET_ID}\ntitle: "fixture"\nstatus: todo\n${body}`;
    writeTicket(ensureFixtureRoot(ctx), 'paused', TICKET_ID, ctx.bl1268Ticket);
  });

  // ── recorded-adjudication-is-not-a-self-claim-02 ─────────────────────
  registry.define(
    /^a paused ticket whose only claim words appear inside a recorded deprecator adjudication$/,
    (ctx) => {
      ctx.bl1268Ticket = [
        `id: ${TICKET_ID}`,
        'title: "fixture"',
        'status: todo',
        'notes: |',
        '  [2026-08-29] specifier, freshness adjudication: the hold cited a notes',
        '  line naming BL-900, whose scenarios were retired when BL-901 superseded',
        '  it. That is a cross-reference to another ticket, not a claim about this',
        '  one; promote confirmed.',
        '',
      ].join('\n');
      writeTicket(ensureFixtureRoot(ctx), 'paused', TICKET_ID, ctx.bl1268Ticket);
    }
  );

  registry.define(/^its backlog\/done\/ closure is "(absent|present)"$/, (ctx, closure) => {
    const root = ensureFixtureRoot(ctx);
    const doneDir = path.join(root, 'backlog', 'done');
    fs.mkdirSync(doneDir, { recursive: true });
    if (closure === 'present') {
      writeTicket(root, 'done', TICKET_ID, `id: ${TICKET_ID}\nstatus: done\n`);
    }
  });

  registry.define(/^the deprecator freshness check runs for that ticket$/, (ctx) => {
    ctx.bl1268Decision = deprecateCheckModule().deprecateCheck(ensureFixtureRoot(ctx), TICKET_ID);
  });

  registry.define(/^the decision is "?(allow|hold)"?$/, (ctx, expected) => {
    if (ctx.bl1268Decision.decision !== expected) {
      throw new Error(
        `expected ${expected} but the gate answered ${ctx.bl1268Decision.decision}` +
          (ctx.bl1268Decision.reason ? ` (${ctx.bl1268Decision.reason})` : '') +
          ` for ticket:\n${ctx.bl1268Ticket}`
      );
    }
  });

  registry.define(/^the reason names the field carrying the claim$/, (ctx) => {
    const reason = ctx.bl1268Decision.reason || '';
    const field = (ctx.bl1268Ticket.match(/^([a-z_]+):/m) && ctx.bl1268Ticket.includes('closed_as:'))
      ? 'closed_as'
      : null;
    if (!field) {
      throw new Error(`the fixture carries no structured claim field to name:\n${ctx.bl1268Ticket}`);
    }
    if (!reason.includes(`'${field}'`)) {
      throw new Error(`the hold reason does not name the field carrying the claim: ${reason}`);
    }
  });
}

module.exports = { registerSteps };
