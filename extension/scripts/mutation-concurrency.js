#!/usr/bin/env node
// BL-786: shared mutation-concurrency resolver entry point for every mutation
// npm script. Resolves host-aware concurrency (or honours MUTATION_CONCURRENCY)
// and passes --concurrency to the wrapped Stryker command.
require('../out/tools/resolve-mutation-concurrency').main();
