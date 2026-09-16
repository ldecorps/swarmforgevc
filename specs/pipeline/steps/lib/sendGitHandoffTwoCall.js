'use strict';

// BL-1602: the shared two-call sender every acceptance driver that drafts a
// git_handoff and invokes swarm_handoff.bb/.sh routes through. Speaks the
// self-audit protocol (Article 2.3, BL-1529) and NOTHING else: on a first
// call that is non-zero AND whose combined output contains AUDIT_REQUIRED,
// it re-invokes with the identical (bb, args, opts) exactly once more and
// returns THAT result; a first call that queues, or that refuses for any
// other reason, is returned as-is. Never a third call, never an env bypass.
//
// `spawnFn` is injected (defaults to the real node:child_process.spawnSync)
// so scenario 01 drives the protocol itself over a fake sender thunk,
// without a real subprocess.

const { spawnSync } = require('node:child_process');

function isAuditRequired(result) {
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  return result.status !== 0 && /AUDIT_REQUIRED/.test(out);
}

function sendGitHandoffTwoCall(bb, args, opts, spawnFn = spawnSync) {
  const first = spawnFn(bb, args, opts);
  if (isAuditRequired(first)) {
    return spawnFn(bb, args, opts);
  }
  return first;
}

module.exports = { sendGitHandoffTwoCall };
