const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readTelegramChannel, writeTelegramChannel } = require('../out/onboarding/telegramChannelStore');

function mkTmp() {
  return mkTmpDir('sfvc-telegram-channel-store-');
}

test('readTelegramChannel returns undefined when no channel has been provisioned yet', () => {
  const targetRepo = mkTmp();

  assert.equal(readTelegramChannel(targetRepo), undefined);
});

test('writeTelegramChannel then readTelegramChannel round-trips the chat id and negotiation topic id', () => {
  const targetRepo = mkTmp();

  writeTelegramChannel(targetRepo, { chatId: '555666777', negotiationTopicId: 42 });

  assert.deepEqual(readTelegramChannel(targetRepo), { chatId: '555666777', negotiationTopicId: 42 });
});

test('writeTelegramChannel persists under the target repo\'s own machine-local .swarmforge/operator directory', () => {
  const targetRepo = mkTmp();

  writeTelegramChannel(targetRepo, { chatId: '555666777', negotiationTopicId: 42 });

  const filePath = path.join(targetRepo, '.swarmforge', 'operator', 'telegram-channel.json');
  assert.ok(fs.existsSync(filePath));
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { chatId: '555666777', negotiationTopicId: 42 });
});

test('writeTelegramChannel creates any missing parent directories', () => {
  const targetRepo = mkTmp();

  writeTelegramChannel(targetRepo, { chatId: '1', negotiationTopicId: 2 });

  assert.ok(fs.existsSync(path.join(targetRepo, '.swarmforge', 'operator')));
});

test('re-provisioning a target overwrites its previous channel record rather than merging stale fields', () => {
  const targetRepo = mkTmp();
  writeTelegramChannel(targetRepo, { chatId: 'old-chat', negotiationTopicId: 1 });

  writeTelegramChannel(targetRepo, { chatId: 'new-chat', negotiationTopicId: 2 });

  assert.deepEqual(readTelegramChannel(targetRepo), { chatId: 'new-chat', negotiationTopicId: 2 });
});
