'use strict';

// BL-1210: step handlers for "every topic kind keeps its icon ownership
// marker, whatever store the tracked-record boundary sends it to". Drives
// the REAL compiled syncTopicIcon (extension/out/concierge/topicIconSync)
// over the REAL compiled blTopicStore, against a throwaway target
// directory - never a re-implementation of either. The only fakes are the
// two Telegram edges (the live sticker list and setForumTopicIcon), which
// are the environmentally unsuitable half.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { syncTopicIcon } = require(path.join(EXT_OUT, 'concierge', 'topicIconSync'));
const {
  readSwarmIconId,
  recordSwarmIconId,
  recordPath,
} = require(path.join(EXT_OUT, 'concierge', 'blTopicStore'));

const FEATURE =
  'BL-1210 every topic kind keeps its icon ownership marker, whatever store the tracked-record boundary sends it to';

// engineering.prompt's Scenario Outline rule: every Examples: column value
// is validated against an explicit lookup, never a bare passthrough. Each
// id here is a REAL example of its kind as the live callers spell it -
// conciergeTick passes 'role-benchmarking', 'OPERATOR' and 'coder'.
const KNOWN_ID_KINDS = {
  'a ticket id': 'BL-1210',
  'an epic id': 'role-benchmarking',
  'a standing topic id': 'OPERATOR',
  'a role id': 'coder',
  'an id no store will accept': '   ',
};

const KNOWN_TRACKED_RECORD = {
  exists: true,
  'is not created': false,
};

const STICKERS = [
  { emoji: '💡', customEmojiId: 'id-bulb' },
  { emoji: '✅', customEmojiId: 'id-check' },
];

const SILENT = () => {};

function mkTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1210-aps-'));
}

function adaptersFor(targetPath) {
  return {
    getIconStickers: async () => STICKERS,
    setTopicIcon: async () => true,
    readSwarmIconId: (id) => readSwarmIconId(targetPath, id),
    // The refusal reporters are silenced: this scenario asserts the RETURN
    // VALUE reaches the caller, so stderr must not be what carries it.
    recordSwarmIconId: (id, iconId) => recordSwarmIconId(targetPath, id, iconId, SILENT, SILENT),
  };
}

function knownIdFor(kind) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_ID_KINDS, kind)) {
    throw new Error(`unknown <id kind>: ${kind}`);
  }
  return KNOWN_ID_KINDS[kind];
}

function knownTrackedRecord(token) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_TRACKED_RECORD, token)) {
    throw new Error(`unknown <tracked record>: ${token}`);
  }
  return KNOWN_TRACKED_RECORD[token];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────────
  scoped(/^a topic whose icon the swarm is setting for the first time$/, (ctx) => {
    ctx.target = mkTarget();
    ctx.isNewTopic = true;
    ctx.desiredEmoji = '💡';
    ctx.expectedIconId = 'id-bulb';
  });

  // ── Scenario 01 / 02 ──────────────────────────────────────────────────────
  scoped(/^the topic is identified by (.+)$/, (ctx, kind) => {
    ctx.idKind = kind;
    ctx.topicId = knownIdFor(kind);
  });

  scoped(/^the swarm sets that topic's icon$/, async (ctx) => {
    ctx.outcome = await syncTopicIcon(
      ctx.topicId,
      4242,
      ctx.desiredEmoji,
      ctx.isNewTopic,
      adaptersFor(ctx.target)
    );
  });

  scoped(/^reading the ownership marker back returns the icon that was set$/, (ctx) => {
    assert.equal(ctx.outcome, 'updated', `sync outcome for ${ctx.idKind}`);
    assert.equal(
      readSwarmIconId(ctx.target, ctx.topicId),
      ctx.expectedIconId,
      `ownership marker for ${ctx.idKind} (${ctx.topicId})`
    );
  });

  scoped(/^a tracked topic record (.+) for that id$/, (ctx, token) => {
    const shouldExist = knownTrackedRecord(token);
    assert.equal(
      fs.existsSync(recordPath(ctx.target, ctx.topicId)),
      shouldExist,
      `BL-695 boundary: tracked record for ${ctx.idKind} (${ctx.topicId}) should ${token}`
    );
    fs.rmSync(ctx.target, { recursive: true, force: true });
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(/^the sync does not report the icon as updated and owned$/, (ctx) => {
    assert.notEqual(ctx.outcome, 'updated');
  });

  scoped(/^the refusal is visible to the caller rather than only on stderr$/, (ctx) => {
    // Every reporter passed to recordSwarmIconId above is SILENT, so this
    // value is the ONLY channel the refusal could have travelled on.
    assert.equal(ctx.outcome, 'icon-set-marker-unrecorded');
    assert.equal(readSwarmIconId(ctx.target, ctx.topicId), undefined);
    fs.rmSync(ctx.target, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
