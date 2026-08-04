'use strict';

// BL-623: step handlers for "the routing skip trail records what a hop actually
// skipped". Drives the REAL swarm_handoff.bb send path — same fixture/send
// patterns as bl606RequiredStagesRoutingSteps.js — never reimplements routing
// in JS.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_HANDOFF = path.join(SWARMFORGE_SCRIPTS, 'swarm_handoff.bb');
const HANDOFF_PROTOCOL = path.join(REPO_ROOT, 'swarmforge', 'handoff-protocol.md');

const CANONICAL_CHAIN = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

const DEFAULT_SKIP_REASONS = [
  'stage_skip_reasons:',
  '  cleaner: not touched, config-only change',
  '  architect: no design impact',
  '  hardender: existing coverage suffices',
  '  documenter: no user-facing behavior change',
  '',
].join('\n');

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

// BL-761: every send in this file reuses the ONE commit captured below as
// `ctx.commit` - the acceptance-contract gate (the third pre-QA finding,
// sharing this same findings-for-git-handoff entry point) judges a
// ticket's declared acceptance: file AT that cited commit, so a resolvable,
// fully-covered contract has to be part of the very first commit, not
// added later - this suite tests required-stages routing, not acceptance
// contracts, and must stay orthogonal to a gate added afterward.
const ACCEPTANCE_FEATURE_PATH = 'specs/features/bl900-fixture.feature';
const ACCEPTANCE_STEP_TEXT = 'the fixture step is known';

function writeAcceptanceContractFixture(targetPath) {
  fs.mkdirSync(path.join(targetPath, 'specs', 'pipeline', 'steps'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'specs', 'pipeline', 'stepRegistry.js'), path.join(targetPath, 'specs', 'pipeline', 'stepRegistry.js'));
  fs.copyFileSync(path.join(REPO_ROOT, 'specs', 'pipeline', 'runtime.js'), path.join(targetPath, 'specs', 'pipeline', 'runtime.js'));
  fs.writeFileSync(
    path.join(targetPath, 'specs', 'pipeline', 'steps', 'index.js'),
    `'use strict';\nfunction registerSteps(registry) { registry.define(/^${ACCEPTANCE_STEP_TEXT}$/, () => {}); }\nmodule.exports = { registerSteps };\n`
  );
  const featurePath = path.join(targetPath, ACCEPTANCE_FEATURE_PATH);
  fs.mkdirSync(path.dirname(featurePath), { recursive: true });
  fs.writeFileSync(featurePath, `Feature: BL-900 fixture contract\n\n  Scenario: covered\n    Given ${ACCEPTANCE_STEP_TEXT}\n`);
  fs.mkdirSync(path.join(targetPath, 'swarmforge', 'vendor'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'swarmforge', 'vendor', 'aps'), path.join(targetPath, 'swarmforge', 'vendor', 'aps'), 'dir');
  fs.mkdirSync(path.join(targetPath, 'specs', 'pipeline', 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'resolve_contract_steps.js'),
    path.join(targetPath, 'specs', 'pipeline', 'scripts', 'resolve_contract_steps.js')
  );
}

function ensureFixture(ctx) {
  if (ctx.targetPath) return ctx.targetPath;
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl623-'));
  git(targetPath, ['init', '-q']);
  fs.writeFileSync(path.join(targetPath, 'README.md'), 'x');
  writeAcceptanceContractFixture(targetPath);
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
    `id: ${ticketId}\ntitle: "demo"\nstatus: active\nacceptance: ${ACCEPTANCE_FEATURE_PATH}\n${extraLines || ''}`
  );
}

function journalPath(ctx) {
  return path.join(ctx.targetPath, '.swarmforge', 'routing-skips.jsonl');
}

function journalLineCount(ctx) {
  const p = journalPath(ctx);
  if (!fs.existsSync(p)) return 0;
  const text = fs.readFileSync(p, 'utf8').trim();
  if (!text) return 0;
  return text.split('\n').filter(Boolean).length;
}

function readJournal(ctx) {
  const p = journalPath(ctx);
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').map((l) => JSON.parse(l));
}

function sendHandoff(ctx, { from, to, task, rejectionReason }) {
  ensureFixture(ctx);
  ctx.journalBefore = journalLineCount(ctx);
  const seq = (ctx._seq = (ctx._seq || 0) + 1);
  const draft = path.join(ctx.targetPath, `draft-${seq}.txt`);
  const lines = [
    'type: git_handoff',
    `to: ${to}`,
    'priority: 50',
    `task: ${task}`,
    `commit: ${ctx.commit}`,
  ];
  if (rejectionReason) {
    lines.splice(2, 0, `rejection_reason: ${rejectionReason}`);
  }
  fs.writeFileSync(draft, lines.join('\n') + '\n');
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
  const handoff = {
    to: toLine ? toLine.slice('to: '.length) : null,
    outfile,
    content,
  };
  ctx.lastHandoff = handoff;
  return handoff;
}

function routingSkippedLine(content) {
  return content.split('\n').find((l) => l.startsWith('routing_skipped: ')) || null;
}

function parseRoutingSkippedHeader(content) {
  const line = routingSkippedLine(content);
  if (!line) return null;
  const body = line.slice('routing_skipped: '.length);
  const skippedMatch = body.match(/ skipped=([^\s]*)/);
  const reasonsMatch = body.match(/ reasons=(.+)$/);
  const skipped = skippedMatch ? skippedMatch[1].split(',').filter(Boolean) : [];
  const reasons = {};
  if (reasonsMatch) {
    for (const part of reasonsMatch[1].split(';')) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      reasons[part.slice(0, idx)] = part.slice(idx + 1);
    }
  }
  return { line, body, skipped, reasons };
}

function skipRecord(ctx) {
  const parsed = parseRoutingSkippedHeader(ctx.lastHandoff.content);
  const journal = readJournal(ctx).find((e) => e['ticket-id'] === ctx.ticketId);
  return { header: parsed, journal };
}

function routingLogSection(text) {
  const marker = '### Reading the Routing Log';
  const start = text.indexOf(marker);
  if (start === -1) {
    throw new Error(`expected "${marker}" in handoff-protocol.md`);
  }
  const rest = text.slice(start);
  const nextHeading = rest.slice(marker.length).search(/\n## /);
  return nextHeading === -1 ? rest : rest.slice(0, marker.length + nextHeading);
}

function registerSteps(registry) {
  // ── Background / routing flag ────────────────────────────────────────────
  registry.define(/^required-stages routing is enabled$/, (ctx) => {
    ensureFixture(ctx);
    ctx.routingEnabled = true;
  });

  registry.define(/^required-stages routing is disabled$/, (ctx) => {
    ensureFixture(ctx);
    ctx.routingEnabled = false;
  });

  registry.define(/^an active ticket declaring required_stages and stage_skip_reasons$/, (ctx) => {
    ensureFixture(ctx);
    writeTicket(
      ctx,
      ctx.ticketId,
      ['required_stages: [coder, qa]', DEFAULT_SKIP_REASONS].join('\n')
    );
  });

  registry.define(/^the active ticket declares required_stages of coder and qa$/, (ctx) => {
    ensureFixture(ctx);
    writeTicket(
      ctx,
      ctx.ticketId,
      ['required_stages: [coder, qa]', DEFAULT_SKIP_REASONS].join('\n')
    );
  });

  registry.define(/^the active ticket declares the full canonical chain$/, (ctx) => {
    ensureFixture(ctx);
    writeTicket(
      ctx,
      ctx.ticketId,
      `required_stages: [${CANONICAL_CHAIN.join(', ')}]\n`
    );
  });

  registry.define(/^the active ticket declares required_stages of coder and cleaner and qa$/, (ctx) => {
    ensureFixture(ctx);
    writeTicket(
      ctx,
      ctx.ticketId,
      [
        'required_stages: [coder, cleaner, qa]',
        'stage_skip_reasons:',
        '  architect: no design impact',
        '',
      ].join('\n')
    );
  });

  // ── When: sends ──────────────────────────────────────────────────────────
  registry.define(/^the coder sends a git_handoff addressed directly to QA$/, (ctx) => {
    sendHandoff(ctx, { from: 'coder', to: 'QA', task: ctx.ticketId });
  });

  registry.define(/^the coder sends a git_handoff addressed to cleaner$/, (ctx) => {
    sendHandoff(ctx, { from: 'coder', to: 'cleaner', task: ctx.ticketId });
  });

  registry.define(/^the documenter sends a git_handoff addressed to QA$/, (ctx) => {
    sendHandoff(ctx, { from: 'documenter', to: 'QA', task: ctx.ticketId });
  });

  registry.define(/^QA sends a git_handoff bounce back to the coder with a rejection reason$/, (ctx) => {
    sendHandoff(ctx, {
      from: 'QA',
      to: 'coder',
      task: ctx.ticketId,
      rejectionReason: 'tests failed on the branch',
    });
  });

  // ── Then: delivery / header presence ─────────────────────────────────────
  registry.define(/^the delivered parcel carries a routing_skipped header$/, (ctx) => {
    if (!routingSkippedLine(ctx.lastHandoff.content)) {
      throw new Error(`expected a routing_skipped header, got:\n${ctx.lastHandoff.content}`);
    }
  });

  registry.define(/^the delivered parcel carries no routing_skipped header$/, (ctx) => {
    if (routingSkippedLine(ctx.lastHandoff.content)) {
      throw new Error(`expected no routing_skipped header, got:\n${ctx.lastHandoff.content}`);
    }
  });

  registry.define(/^the parcel is delivered to QA$/, (ctx) => {
    if (ctx.lastHandoff.to !== 'QA') {
      throw new Error(`expected delivery to QA, got ${ctx.lastHandoff.to}`);
    }
  });

  // ── Then: skip record content ────────────────────────────────────────────
  registry.define(
    /^the skip record names cleaner and architect and hardender and documenter as skipped$/,
    (ctx) => {
      const { header, journal } = skipRecord(ctx);
      if (!header) {
        throw new Error(`expected a routing_skipped header, got:\n${ctx.lastHandoff.content}`);
      }
      for (const stage of ['cleaner', 'architect', 'hardender', 'documenter']) {
        if (!header.skipped.includes(stage)) {
          throw new Error(`expected header skipped= to name ${stage}, got: ${header.line}`);
        }
        if (!journal || !Array.isArray(journal.skipped) || !journal.skipped.includes(stage)) {
          throw new Error(`expected ${stage} in journal.skipped, got: ${JSON.stringify(journal && journal.skipped)}`);
        }
      }
    }
  );

  registry.define(/^the skip record names cleaner among the skipped stages$/, (ctx) => {
    const { header, journal } = skipRecord(ctx);
    if (!header || !header.skipped.includes('cleaner')) {
      throw new Error(`expected cleaner in header skipped=, got: ${header && header.line}`);
    }
    if (!journal || !journal.skipped.includes('cleaner')) {
      throw new Error(`expected cleaner in journal.skipped, got: ${JSON.stringify(journal && journal.skipped)}`);
    }
  });

  registry.define(/^the skip record carries the ticket's declared reason for each skipped stage$/, (ctx) => {
    const { header, journal } = skipRecord(ctx);
    if (!header || !journal) {
      throw new Error('expected both header and journal skip records');
    }
    const expected = {
      cleaner: 'not touched, config-only change',
      architect: 'no design impact',
      hardender: 'existing coverage suffices',
      documenter: 'no user-facing behavior change',
    };
    for (const [stage, reason] of Object.entries(expected)) {
      if (header.reasons[stage] !== reason) {
        throw new Error(`expected header reason for ${stage} to be ${JSON.stringify(reason)}, got ${JSON.stringify(header.reasons[stage])}`);
      }
      if (journal.reasons[stage] !== reason) {
        throw new Error(`expected journal reason for ${stage} to be ${JSON.stringify(reason)}, got ${JSON.stringify(journal.reasons[stage])}`);
      }
    }
  });

  registry.define(/^the skip record carries no declared reason for cleaner$/, (ctx) => {
    const { header, journal } = skipRecord(ctx);
    if (header && header.reasons.cleaner !== undefined) {
      throw new Error(`expected no declared reason for cleaner in header, got: ${JSON.stringify(header.reasons.cleaner)}`);
    }
    if (journal && journal.reasons && journal.reasons.cleaner !== undefined) {
      throw new Error(`expected no declared reason for cleaner in journal, got: ${JSON.stringify(journal.reasons.cleaner)}`);
    }
  });

  registry.define(/^the skip record carries the ticket's declared reason for architect$/, (ctx) => {
    const { header, journal } = skipRecord(ctx);
    const expected = 'no design impact';
    if (!header || header.reasons.architect !== expected) {
      throw new Error(`expected architect reason ${JSON.stringify(expected)} in header, got ${JSON.stringify(header && header.reasons.architect)}`);
    }
    if (!journal || journal.reasons.architect !== expected) {
      throw new Error(`expected architect reason ${JSON.stringify(expected)} in journal, got ${JSON.stringify(journal && journal.reasons.architect)}`);
    }
  });

  // ── Then: journal append / no append ─────────────────────────────────────
  registry.define(/^a routing-skips journal line is appended for the ticket$/, (ctx) => {
    const after = journalLineCount(ctx);
    if (after <= (ctx.journalBefore || 0)) {
      throw new Error(`expected a new routing-skips.jsonl line (before=${ctx.journalBefore}, after=${after})`);
    }
    const entry = readJournal(ctx).find((e) => e['ticket-id'] === ctx.ticketId);
    if (!entry) {
      throw new Error(`expected a routing-skips.jsonl entry for ${ctx.ticketId}`);
    }
  });

  registry.define(/^no routing-skips journal line is appended$/, (ctx) => {
    const after = journalLineCount(ctx);
    if (after !== (ctx.journalBefore || 0)) {
      throw new Error(`expected no new routing-skips.jsonl line (before=${ctx.journalBefore}, after=${after})`);
    }
  });

  registry.define(/^no routing-skips journal line is appended for the ticket$/, (ctx) => {
    const entry = readJournal(ctx).find((e) => e['ticket-id'] === ctx.ticketId);
    if (entry) {
      throw new Error(`expected no routing-skips.jsonl entry for ${ctx.ticketId}, got: ${JSON.stringify(entry)}`);
    }
  });

  // ── Scenario 07: documentation shapes ────────────────────────────────────
  registry.define(/^the shipped repository documentation$/, () => {});

  registry.define(/^the routing-skips section of the handoff protocol is read$/, (ctx) => {
    ctx.routingLogDoc = routingLogSection(fs.readFileSync(HANDOFF_PROTOCOL, 'utf8'));
  });

  registry.define(/^its journal example uses the emitted field names$/, (ctx) => {
    const section = ctx.routingLogDoc;
    const jsonMatch = section.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      throw new Error('expected a JSON journal example in the routing log section');
    }
    const example = JSON.parse(jsonMatch[1]);
    for (const key of ['ticket-id', 'from', 'to', 'skipped', 'reasons', 'sender', 'created_at']) {
      if (!(key in example)) {
        throw new Error(`expected journal example to include emitted key "${key}", got: ${JSON.stringify(Object.keys(example))}`);
      }
    }
    if ('ticket' in example || 'commit' in example || 'at' in example || 'reason' in example) {
      throw new Error(`journal example still uses stale keys: ${JSON.stringify(Object.keys(example))}`);
    }
  });

  registry.define(/^its header example uses the emitted header grammar$/, (ctx) => {
    const section = ctx.routingLogDoc;
    const match = section.match(/routing_skipped:\s*([^\n`]+)/);
    if (!match) {
      throw new Error('expected a routing_skipped header example using ticket-id from->to skipped= grammar');
    }
    const body = match[1].trim();
    if (!/^\S+\s+\S+->\S+\s+skipped=[^\s]+(\s+reasons=.+)?$/.test(body)) {
      throw new Error(`header example does not match format-routing-skipped grammar: ${body}`);
    }
  });

  registry.define(/^its grep example matches a real emitted journal line$/, (ctx) => {
    const section = ctx.routingLogDoc;
    const grepLine = section.split('\n').find((l) => l.trim().startsWith('grep '));
    if (!grepLine) {
      throw new Error('expected a grep example in the routing log section');
    }
    const patternMatch = grepLine.match(/grep\s+'([^']+)'/);
    if (!patternMatch) {
      throw new Error(`could not parse grep pattern from: ${grepLine}`);
    }
    const pattern = patternMatch[1];
    const sample = JSON.stringify({
      'ticket-id': 'BL-042',
      from: 'coder',
      to: 'QA',
      skipped: ['cleaner', 'architect', 'hardender', 'documenter'],
      reasons: { cleaner: 'style-only' },
      sender: 'coder',
      created_at: '2026-07-23T14:30:15Z',
    });
    if (!sample.includes(pattern.replace(/\\/g, ''))) {
      throw new Error(`grep pattern ${JSON.stringify(pattern)} does not match a real emitted line: ${sample}`);
    }
  });
}

module.exports = { registerSteps };
