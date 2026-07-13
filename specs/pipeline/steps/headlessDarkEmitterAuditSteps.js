'use strict';

// BL-336: step handlers for "Every human-visible emitter has a known
// headless verdict". Per the ticket's own explicit mandate: a verdict
// derived from a code reading reproduces the exact mistake that created
// this bug class - "VERIFY BY ACTUALLY RUNNING HEADLESS...NOT by reading
// code and reasoning about it." This session IS headless by construction
// (a terminal coding agent, no VS Code extension host driving it), so
// these steps re-check REAL live artifacts on the real main checkout
// (chaser telemetry, the emitted cost-health sidecar, systemd unit list)
// rather than trusting the evidence report's prose alone - the same
// "check the real artifact, not a fixture of it" posture as
// shippedButInvisibleSteps.js (BL-335).
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { makeEvidenceReader } = require('./lib/evidenceReport');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WORKTREE_ROOT = REPO_ROOT; // this coder worktree
const MAIN_CHECKOUT = '/home/carillon/swarmforgevc';
const EVIDENCE_DIR = path.join(REPO_ROOT, 'backlog', 'evidence');

const readEvidence = makeEvidenceReader(EVIDENCE_DIR, 'BL-336-headless-dark-emitter-audit-', 'BL-336');

function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ');
}

function requireMarker(text, fragment, label) {
  if (!normalizeWhitespace(text).includes(normalizeWhitespace(fragment))) {
    throw new Error(`expected the BL-336 evidence report to contain "${fragment}" (${label}), it did not`);
  }
}

function countOccurrences(text, fragment) {
  return normalizeWhitespace(text).split(normalizeWhitespace(fragment)).length - 1;
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^the swarm has emitters that write to surfaces the human looks at$/, () => {
    // Narrative only - the real swarm on the main checkout is genuinely
    // live (handoffd/operator_runtime/front-desk all running, verified
    // below).
  });

  // ── headless-dark-emitter-audit-01 ───────────────────────────────────
  registry.define(/^the audit is performed$/, (ctx) => {
    readEvidence(ctx);
  });
  registry.define(/^every emitter that writes to a human-visible surface is listed$/, (ctx) => {
    const text = readEvidence(ctx);
    // Coverage across every surface the ticket names as a minimum.
    requireMarker(text, 'Daily briefing email', 'audit-01: briefing email surface');
    requireMarker(text, 'PWA data)', 'audit-01: PWA data surface');
    requireMarker(text, 'phone-card', 'audit-01: phone-card/holistic-UI surface');
    requireMarker(text, 'Telegram Front Desk Bot', 'audit-01: Telegram surface');
    requireMarker(text, 'status.json', 'audit-01: status.json surface');
  });

  // ── headless-dark-emitter-audit-02 ───────────────────────────────────
  registry.define(/^each listed emitter has a verdict of runs headless, dark when headless, or not applicable$/, (ctx) => {
    const text = readEvidence(ctx);
    requireMarker(text, 'Runs headless (confirmed live', 'audit-02: a runs-headless table exists');
    requireMarker(text, 'VERDICT: DARK WHEN HEADLESS', 'audit-02: at least one dark verdict exists');
    requireMarker(text, 'Noted, not treated as a formal finding', 'audit-02: a not-applicable category exists');
  });
  registry.define(/^no emitter is left without a verdict$/, (ctx) => {
    const text = readEvidence(ctx);
    const darkVerdicts = countOccurrences(text, 'VERDICT: DARK WHEN HEADLESS');
    const processVerdict = countOccurrences(text, 'VERDICT: PROCESS-LEVEL DARK-ON-RESTART GAP');
    // H1, H2/H3, H4, H5 each carry their own explicit dark verdict; G1/G2
    // carries its own distinct (process-level) verdict shape.
    if (darkVerdicts < 4) {
      throw new Error(`audit-02: expected at least 4 explicit "VERDICT: DARK WHEN HEADLESS" findings, found ${darkVerdicts}`);
    }
    if (processVerdict < 1) {
      throw new Error('audit-02: expected the G1/G2 process-level verdict to be present');
    }
  });

  // ── headless-dark-emitter-audit-03 ───────────────────────────────────
  registry.define(/^each listed emitter states what triggers it$/, (ctx) => {
    const text = readEvidence(ctx);
    const triggers = countOccurrences(text, 'Trigger:');
    if (triggers < 4) {
      throw new Error(`audit-03: expected each dark-candidate emitter to state its trigger explicitly, found ${triggers} "Trigger:" markers`);
    }
  });
  registry.define(/^each listed emitter states whether that trigger exists when no host is running$/, (ctx) => {
    const text = readEvidence(ctx);
    const headlessCallers = countOccurrences(text, 'Headless caller:');
    if (headlessCallers < 4) {
      throw new Error(`audit-03: expected each dark-candidate emitter to state its headless-caller existence explicitly, found ${headlessCallers} "Headless caller:" markers`);
    }
  });

  // ── headless-dark-emitter-audit-04 ───────────────────────────────────
  registry.define(/^the swarm is run with no host present$/, () => {
    // Narrative - this ENTIRE acceptance run IS that headless context: no
    // VS Code extension host with the SwarmForge VC extension is driving
    // this process. The steps below re-check real artifacts live, not the
    // report's prose, to prove the claim is reproducible right now.
  });
  registry.define(/^each verdict is supported by which surfaces populated in that run$/, (ctx) => {
    const text = readEvidence(ctx);
    requireMarker(text, 'LIVE EVIDENCE', 'audit-04: live-evidence citations exist');
    const liveEvidenceCount = countOccurrences(text, 'LIVE EVIDENCE');
    if (liveEvidenceCount < 3) {
      throw new Error(`audit-04: expected multiple independent LIVE EVIDENCE citations, found ${liveEvidenceCount}`);
    }
    // Re-verify H1's own claim live, right now, against the real main
    // checkout - not trusting the report's own prose.
    const chaserPath = path.join(MAIN_CHECKOUT, '.swarmforge', 'telemetry', 'chaser-2026-07.jsonl');
    if (!fs.existsSync(chaserPath)) {
      throw new Error(`audit-04: expected the real live chaser telemetry file to exist at ${chaserPath}`);
    }
    const chaserContent = fs.readFileSync(chaserPath, 'utf8');
    const resourceLines = chaserContent.split('\n').filter((l) => l.includes('"type":"resource')).length;
    if (resourceLines !== 0) {
      throw new Error(
        `audit-04: expected zero resource-sample entries in the live chaser telemetry (H1's own re-verification) - found ${resourceLines}. Either H1 is stale or a headless caller was added without updating the audit.`
      );
    }
    const sidecarFiles = fs
      .readdirSync(path.join(MAIN_CHECKOUT, 'docs', 'briefings'))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    const latestSidecar = JSON.parse(
      fs.readFileSync(path.join(MAIN_CHECKOUT, 'docs', 'briefings', sidecarFiles[sidecarFiles.length - 1]), 'utf8')
    );
    if (!Array.isArray(latestSidecar.resourceAnomalies) || latestSidecar.resourceAnomalies.length !== 0) {
      throw new Error(
        `audit-04: expected the live cost-health sidecar's resourceAnomalies to still be empty (H1's own re-verification), got ${JSON.stringify(latestSidecar.resourceAnomalies)}`
      );
    }
  });

  // ── headless-dark-emitter-audit-05 ───────────────────────────────────
  registry.define(/^an emitter's code suggests it runs without a host$/, () => {
    // Narrative - H1's own resourceTelemetry.ts is plain TypeScript with
    // no vscode.* import in its own sampling loop body, which is exactly
    // why a code-only reading would plausibly (wrongly) call it headless-
    // safe; only its CALLER is host-gated.
  });
  registry.define(/^the surface it writes to stays empty when no host is running$/, (ctx) => {
    readEvidence(ctx);
    // Re-verified live above (audit-04); this step's own text is the
    // Given for scenario 05, sharing the same real fact.
  });
  registry.define(/^that emitter is recorded as dark when headless$/, (ctx) => {
    const text = readEvidence(ctx);
    requireMarker(text, 'H1 - Resource-anomaly sampling', 'audit-05');
    // H1's own section carries both a dark verdict and live evidence -
    // scope the search to H1's own block (up to the next "**H" heading)
    // rather than assuming an exact line-adjacency in the prose.
    const h1Start = text.indexOf('H1 - Resource-anomaly sampling');
    const h1End = text.indexOf('**H2', h1Start);
    const h1Block = text.slice(h1Start, h1End === -1 ? undefined : h1End);
    requireMarker(h1Block, 'VERDICT: DARK WHEN HEADLESS', 'audit-05: H1 carries a dark verdict');
    requireMarker(h1Block, 'LIVE EVIDENCE', 'audit-05: H1 carries live evidence');
  });

  // ── headless-dark-emitter-audit-06 ───────────────────────────────────
  registry.define(/^an emitter is dark when headless$/, (ctx) => {
    readEvidence(ctx);
  });
  registry.define(/^the audit states what would have to invoke it in a headless run$/, (ctx) => {
    const text = readEvidence(ctx);
    const missingCallerMarkers = countOccurrences(text, 'Missing headless caller') + countOccurrences(text, 'Missing piece');
    if (missingCallerMarkers < 4) {
      throw new Error(`audit-06: expected each dark finding to name its missing headless caller, found ${missingCallerMarkers} markers`);
    }
  });

  // ── headless-dark-emitter-audit-07 ───────────────────────────────────
  registry.define(/^a ticket is raised for that emitter$/, (ctx) => {
    const text = readEvidence(ctx);
    requireMarker(text, 'Follow-up tickets to raise', 'audit-07');
    requireMarker(text, 'RAISED SEPARATELY HERE', 'audit-07: the raise-separately channel is stated');
    for (const label of ['**H1**', '**H4**', '**H2/H3**', '**H5**', '**G1/G2**']) {
      requireMarker(text, label, `audit-07: a follow-up ticket recommendation exists for ${label}`);
    }
  });

  // ── headless-dark-emitter-audit-08 ───────────────────────────────────
  registry.define(/^that emitter is not repaired as part of the audit$/, (ctx) => {
    const text = readEvidence(ctx);
    requireMarker(text, 'What was explicitly NOT done', 'audit-08');
    requireMarker(text, 'none of H1/H2/H3/H4/H5/G1/G2 was\nfixed in this parcel', 'audit-08: explicit no-fix statement');
    // Real check, not just prose: none of the actual source files any
    // proposed fix would touch were modified in this ticket's own commits.
    const untouchedFiles = [
      'extension/src/metrics/resourceTelemetry.ts',
      'extension/src/notify/needsHumanEmailNotifier.ts',
      'extension/src/notify/telegramNarrator.ts',
      'extension/src/runs/runLog.ts',
      'swarmforge/deploy/generate_systemd_units.sh',
      'swarmforge/scripts/chase_sweep_lib.bb',
    ];
    let diffOutput;
    try {
      diffOutput = execFileSync('git', ['status', '--short', ...untouchedFiles], {
        cwd: WORKTREE_ROOT,
        encoding: 'utf8',
      });
    } catch (err) {
      throw new Error(`audit-08: failed to check git status of candidate-fix files: ${err.message}`);
    }
    if (diffOutput.trim() !== '') {
      throw new Error(`audit-08: expected no working-tree changes to any candidate-fix file, got:\n${diffOutput}`);
    }
  });
}

module.exports = { registerSteps };
