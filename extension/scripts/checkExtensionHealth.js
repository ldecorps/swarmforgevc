#!/usr/bin/env node
// BL-145: a side-effect-free liveness probe for `./swarm ensure`'s extension
// component - reuses BL-058's filterDevHostPids so the "is it running"
// definition never drifts from the bounce script's own. Prints HEALTHY /
// UNHEALTHY and exits 0/1; never bounces anything itself.
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { filterDevHostPids } = require('./bounceLib');

const EXT_DIR = path.resolve(__dirname, '..');

function devHostPids() {
  const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (ps.status !== 0) {
    return [];
  }
  return filterDevHostPids(ps.stdout, EXT_DIR);
}

function main() {
  const pids = devHostPids();
  if (pids.length > 0) {
    console.log('HEALTHY');
    process.exit(0);
  }
  console.log('UNHEALTHY');
  process.exit(1);
}

main();
