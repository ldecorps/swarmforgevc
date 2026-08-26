'use strict';

// BL-1147: step handlers for legacy topic adoption probe + cursor re-adopt.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { probeLegacyTopicAdoption } = require(path.join(EXT_DIR, 'out', 'tools', 'probeLegacyTopicAdoption'));
const { openSubjectAndRecord } = require(path.join(EXT_DIR, 'out', 'tools', 'telegram-front-desk-bot'));
const { OPERATOR_SUBJECT_ID } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));

const FEATURE = 'Probe legacy topic adoption paths on disk without mutating maps or calling Telegram';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1147-'));
}

function ensureCtx(ctx) {
  ctx.fixtureRoot = ctx.fixtureRoot || mkFixtureRoot();
  return ctx;
}

function operatorDir(root) {
  return path.join(root, '.swarmforge', 'operator');
}

function writeJson(root, relPath, value) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(value));
}

function writeSwarmEnv(root, provider) {
  const dir = path.join(root, '.swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  const line =
    provider === undefined || provider === ''
      ? '# no SWARMFORGE_LETS_TALK_PROVIDER\n'
      : `export SWARMFORGE_LETS_TALK_PROVIDER=${provider}\n`;
  fs.writeFileSync(path.join(dir, 'swarm.env'), line);
  delete process.env.SWARMFORGE_LETS_TALK_PROVIDER;
}

function snapshotFile(root, relPath) {
  const full = path.join(root, relPath);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : undefined;
}

function registerSteps(registry) {
  scoped(registry, /^a target repo with front-desk and cursor-bridge operator state fixtures$/, (ctx) => {
    ensureCtx(ctx);
  });

  scoped(registry, /^backlog-topic-map\.json contains legacy per-ticket keys (.+) and (.+)$/, (ctx, bl1, bl2) => {
    ensureCtx(ctx);
    writeJson(ctx.fixtureRoot, '.swarmforge/operator/backlog-topic-map.json', {
      [bl1]: 101,
      [bl2]: 202,
      'topic-consolidation': 500,
    });
    ctx.backlogMapBefore = snapshotFile(ctx.fixtureRoot, '.swarmforge/operator/backlog-topic-map.json');
  });

  scoped(registry, /^cursor-bridge state binds Host topic (\d+)$/, (ctx, topicId) => {
    ensureCtx(ctx);
    ctx.cursorTopicId = Number(topicId);
    writeJson(ctx.fixtureRoot, '.swarmforge/operator/cursor-bridge-state.json', {
      cursorTopicId: ctx.cursorTopicId,
    });
  });

  scoped(registry, /^SWARMFORGE_LETS_TALK_PROVIDER is (.*)$/, (ctx, provider) => {
    ensureCtx(ctx);
    const value = provider === '' ? '' : provider;
    ctx.expectedProvider = value;
    writeSwarmEnv(ctx.fixtureRoot, value);
  });

  scoped(registry, /^the front-desk topic map binds topic (\d+) to (.+)$/, (ctx, topicId, subjectId) => {
    ensureCtx(ctx);
    const rel = '.swarmforge/operator/telegram-topic-map.json';
    const existing = fs.existsSync(path.join(ctx.fixtureRoot, rel))
      ? JSON.parse(fs.readFileSync(path.join(ctx.fixtureRoot, rel), 'utf8'))
      : {};
    existing[String(topicId)] = subjectId;
    writeJson(ctx.fixtureRoot, rel, existing);
    ctx.topicMapBefore = snapshotFile(ctx.fixtureRoot, rel);
  });

  scoped(registry, /^the front-desk topic map has no binding for topic (\d+)$/, (ctx, topicId) => {
    ensureCtx(ctx);
    const rel = '.swarmforge/operator/telegram-topic-map.json';
    const existing = fs.existsSync(path.join(ctx.fixtureRoot, rel))
      ? JSON.parse(fs.readFileSync(path.join(ctx.fixtureRoot, rel), 'utf8'))
      : {};
    delete existing[String(topicId)];
    writeJson(ctx.fixtureRoot, rel, existing);
  });

  scoped(registry, /^the legacy topic adoption probe runs$/, (ctx) => {
    ensureCtx(ctx);
    ctx.probeReport = probeLegacyTopicAdoption(ctx.fixtureRoot);
  });

  scoped(registry, /^the probe report lists (.+) and (.+) as legacy per-ticket topics$/, (ctx, bl1, bl2) => {
    const ids = ctx.probeReport.legacyPerTicketTopics.map((e) => e.backlogId).sort();
    if (!ids.includes(bl1) || !ids.includes(bl2)) {
      throw new Error(`expected legacy keys ${bl1} and ${bl2}, got ${ids.join(', ')}`);
    }
  });

  scoped(registry, /^the probe does not modify backlog-topic-map\.json$/, (ctx) => {
    const after = snapshotFile(ctx.fixtureRoot, '.swarmforge/operator/backlog-topic-map.json');
    if (after !== ctx.backlogMapBefore) {
      throw new Error('probe mutated backlog-topic-map.json');
    }
  });

  scoped(registry, /^the probe report cursor Host topic id is (\d+)$/, (ctx, topicId) => {
    const expected = Number(topicId);
    if (ctx.probeReport.cursorHostTopicId !== expected) {
      throw new Error(`expected cursorHostTopicId ${expected}, got ${ctx.probeReport.cursorHostTopicId}`);
    }
  });

  scoped(registry, /^the probe report classifies cursor Host routing as (.+)$/, (ctx, expectedRouting) => {
    const allowedProviders = new Set(['', 'cursor', 'local', 'openai']);
    if (!allowedProviders.has(ctx.expectedProvider ?? '')) {
      throw new Error(`non-canonical provider literal: ${JSON.stringify(ctx.expectedProvider)}`);
    }
    if (ctx.probeReport.cursorHostRouting !== expectedRouting) {
      throw new Error(`expected routing ${expectedRouting}, got ${ctx.probeReport.cursorHostRouting}`);
    }
    if (ctx.cursorTopicId !== undefined && ctx.probeReport.cursorHostTopicId !== ctx.cursorTopicId) {
      throw new Error(
        `expected cursorHostTopicId ${ctx.cursorTopicId}, got ${ctx.probeReport.cursorHostTopicId}`
      );
    }
    if (ctx.expectedProvider !== undefined && ctx.probeReport.letsTalkProvider !== ctx.expectedProvider) {
      throw new Error(
        `expected letsTalkProvider ${JSON.stringify(ctx.expectedProvider)}, got ${JSON.stringify(ctx.probeReport.letsTalkProvider)}`
      );
    }
  });

  scoped(registry, /^the probe report lists topic (\d+) as a scrub candidate$/, (ctx, topicId) => {
    if (!ctx.probeReport.scrubCandidates.includes(String(topicId))) {
      throw new Error(`expected scrub candidate ${topicId}, got ${ctx.probeReport.scrubCandidates.join(', ')}`);
    }
  });

  scoped(registry, /^the probe does not modify telegram-topic-map\.json$/, (ctx) => {
    const after = snapshotFile(ctx.fixtureRoot, '.swarmforge/operator/telegram-topic-map.json');
    if (after !== ctx.topicMapBefore) {
      throw new Error('probe mutated telegram-topic-map.json');
    }
  });

  scoped(registry, /^openSubjectAndRecord handles a principal message on topic (\d+)$/, async (ctx, topicId) => {
    ensureCtx(ctx);
    ctx.openSubjectError = undefined;
    try {
      ctx.openSubjectResult = await openSubjectAndRecord(ctx.fixtureRoot, Number(topicId), 'principal ping', 9001);
    } catch (err) {
      ctx.openSubjectError = err;
    }
  });

  scoped(registry, /^openSubjectAndRecord is invoked for topic (\d+)$/, async (ctx, topicId) => {
    ensureCtx(ctx);
    ctx.openSubjectError = undefined;
    try {
      await openSubjectAndRecord(ctx.fixtureRoot, Number(topicId), 'principal ping', 9002);
    } catch (err) {
      ctx.openSubjectError = err;
    }
  });

  scoped(registry, /^the front-desk topic map binds topic (\d+) to OPERATOR$/, (ctx, topicId) => {
    const rel = '.swarmforge/operator/telegram-topic-map.json';
    const map = JSON.parse(fs.readFileSync(path.join(ctx.fixtureRoot, rel), 'utf8'));
    if (map[String(topicId)] !== OPERATOR_SUBJECT_ID) {
      throw new Error(`expected topic ${topicId} -> OPERATOR, got ${map[String(topicId)]}`);
    }
  });

  scoped(registry, /^no new SUP subject is opened$/, (ctx) => {
    const rel = '.swarmforge/operator/telegram-topic-map.json';
    const map = JSON.parse(fs.readFileSync(path.join(ctx.fixtureRoot, rel), 'utf8'));
    const supKeys = Object.entries(map).filter(([, v]) => /^SUP-\d+$/i.test(v));
    if (supKeys.length > 0) {
      throw new Error(`expected no SUP bindings, got ${JSON.stringify(supKeys)}`);
    }
    if (ctx.openSubjectResult !== OPERATOR_SUBJECT_ID) {
      throw new Error(`expected OPERATOR subject id, got ${ctx.openSubjectResult}`);
    }
  });

  scoped(registry, /^openSubjectAndRecord rejects with bridge-owned error$/, (ctx) => {
    if (!ctx.openSubjectError || !/telegram-cursor-bridge/.test(String(ctx.openSubjectError.message || ctx.openSubjectError))) {
      throw new Error(`expected bridge-owned rejection, got ${ctx.openSubjectError}`);
    }
  });
}

module.exports = { registerSteps };
