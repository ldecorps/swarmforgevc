'use strict';

// BL-1651: the env key vitest.properties.config.mjs (main process, before
// any fork spawns) and propertyLaneHeapGuardSetup.js (inside each worker)
// both read/write - split into its own no-side-effect module so the config
// can require it without also pulling in the setup file's own top-level
// afterEach(...) registration, which only Vitest's own setupFile loader may
// call.
const PROPERTY_LANE_HEAP_CEILING_ENV_KEY = 'SWARMFORGE_PROPERTY_LANE_FILE_HEAP_CEILING_MB';

module.exports = { PROPERTY_LANE_HEAP_CEILING_ENV_KEY };
