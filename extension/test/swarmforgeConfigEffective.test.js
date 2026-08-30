'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseSwarmIdentityConfPath,
  readEffectiveConfigValue,
} = require('../out/util/swarmforgeConfig');

test('parseSwarmIdentityConfPath reads the pack conf path from identity text', () => {
  assert.equal(
    parseSwarmIdentityConfPath('swarm_name\tdemo\nactive_backlog_max_depth_conf_path\tpacks/x/swarmforge.conf\n'),
    'packs/x/swarmforge.conf'
  );
  assert.equal(parseSwarmIdentityConfPath('swarm_name\tdemo\n'), undefined);
});

test('readEffectiveConfigValue prefers pack conf then falls back to tracked', () => {
  const root = mkTmpDir('sfvc-bl584-conf-');
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packs', 'x'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    'config notify_email_to tracked@example.com\nconfig approval_ask_stale_after_ms 111\n'
  );
  fs.writeFileSync(
    path.join(root, 'packs', 'x', 'swarmforge.conf'),
    'config approval_ask_stale_after_ms 222\n'
  );
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'swarm-identity'),
    'active_backlog_max_depth_conf_path\tpacks/x/swarmforge.conf\n'
  );
  assert.equal(readEffectiveConfigValue(root, 'approval_ask_stale_after_ms'), '222');
  assert.equal(readEffectiveConfigValue(root, 'notify_email_to'), 'tracked@example.com');
  fs.rmSync(root, { recursive: true, force: true });
});
