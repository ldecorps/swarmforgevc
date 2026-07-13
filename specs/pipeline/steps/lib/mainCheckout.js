'use strict';

// Architect bounce (BL-336, 2026-07-13): a step file that live-verifies
// against the main/coordinator checkout must never hardcode that
// checkout's absolute path - it ENOENTs for any other engineer, a fresh
// clone, or CI. This project already solved "find the main checkout from
// any .worktrees/<role> checkout" without a hardcoded path (BL-056) - see
// extension/src/tools/swarm-metrics.ts's getGitCommonDir/resolveProjectRoot,
// reused by list-dead-letters.ts/queue-status.ts/stage-dwell-report.ts/
// suite-duration-line.ts. This is the SAME derivation (git rev-parse
// --git-common-dir, then its parent), reimplemented here in plain Node
// rather than importing the compiled TS module, so a step file never
// depends on extension/out/ already being built.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

function resolveMainCheckout(cwd) {
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return path.dirname(path.resolve(cwd, commonDir));
}

module.exports = { resolveMainCheckout };
