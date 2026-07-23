'use strict';

// BL-606: step handlers for "the specifier declares required_stages and the
// handoff layer routes a ticket only through those stages". Drives the REAL
// swarm_handoff.bb send path (for the routing/rewrite scenarios) and the
// real required_stages_lib.bb pure functions via `bb -e` (for the
// decision/reporting scenarios) - the same two patterns backlogDepthSteps.js
// and routingManifestFieldSteps.js already establish. Never reimplements the
// routing/validation logic in JS.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SWARMFORGE_SCRIPTS, 'swarm_handoff.bb');
const REQUIRED_STAGES_LIB = path.join(SWARMFORGE_SCRIPTS, 'required_stages_lib.bb');

const CANONICAL_CHAIN = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const CHAIN_HOPS = [
  ['coder', 'cleaner'],
  ['cleaner', 'architect'],
  ['architect', 'hardender'],
  ['hardender', 'documenter'],
  ['documenter', 'QA'],
];

// declaration text (Examples column, already trimmed by the parser) -> the
// required_stages line to write into the ticket yaml, or null for "absent"
// (no line at all).
const DECLARATION_TO_LINE = {
  absent: null,
  'an empty list': 'required_stages: []',
  'a non-list scalar': 'required_stages: coder',
  '[coder, cleaner, qa]': 'required_stages: [coder, cleaner, qa]',
  '[coder, qa]': 'required_stages: [coder, qa]',
  'a list naming a stage outside the chain': 'required_stages: [coder, deploy, qa]',
  'a list naming specifier or coordinator': 'required_stages: [specifier, coder, qa]',
  'a list containing a duplicate stage': 'required_stages: [coder, coder, qa]',
  '[documenter]': 'required_stages: [documenter]',
  '[coder, cleaner]': 'required_stages: [coder, cleaner]',
};

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function writeRolesTsv(root) {
  const roles = [
    ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ['specifier', 'master', root, 'swarmforge-specifier', 'Specifier', 'claude', 'task'],
    ['coder', 'coder', root, 'swarmforge-coder', 'Coder', 'claude', 'task'],
    ['cleaner', 'cleaner', root, 'swarmforge-cleaner', 'Cleaner', 'claude', 'batch'],
    ['architect', 'architect', root, 'swarmforge-architect', 'Architect', 'claude', 'task'],
    ['hardender', 'hardender', root, 'swarmforge-hardender', 'Hardender', 'claude', 'batch'],
    ['documenter', 'documenter', root, 'swarmforge-documenter', 'Documenter', 'claude', 'task'],
    ['QA', 'QA', root, 'swarmforge-QA', 'Qa', 'claude', 'task'],
  ];
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), roles.map((r) => r.join('\t')).join('\n') + '\n');
}

function ensureFixture(ctx) {
  if (ctx.targetPath) return ctx.targetPath;
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl606-'));
  git(targetPath, ['init', '-q']);
  fs.writeFileSync(path.join(targetPath, 'README.md'), 'x');
  git(targetPath, ['add', '.']);
  git(targetPath, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
  ctx.commit = execFileSync('git', ['-C', targetPath, 'rev-parse', '--short=10', 'HEAD'], { encoding: 'utf8' }).trim();
  writeRolesTsv(targetPath);
  fs.mkdirSync(path.join(targetPath, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, 'swarmforge', 'swarmforge.conf'),
    'config required_stages_routing_enabled false\n'
  );
  ctx.targetPath = targetPath;
  ctx.ticketId = 'BL-900';
  return targetPath;
}

function writeTicket(ctx, ticketId, extraLines) {
  const dir = path.join(ctx.targetPath, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${ticketId}-demo.yaml`),
    `id: ${ticketId}\ntitle: "demo"\nstatus: active\n${extraLines || ''}`
  );
}

function ticketContent(ctx, ticketId) {
  const dir = path.join(ctx.targetPath, 'backlog', 'active');
  const file = fs.readdirSync(dir).find((f) => f.startsWith(`${ticketId}-`));
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// Sends a real git_handoff via the real swarm_handoff.bb, honoring
// ctx.routingEnabled (defaults true per the feature's own Background).
// Returns {to, outfile} - the delivered envelope's own `to:` recipient and
// the installed handoff file's path (for header/trail inspection).
function sendHandoff(ctx, { from, to, task }) {
  ensureFixture(ctx);
  const seq = (ctx._seq = (ctx._seq || 0) + 1);
  const draft = path.join(ctx.targetPath, `draft-${seq}.txt`);
  fs.writeFileSync(draft, `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${task}\ncommit: ${ctx.commit}\n`);
  const env = { ...process.env, SWARMFORGE_ROLE: from, SWARMFORGE_SKIP_SYNC_INJECT: '1' };
  if (ctx.routingEnabled !== false) {
    env.SWARMFORGE_REQUIRED_STAGES_ROUTING = '1';
  } else {
    delete env.SWARMFORGE_REQUIRED_STAGES_ROUTING;
  }
  const result = spawnSync('bb', [SWARM_HANDOFF, `draft-${seq}.txt`], { cwd: ctx.targetPath, encoding: 'utf8', env });
  const out = (result.stdout || '') + (result.stderr || '');
  const match = out.match(/:(\/[^\n]*\.handoff)/);
  if (!match) {
    throw new Error(`swarm_handoff.bb did not report an installed handoff file: ${out}`);
  }
  const outfile = match[1];
  const content = fs.readFileSync(outfile, 'utf8');
  const toLine = content.split('\n').find((l) => l.startsWith('to: '));
  return { to: toLine ? toLine.slice('to: '.length) : null, outfile, content };
}

function runFullChain(ctx) {
  ctx.hops = CHAIN_HOPS.map(([from, literalTo]) => {
    const { to } = sendHandoff(ctx, { from, to: literalTo, task: ctx.ticketId });
    return { from, literalTo, actualTo: to };
  });
}

function bbEval(expr) {
  return execFileSync('bb', ['-e', `(load-file "${REQUIRED_STAGES_LIB}") ${expr}`], { encoding: 'utf8' }).trim();
}

function edn(content) {
  return `"${content.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function resolveEffective(ctx, ticketId) {
  const content = ticketContent(ctx, ticketId);
  const out = bbEval(
    `(let [d (required-stages-lib/resolve-effective (required-stages-lib/read-required-stages ${edn(content)}))]
       (println (:rejected? d))
       (println (name (:qa-omission d)))
       (println (clojure.string/join "," (:effective d))))`
  );
  const [rejectedLine, qaOmissionLine, effectiveLine] = out.split('\n');
  return {
    rejected: rejectedLine === 'true',
    qaOmission: qaOmissionLine,
    effective: effectiveLine ? effectiveLine.split(',').filter(Boolean) : [],
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────────
  registry.define(/^required_stages routing is enabled$/, (ctx) => {
    ensureFixture(ctx);
    ctx.routingEnabled = true;
  });

  registry.define(/^required_stages routing is disabled$/, (ctx) => {
    ensureFixture(ctx);
    ctx.routingEnabled = false;
  });

  // ── shared Given: an active ticket declaring required_stages ────────────
  registry.define(/^an active ticket whose required_stages is (.+)$/, (ctx, declaration) => {
    ensureFixture(ctx);
    if (!(declaration in DECLARATION_TO_LINE)) {
      throw new Error(`no fixture mapping for declaration: ${JSON.stringify(declaration)}`);
    }
    const line = DECLARATION_TO_LINE[declaration];
    writeTicket(ctx, ctx.ticketId, line ? `${line}\n` : '');
  });

  // ── scenario 01 / 04: "the ticket runs the pipeline" ─────────────────────
  registry.define(/^the ticket runs the pipeline$/, (ctx) => {
    ctx.decision = resolveEffective(ctx, ctx.ticketId);
    runFullChain(ctx);
  });

  registry.define(/^the parcel is routed through every canonical stage in order$/, (ctx) => {
    for (const hop of ctx.hops) {
      if (hop.actualTo !== hop.literalTo) {
        throw new Error(
          `expected the full canonical chain (no rewrite) at ${hop.from}->${hop.literalTo}, got ${hop.actualTo}`
        );
      }
    }
  });

  registry.define(/^the declaration is rejected as invalid$/, (ctx) => {
    if (!ctx.decision.rejected) {
      throw new Error(`expected the declaration to be rejected, got: ${JSON.stringify(ctx.decision)}`);
    }
  });

  // ── scenario 02: strict subset routing ───────────────────────────────────
  registry.define(/^the coder forwards the parcel$/, (ctx) => {
    const { to } = sendHandoff(ctx, { from: 'coder', to: 'cleaner', task: ctx.ticketId });
    ctx.lastTo = to;
  });

  registry.define(/^the next stage to receive the parcel is (.+)$/, (ctx, expected) => {
    if (ctx.lastTo !== expected) {
      throw new Error(`expected the next stage to be ${expected}, got ${ctx.lastTo}`);
    }
  });

  registry.define(/^when the cleaner forwards the parcel the next stage to receive it is (.+)$/, (ctx, expected) => {
    const { to } = sendHandoff(ctx, { from: 'cleaner', to: 'architect', task: ctx.ticketId });
    ctx.lastTo = to;
    if (to !== expected) {
      throw new Error(`expected the cleaner's forward to land on ${expected}, got ${to}`);
    }
  });

  registry.define(/^architect, hardender and documenter never receive a handoff for that ticket$/, (ctx) => {
    const outboxDir = path.join(ctx.targetPath, '.swarmforge', 'handoffs', 'outbox');
    const files = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir) : [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(outboxDir, file), 'utf8');
      if (!content.includes(`task: ${ctx.ticketId}`)) continue;
      const toLine = content.split('\n').find((l) => l.startsWith('to: '));
      const to = toLine ? toLine.slice('to: '.length) : '';
      if (['architect', 'hardender', 'documenter'].includes(to)) {
        throw new Error(`expected no handoff to ${to} for ${ctx.ticketId}, found one in ${file}`);
      }
    }
  });

  // ── scenario 03: skip recording ──────────────────────────────────────────
  registry.define(/^the specifier recorded a skip reason for the omitted stages$/, (ctx) => {
    writeTicket(
      ctx,
      ctx.ticketId,
      [
        'required_stages: [coder, qa]',
        'stage_skip_reasons:',
        '  cleaner: not touched, config-only change',
        '  architect: no design impact',
        '  hardender: existing coverage suffices',
        '  documenter: no user-facing behavior change',
        '',
      ].join('\n')
    );
    // A control ticket with no declaration at all, in the SAME fixture -
    // proves a skip is DISTINGUISHABLE from a genuine completed pass (see
    // the "skipped-stage lineage" step below), not just present in isolation.
    writeTicket(ctx, 'BL-901', '');
  });

  registry.define(/^the coder forwards the parcel toward the next required stage$/, (ctx) => {
    ctx.skipHandoff = sendHandoff(ctx, { from: 'coder', to: 'cleaner', task: ctx.ticketId });
    ctx.controlHandoff = sendHandoff(ctx, { from: 'coder', to: 'cleaner', task: 'BL-901' });
  });

  registry.define(/^the routing record names each skipped stage and its stated reason$/, (ctx) => {
    const line = ctx.skipHandoff.content.split('\n').find((l) => l.startsWith('routing_skipped: '));
    if (!line) {
      throw new Error(`expected a routing_skipped header, got:\n${ctx.skipHandoff.content}`);
    }
    for (const stage of ['cleaner', 'architect', 'hardender', 'documenter']) {
      if (!line.includes(stage)) {
        throw new Error(`expected routing_skipped to name ${stage}, got: ${line}`);
      }
    }
    const jsonlPath = path.join(ctx.targetPath, '.swarmforge', 'routing-skips.jsonl');
    const jsonl = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const entry = jsonl.find((e) => e['ticket-id'] === ctx.ticketId);
    if (!entry) throw new Error(`expected a routing-skips.jsonl entry for ${ctx.ticketId}`);
    for (const stage of ['cleaner', 'architect', 'hardender', 'documenter']) {
      if (entry.reasons[stage] === undefined) {
        throw new Error(`expected a stated reason for ${stage}, got: ${JSON.stringify(entry.reasons)}`);
      }
    }
  });

  registry.define(/^a skipped-stage lineage is distinguishable from a completed-stage lineage after the fact$/, (ctx) => {
    const skipHasHeader = ctx.skipHandoff.content.includes('routing_skipped: ');
    const controlHasHeader = ctx.controlHandoff.content.includes('routing_skipped: ');
    if (!skipHasHeader) throw new Error('expected the skipped-stage handoff to carry a routing_skipped header');
    if (controlHasHeader) {
      throw new Error('expected the control (no-declaration) handoff to carry NO routing_skipped header');
    }
  });

  // ── scenario 05: QA/coder omission rule ──────────────────────────────────
  registry.define(/^the ticket runs without QA as a declared non-code ticket$/, (ctx) => {
    if (ctx.decision.rejected) throw new Error(`expected acceptance, got rejected: ${JSON.stringify(ctx.decision)}`);
    if (ctx.decision.effective.includes('QA')) {
      throw new Error(`expected QA omitted from the effective set, got: ${JSON.stringify(ctx.decision.effective)}`);
    }
  });

  registry.define(/^the ticket is rejected and runs the full canonical chain with QA$/, (ctx) => {
    if (!ctx.decision.rejected) throw new Error(`expected the declaration to be rejected, got: ${JSON.stringify(ctx.decision)}`);
    for (const stage of CANONICAL_CHAIN) {
      if (!ctx.decision.effective.includes(stage)) {
        throw new Error(`expected the full canonical chain (with QA), missing ${stage}: ${JSON.stringify(ctx.decision.effective)}`);
      }
    }
  });

  registry.define(/^the QA omission decision is logged loudly$/, (ctx) => {
    if (ctx.decision.qaOmission !== 'accepted' && ctx.decision.qaOmission !== 'rejected') {
      throw new Error(`expected an explicit accepted/rejected QA-omission record, got: ${ctx.decision.qaOmission}`);
    }
  });

  // ── scenario 06: next-required-stage pure function ──────────────────────
  registry.define(/^the required_stages set (.+)$/, (ctx, raw) => {
    ctx.requiredSetRaw = raw;
  });

  registry.define(/^the next required stage after (.+) is resolved$/, (ctx, current) => {
    const out = bbEval(
      `(println (required-stages-lib/next-required-stage (required-stages-lib/parse ${edn(ctx.requiredSetRaw)}) ${edn(current)}))`
    );
    ctx.resolvedNext = out.trim();
  });

  registry.define(/^the resolved next stage is (.+)$/, (ctx, expected) => {
    const expectedValue = expected === 'none' ? 'nil' : expected;
    if (ctx.resolvedNext !== expectedValue) {
      throw new Error(`expected next-required-stage to resolve to ${expectedValue}, got ${ctx.resolvedNext}`);
    }
  });

  // ── scenario 07: kill-switch off ────────────────────────────────────────
  registry.define(/^the cleaner forwards the parcel$/, (ctx) => {
    const { to } = sendHandoff(ctx, { from: 'cleaner', to: 'architect', task: ctx.ticketId });
    ctx.lastTo = to;
  });

  // ── scenario 08: completed-ticket ran-vs-skipped visibility ─────────────
  registry.define(/^a completed ticket that ran with required_stages \[coder, qa\]$/, (ctx) => {
    ensureFixture(ctx);
    writeTicket(ctx, ctx.ticketId, 'required_stages: [coder, qa]\nstatus: done\n');
  });

  registry.define(/^the ran-and-skipped stages for that ticket are reported$/, (ctx) => {
    const content = ticketContent(ctx, ctx.ticketId);
    const out = bbEval(
      `(let [r (required-stages-lib/ran-and-skipped ${edn(content)})]
         (println (clojure.string/join "," (:ran r)))
         (println (clojure.string/join "," (:skipped r))))`
    );
    const [ranLine, skippedLine] = out.split('\n');
    ctx.report = {
      ran: ranLine ? ranLine.split(',').filter(Boolean) : [],
      skipped: skippedLine ? skippedLine.split(',').filter(Boolean) : [],
    };
  });

  registry.define(/^the report names coder and QA as run$/, (ctx) => {
    if (!ctx.report.ran.includes('coder') || !ctx.report.ran.includes('QA')) {
      throw new Error(`expected coder and QA in ran, got: ${JSON.stringify(ctx.report.ran)}`);
    }
  });

  registry.define(/^names cleaner, architect, hardender and documenter as skipped-by-routing$/, (ctx) => {
    for (const stage of ['cleaner', 'architect', 'hardender', 'documenter']) {
      if (!ctx.report.skipped.includes(stage)) {
        throw new Error(`expected ${stage} in skipped, got: ${JSON.stringify(ctx.report.skipped)}`);
      }
    }
  });

  registry.define(/^the answer is derived from the recorded trail, not inferred from the code diff$/, (ctx) => {
    if (!ctx.report) throw new Error('expected a ran/skipped report to have been computed');
  });
}

module.exports = { registerSteps };
