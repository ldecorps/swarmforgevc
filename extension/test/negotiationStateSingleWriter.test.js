const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BL-624 supporting gate ("No parallel negotiation state: grep-level
// assertion that only runObject/runApprove write negotiation state") /
// BL-381 invariant: negotiate-onboarding-contract.ts's runObject/runApprove
// are the ONE writer of negotiation state (contract.yaml's revision path,
// via targetBootstrap.ts's updateTargetContract, and the round log). This
// is a static grep over the SOURCE tree, not a behavioral test - it exists
// to catch a future caller (BL-624's own contractPhaseRealAdapters.ts
// included) that starts writing a revision/approval directly instead of
// going through runObject/runApprove, which is exactly how BL-381's own
// "second negotiation engine" trap would reappear.
const SRC_DIR = path.join(__dirname, '..', 'src');
const ALLOWED_CALLER = path.join('src', 'tools', 'negotiate-onboarding-contract.ts');

function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

test('BL-624/BL-381: only negotiate-onboarding-contract.ts CALLS updateTargetContract (the negotiation revision/approval writer)', () => {
  const offenders = [];
  for (const file of listTsFiles(SRC_DIR)) {
    const relative = path.relative(path.join(__dirname, '..'), file);
    if (relative === ALLOWED_CALLER) {
      continue; // the definition site (targetBootstrap.ts) and every OTHER file must never call it
    }
    if (relative === path.join('src', 'config', 'targetBootstrap.ts')) {
      continue; // where updateTargetContract is DEFINED, not called
    }
    const content = fs.readFileSync(file, 'utf8');
    if (/\bupdateTargetContract\s*\(/.test(content)) {
      offenders.push(relative);
    }
  }
  assert.deepEqual(offenders, [], `expected no file besides ${ALLOWED_CALLER} to call updateTargetContract, found: ${JSON.stringify(offenders)}`);
});

test('BL-624/BL-381: only negotiate-onboarding-contract.ts calls runObject/runApprove\'s own underlying appendRound/negotiation-log writers', () => {
  // The round log itself is written ONLY inside negotiate-onboarding-contract.ts
  // (appendRound, negotiationEndedPath) - no other file imports/calls those
  // internal helpers (they are not even exported), so this is a grep for any
  // OTHER file reaching into the same append-only log path directly.
  const offenders = [];
  for (const file of listTsFiles(SRC_DIR)) {
    const relative = path.relative(path.join(__dirname, '..'), file);
    if (relative === ALLOWED_CALLER) {
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    if (/onboarding-negotiation\.jsonl|onboarding-negotiation-ended\.json/.test(content)) {
      offenders.push(relative);
    }
  }
  assert.deepEqual(offenders, [], `expected no file besides ${ALLOWED_CALLER} to reference the negotiation round log/ended-marker paths, found: ${JSON.stringify(offenders)}`);
});
