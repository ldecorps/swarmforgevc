'use strict';

// BL-1651: registered via vitest.properties.config.mjs's test.setupFiles,
// same idiom as envRestoreGuardSetup.js beside it. vitest.properties.config.mjs
// derives the per-file ceiling from the host (resolvePropertyLaneHeapMB /
// resolvePropertyLaneFileHeapCeilingMB) and publishes it through
// PROPERTY_LANE_HEAP_CEILING_ENV_KEY before any fork spawns - this hook only
// reads it back and calls the pure decision (property-lane-heap-gate.js),
// same "thin wrapper over a testable helper" split check-suite-file-budget.ts
// and envRestoreGuard.js already use. A file that crosses the ceiling fails
// AT THAT TEST, named with its file path and peak heap - converting what
// used to be a silent worker abort (FATAL ERROR: JavaScript heap out of
// memory, no file name, no number) into a clean, attributable red, well
// before the file's growing heap ever reaches the worker's own V8 cap
// (PROPERTY_LANE_HEAP_HEADROOM_FRACTION's whole reason to exist).
//
// Absent env key (outside the property lane - the unit lane shares none of
// these setupFiles, and a bare `vitest` invocation elsewhere never sets it)
// is a no-op via heapCeilingVerdict's own "no ceiling configured" clause -
// this hook never activates outside test:properties.
const { heapCeilingVerdict } = require('../../out/tools/property-lane-heap-gate');
const { PROPERTY_LANE_HEAP_CEILING_ENV_KEY } = require('./propertyLaneHeapCeilingEnvKey');

afterEach((context) => {
  const ceilingMB = Number(process.env[PROPERTY_LANE_HEAP_CEILING_ENV_KEY]);
  const heapUsedMB = process.memoryUsage().heapUsed / (1024 * 1024);
  const verdict = heapCeilingVerdict(heapUsedMB, ceilingMB);
  if (!verdict.exceeded) return;
  const task = context && context.task;
  const filepath = task && task.file ? task.file.filepath : '(unknown file)';
  throw new Error(`${verdict.message} (file: ${filepath})`);
});
