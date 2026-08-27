'use strict';

// BL-711: step handlers for "Docs name both the interface and its incarnation".
// Reads the REAL docs/reference/Specification.MD vocabulary paragraph beside the
// chat-adapter section. vocabulary-04 discovers every commit on this branch whose
// subject starts with "BL-711:" and asserts the parcel touches prose/acceptance
// infra only — no behavior or rename sweep.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SPEC_PATH = path.join(REPO_ROOT, 'docs', 'reference', 'Specification.MD');

const FEATURE_NAME = 'Docs name both the interface and its incarnation';

const VOCABULARY_MARKER = '**Interface vs incarnation';
const CHAT_ADAPTER_HEADING =
  '### Chat adapter (Signal / Telegram / WhatsApp / Teams) — human channel only';

const PROSE_PREFIXES = ['docs/'];
const TEST_INFRA_PREFIXES = ['specs/features/', 'specs/pipeline/steps/'];
const TICKET_PREFIXES = ['backlog/active/', 'backlog/paused/', 'backlog/done/'];
const BEHAVIOR_PREFIXES = ['extension/src/', 'swarmforge/scripts/', 'android/'];

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function bl711CommitShas() {
  const log = git(['log', 'HEAD', '--oneline', '-E', '--grep=^BL-711:']);
  return log.trim().split('\n').filter(Boolean).map((line) => line.split(' ')[0]);
}

function changedFilesForCommit(sha) {
  const out = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
  return out.trim().split('\n').filter(Boolean);
}

function bl711ChangedFiles() {
  const files = new Set();
  for (const sha of bl711CommitShas()) {
    for (const file of changedFilesForCommit(sha)) {
      files.add(file);
    }
  }
  return [...files];
}

function isAllowedParcelFile(file) {
  if (PROSE_PREFIXES.some((prefix) => file.startsWith(prefix))) return true;
  if (TEST_INFRA_PREFIXES.some((prefix) => file.startsWith(prefix))) return true;
  if (TICKET_PREFIXES.some((prefix) => file.startsWith(prefix))) return true;
  return false;
}

function isBehaviorFile(file) {
  return BEHAVIOR_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function readSpec(ctx) {
  if (ctx.specContent === undefined) {
    ctx.specContent = fs.readFileSync(SPEC_PATH, 'utf8');
  }
  return ctx.specContent;
}

function vocabularySection(ctx) {
  if (ctx.vocabularySection !== undefined) {
    return ctx.vocabularySection;
  }
  const content = readSpec(ctx);
  const markerIdx = content.indexOf(VOCABULARY_MARKER);
  if (markerIdx === -1) {
    throw new Error(`BL-711: expected vocabulary marker "${VOCABULARY_MARKER}" in Specification.MD`);
  }
  const chatIdx = content.lastIndexOf(CHAT_ADAPTER_HEADING, markerIdx);
  if (chatIdx === -1 || markerIdx - chatIdx > 500) {
    throw new Error('BL-711: expected vocabulary paragraph beside the chat-adapter heading');
  }
  const tail = content.slice(markerIdx);
  const endMatch = tail.match(/\n\n(?!\*\*)/);
  ctx.vocabularySection = endMatch ? tail.slice(0, endMatch.index) : tail.split('\n\n')[0];
  return ctx.vocabularySection;
}

function normalizedVocabulary(ctx) {
  return vocabularySection(ctx).replace(/\s+/g, ' ');
}

function registerSteps(registry) {
  registry.define(/^the project specification reference document$/, (ctx) => {
    ctx.specPath = SPEC_PATH;
    readSpec(ctx);
  });

  registry.define(/^I read the vocabulary section$/, (ctx) => {
    vocabularySection(ctx);
  });

  registry.define(/^it names the interface (.*)$/, (ctx, interfaceName) => {
    const text = normalizedVocabulary(ctx);
    const pattern = new RegExp(`\\b${interfaceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!pattern.test(text)) {
      throw new Error(`BL-711: expected interface "${interfaceName}" in vocabulary section`);
    }
  });

  registry.define(/^it names (.*) as that interface's current incarnation$/, (ctx, incarnation) => {
    const text = normalizedVocabulary(ctx);
    const pattern = new RegExp(`\\b${incarnation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!pattern.test(text)) {
      throw new Error(`BL-711: expected incarnation "${incarnation}" in vocabulary section`);
    }
  });

  registry.define(/^it gives Bubble as the product name of the operator phone app$/, (ctx) => {
    const text = normalizedVocabulary(ctx);
    if (!/\bBubble\b/.test(text) || !/phone app/i.test(text)) {
      throw new Error('BL-711: expected Bubble named as the operator phone app product');
    }
  });

  registry.define(/^it does not introduce a second brand for that app$/, (ctx) => {
    const text = normalizedVocabulary(ctx);
    const productNames = [...text.matchAll(/product name is \*\*([^*]+)\*\*/gi)].map((match) => match[1]);
    if (productNames.length !== 1 || productNames[0] !== 'Bubble') {
      throw new Error(
        `BL-711: expected Bubble as the sole phone-app product name, found: ${productNames.join(', ') || '(none)'}`
      );
    }
  });

  registry.define(/^it says architecture prose may use the interface words$/, (ctx) => {
    const text = normalizedVocabulary(ctx);
    if (!/architecture.*(may|can).*interface/i.test(text) && !/Docs may say/i.test(text)) {
      throw new Error('BL-711: expected statement that architecture prose may use interface words');
    }
  });

  registry.define(/^it says operator instructions keep the incarnation names$/, (ctx) => {
    const text = normalizedVocabulary(ctx);
    if (!/operators still say/i.test(text) && !/operator.*incarnation/i.test(text)) {
      throw new Error('BL-711: expected statement that operator instructions keep incarnation names');
    }
  });

  registry.define(/^I inspect the change that adds the vocabulary section$/, (ctx) => {
    ctx.bl711ChangedFiles = bl711ChangedFiles();
    if (ctx.bl711ChangedFiles.length === 0) {
      throw new Error(
        'BL-711: found no commit on this branch with a subject starting "BL-711:" — commit the parcel first'
      );
    }
  });

  registry.define(/^it changes prose only$/, (ctx) => {
    const files = ctx.bl711ChangedFiles || bl711ChangedFiles();
    const unexpected = files.filter((file) => !isAllowedParcelFile(file));
    if (unexpected.length > 0) {
      throw new Error(
        `BL-711: expected prose/acceptance/ticket files only, found: ${unexpected.join(', ')}`
      );
    }
  });

  registry.define(
    /^no identifier, environment variable, filename, or operator verb is renamed$/,
    (ctx) => {
      const shas = bl711CommitShas();
      for (const sha of shas) {
        const renameOut = git(['diff-tree', '--no-commit-id', '-r', '--diff-filter=R', sha]);
        if (renameOut.trim()) {
          throw new Error(`BL-711: commit ${sha} contains file renames:\n${renameOut}`);
        }
      }
      const files = ctx.bl711ChangedFiles || bl711ChangedFiles();
      const behaviorHits = files.filter(isBehaviorFile);
      if (behaviorHits.length > 0) {
        throw new Error(`BL-711: parcel touched behavior files: ${behaviorHits.join(', ')}`);
      }
    }
  );
}

module.exports = { registerSteps };
