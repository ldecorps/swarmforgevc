'use strict';

// Article 2.3 self-audit (BL-1529): the first send of a git_handoff draft is
// a challenge that queues nothing (AUDIT_REQUIRED / HANDOFF_NOT_QUEUED); the
// identical second send queues it. Every agent and script sender speaks this
// two-call protocol, so a step handler that drives the real swarm_handoff.bb
// must too. Only the challenge is answered: a refusal is never re-sent.
//
// 2026-10-05: five handlers that sent once (BL-748, BL-951, BL-953, BL-991,
// BL-992) had been red on main since the audit landed, every scenario that
// expects a delivery failing on the challenge; BL-754's fixed the same way.

const { spawnSync } = require('node:child_process');

function isAuditChallenge(res) {
  return /AUDIT_REQUIRED|HANDOFF_NOT_QUEUED/.test(`${(res && res.stdout) || ''}${(res && res.stderr) || ''}`);
}

function spawnHandoffSend(command, args, options) {
  const first = spawnSync(command, args, options);
  return isAuditChallenge(first) ? spawnSync(command, args, options) : first;
}

module.exports = { spawnHandoffSend, isAuditChallenge };
