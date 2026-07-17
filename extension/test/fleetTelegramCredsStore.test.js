const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { writeFleetTelegramCreds, readFleetTelegramCreds, fleetTelegramCredsPath } = require('../out/onboarding/fleetTelegramCredsStore');

// Every test writes into an os.tmpdir() fixture standing in for the HOST
// home directory - never the real $HOME - mirroring
// telegramChannelSecretStore.test.js's own "host state outside the working
// tree" convention.

function mkTmp() {
  return mkTmpDir('sfvc-fleet-telegram-creds-');
}

test('fleetTelegramCredsPath resolves under <homeDir>/.swarmforge/fleet/<swarmName>/telegram.json', () => {
  assert.equal(fleetTelegramCredsPath('/home/x', 'fes'), path.join('/home/x', '.swarmforge', 'fleet', 'fes', 'telegram.json'));
});

test('writeFleetTelegramCreds then readFleetTelegramCreds round-trips botToken/chatId/bridgePort', () => {
  const home = mkTmp();

  writeFleetTelegramCreds(home, 'fes', { botToken: 'fes-token', chatId: '-100999', bridgePort: 9001 });

  assert.deepEqual(readFleetTelegramCreds(home, 'fes'), { botToken: 'fes-token', chatId: '-100999', bridgePort: 9001 });
});

test('writeFleetTelegramCreds creates any missing parent directories', () => {
  const home = mkTmp();

  writeFleetTelegramCreds(home, 'fes', { botToken: 't', chatId: 'c', bridgePort: 8765 });

  assert.ok(fs.existsSync(fleetTelegramCredsPath(home, 'fes')));
});

test('the creds file is created with owner-only read/write permissions', () => {
  const home = mkTmp();

  writeFleetTelegramCreds(home, 'fes', { botToken: 't', chatId: 'c', bridgePort: 8765 });

  const mode = fs.statSync(fleetTelegramCredsPath(home, 'fes')).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('two swarms get separate creds files, neither clobbering the other', () => {
  const home = mkTmp();

  writeFleetTelegramCreds(home, 'fes', { botToken: 'fes-token', chatId: 'fes-chat', bridgePort: 9001 });
  writeFleetTelegramCreds(home, 'primary', { botToken: 'primary-token', chatId: 'primary-chat', bridgePort: 8765 });

  assert.equal(readFleetTelegramCreds(home, 'fes').botToken, 'fes-token');
  assert.equal(readFleetTelegramCreds(home, 'primary').botToken, 'primary-token');
});

test('re-provisioning the same swarm overwrites its own creds rather than merging stale fields', () => {
  const home = mkTmp();

  writeFleetTelegramCreds(home, 'fes', { botToken: 'old-token', chatId: 'old-chat', bridgePort: 9001 });
  writeFleetTelegramCreds(home, 'fes', { botToken: 'new-token', chatId: 'new-chat', bridgePort: 9002 });

  assert.deepEqual(readFleetTelegramCreds(home, 'fes'), { botToken: 'new-token', chatId: 'new-chat', bridgePort: 9002 });
});

test('readFleetTelegramCreds returns undefined when no creds file exists for that swarm', () => {
  const home = mkTmp();

  assert.equal(readFleetTelegramCreds(home, 'never-provisioned'), undefined);
});

test('readFleetTelegramCreds returns undefined for corrupt JSON rather than throwing', () => {
  const home = mkTmp();
  const filePath = fleetTelegramCredsPath(home, 'fes');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'not json at all');

  assert.equal(readFleetTelegramCreds(home, 'fes'), undefined);
});
