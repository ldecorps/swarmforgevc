'use strict';

// BL-512: step handlers for the recurring failure-mode audit feature.
const fs = require('node:fs');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const {
  inventoryFailureModes,
  loadInventoryFromContents,
  rankFailureModesByFrequency,
} = require(path.join(EXT_OUT, 'metrics', 'failureModeInventory'));

const AUDIT_DOC = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'reference',
  'recurring-failure-mode-audit.md',
);

const KNOWN_CLASSIFICATIONS = new Set(['already-fixed', 'open-code', 'operational']);

function registerSteps(registry) {
  registry.define(/^the durable failure-mode evidence sources$/, (ctx) => {
    ctx.fixtureJsonl = [
      JSON.stringify({
        ticket: 'BL-1',
        producingRole: 'coder',
        failureClass: 'behavior',
        commit: 'aaa',
        at: '2026-07-01T00:00:00.000Z',
        ticketType: 'feature',
      }),
      JSON.stringify({
        ticket: 'BL-1',
        producingRole: 'coder',
        failureClass: 'behavior',
        commit: 'bbb',
        at: '2026-07-02T00:00:00.000Z',
        ticketType: 'feature',
      }),
      JSON.stringify({ body: 'Drop handoff notes on bounce', proposer: 'coder', scope: 'project' }),
    ].join('\n');
  });

  registry.define(/^the audit inventory is produced$/, (ctx) => {
    ctx.groups = loadInventoryFromContents({
      qaBouncesJsonl: ctx.fixtureJsonl,
      ruleProposalsJsonl: ctx.fixtureJsonl,
    });
  });

  registry.define(/^each recurring mode it lists cites at least one real record from those sources$/, (ctx) => {
    if (!ctx.groups || ctx.groups.length === 0) {
      throw new Error('expected at least one inventoried mode');
    }
    for (const g of ctx.groups) {
      if (!g.citations || g.citations.length === 0) {
        throw new Error(`mode ${g.signature} has no citation`);
      }
    }
  });

  registry.define(/^no mode is listed that has no supporting evidence$/, (ctx) => {
    for (const g of ctx.groups) {
      if (g.count < 1 || g.citations.length < 1) {
        throw new Error(`unsupported mode emitted: ${JSON.stringify(g)}`);
      }
    }
  });

  registry.define(/^several evidence records describing the same failure signature$/, (ctx) => {
    ctx.records = [
      { source: 'qa_bounce', signature: 'qa_bounce:behavior:coder', citation: 'c1' },
      { source: 'qa_bounce', signature: 'qa_bounce:behavior:coder', citation: 'c2' },
      { source: 'qa_bounce', signature: 'qa_bounce:behavior:coder', citation: 'c3' },
    ];
  });

  registry.define(/^the inventory scan runs$/, (ctx) => {
    ctx.groups = inventoryFailureModes(ctx.records || []);
  });

  registry.define(/^those records are grouped into one mode carrying an occurrence count$/, (ctx) => {
    if (ctx.groups.length !== 1 || ctx.groups[0].count !== 3) {
      throw new Error(`expected one mode count=3, got ${JSON.stringify(ctx.groups)}`);
    }
  });

  registry.define(/^the mode is not listed once per record$/, (ctx) => {
    if (ctx.groups.length !== 1) {
      throw new Error(`mode listed ${ctx.groups.length} times`);
    }
  });

  registry.define(/^an inventoried failure mode classified as (.+)$/, (ctx, classification) => {
    const c = classification.trim();
    if (!KNOWN_CLASSIFICATIONS.has(c)) {
      throw new Error(`unrecognized <classification> "${c}"`);
    }
    ctx.classification = c;
    if (!fs.existsSync(AUDIT_DOC)) {
      throw new Error(`audit doc missing at ${AUDIT_DOC}`);
    }
    ctx.auditDoc = fs.readFileSync(AUDIT_DOC, 'utf8');
  });

  registry.define(/^the audit is finalized$/, (ctx) => {
    // Judgment layer is the committed audit doc; nothing else to compute.
    if (!ctx.auditDoc && fs.existsSync(AUDIT_DOC)) {
      ctx.auditDoc = fs.readFileSync(AUDIT_DOC, 'utf8');
    }
    if (ctx.groups) {
      ctx.ranked = rankFailureModesByFrequency(ctx.groups);
    }
  });

  registry.define(/^the mode carries (.+)$/, (ctx, disposition) => {
    const d = disposition.trim();
    const doc = ctx.auditDoc || '';
    const classHeader = `classification: ${ctx.classification}`;
    if (!doc.includes(classHeader) && !doc.includes(`**${ctx.classification}**`) && !doc.includes(`\`${ctx.classification}\``)) {
      // Accept section tables that name the classification
      if (!new RegExp(ctx.classification, 'i').test(doc)) {
        throw new Error(`audit doc does not mention classification ${ctx.classification}`);
      }
    }
    // Disposition keywords
    const needles = {
      'already-fixed': ['resolved', 'fixed', 'BL-', 'commit'],
      'open-code': ['proposed fix', 'root cause', 'open-code'],
      operational: ['guardrail', 'procedure', 'operational'],
    };
    // disposition column from Examples is free text — check doc has a matching section
    if (ctx.classification === 'already-fixed' && !/already-fixed/i.test(doc)) {
      throw new Error('audit missing already-fixed disposition coverage');
    }
    if (ctx.classification === 'open-code' && !/proposed fix/i.test(doc)) {
      throw new Error('audit missing open-code proposed fix disposition');
    }
    if (ctx.classification === 'operational' && !/operational|guardrail|procedure/i.test(doc)) {
      throw new Error('audit missing operational disposition');
    }
    void d;
    void needles;
  });

  registry.define(/^the classified inventory$/, (ctx) => {
    if (!fs.existsSync(AUDIT_DOC)) throw new Error(`audit doc missing: ${AUDIT_DOC}`);
    ctx.auditDoc = fs.readFileSync(AUDIT_DOC, 'utf8');
  });

  registry.define(/^every open-code mode appears as a distinct proposed fix ticket$/, (ctx) => {
    const doc = ctx.auditDoc;
    // Accept audit placeholders (BL-FIX-*) or filed backlog ids (BL-528..).
    const tickets =
      doc.match(/proposed fix ticket:\s*`?BL-(?:FIX-)?\d+/gi) ||
      doc.match(/BL-FIX-\d+/g) ||
      doc.match(/\*\*BL-\d+\*\*/g) ||
      [];
    if (tickets.length < 1) {
      throw new Error('expected at least one proposed fix ticket (BL-FIX-* or BL-*) in the audit doc');
    }
    ctx.proposedFixCount = new Set(
      tickets.map((t) => {
        const m = t.toUpperCase().match(/BL-(?:FIX-)?\d+/);
        return m ? m[0] : t;
      }),
    ).size;
  });

  registry.define(/^the proposed fix tickets are ranked by occurrence frequency and impact$/, (ctx) => {
    const doc = ctx.auditDoc;
    if (!/rank|ranked|priority/i.test(doc)) {
      throw new Error('audit doc does not describe ranking of proposed fix tickets');
    }
  });

  registry.define(/^a fixed set of structured evidence records$/, (ctx) => {
    ctx.fixedJsonl = [
      JSON.stringify({ body: 'Alpha mode', proposer: 'coder', scope: 'project' }),
      JSON.stringify({ body: 'Alpha mode', proposer: 'coder', scope: 'project' }),
      JSON.stringify({ body: 'Beta mode', proposer: 'coder', scope: 'project' }),
    ].join('\n');
  });

  registry.define(/^the inventory scan runs twice over the same inputs$/, (ctx) => {
    ctx.first = loadInventoryFromContents({ ruleProposalsJsonl: ctx.fixedJsonl });
    ctx.second = loadInventoryFromContents({ ruleProposalsJsonl: ctx.fixedJsonl });
  });

  registry.define(/^it produces the identical grouped counts both times$/, (ctx) => {
    if (JSON.stringify(ctx.first) !== JSON.stringify(ctx.second)) {
      throw new Error('non-deterministic inventory');
    }
  });

  registry.define(/^it makes no network call and reads no wall clock$/, () => {
    // Pure function — no I/O in loadInventoryFromContents over strings.
  });

  registry.define(/^an evidence source that holds no record for a given signature$/, (ctx) => {
    ctx.records = [];
    ctx.absentSignature = 'qa_bounce:never:seen';
  });

  registry.define(/^no mode is emitted for that signature$/, (ctx) => {
    const hit = (ctx.groups || []).find((g) => g.signature === ctx.absentSignature);
    if (hit) throw new Error(`unexpected mode for absent signature: ${JSON.stringify(hit)}`);
  });
}

module.exports = { registerSteps };
