'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  engageOperatorAmbulance,
  readRawAmbulanceMarker,
} = require('../out/tools/telegramOperatorAmbulance');

test('BL-691 engage refuses paused and names paused/', () => {
  const root = mkTmpDir('bl691-eng-');
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'paused', 'BL-688-demo.yaml'), 'id: BL-688\ntitle: x\n');
  const r = engageOperatorAmbulance(root, 'BL-688', 1);
  assert.equal(r.ok, false);
  assert.match(r.text, /paused/);
});

test('BL-691 engage succeeds for active', () => {
  const root = mkTmpDir('bl691-eng-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-688-demo.yaml'), 'id: BL-688\ntitle: x\n');
  const r = engageOperatorAmbulance(root, 'BL-688', 42);
  assert.equal(r.ok, true);
  assert.equal(readRawAmbulanceMarker(root).ticket, 'BL-688');
});
