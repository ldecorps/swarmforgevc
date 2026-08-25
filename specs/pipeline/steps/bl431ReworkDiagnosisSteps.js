'use strict';

// BL-431 (epic BL-429 slice 2 - DIAGNOSE + ESCALATE): step handlers for
// "the swarm diagnoses where it is suboptimal and escalates what it cannot
// safely fix". Drives the REAL compiled reworkDiagnosis.js
// (diagnoseReworkSignal/classifyRemediationDisposition) over a fixture
// ReworkSignal, plus the real compiled suboptimality-verdict-line.js's pure
// formatter for scenario 05 ("reaches the human through the existing
// surface"). Written alongside the implementation per BL-233 (the coder
// wires step handlers in the same parcel); this domain activates once the
// specifier promotes the sibling .feature.draft to a live .feature (still
// parked on BL-430's dependency at write time).
const path = require('node:path');

const DIAGNOSIS_MODULE = path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'reworkDiagnosis.js');
const VERDICT_LINE_MODULE = path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'suboptimality-verdict-line.js');

const KNOWN_DISPOSITIONS = new Set(['auto-tunable', 'escalate-only']);

function baseSignal(overrides = {}) {
  return {
    hasSample: true,
    sampleCount: 8,
    reworkRate: 0.5,
    baselineRate: 0.2,
    topRole: null,
    topTicketClass: null,
    ...overrides,
  };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.define(/^a persisted rework signal with a current rate and a trailing baseline$/, (ctx) => {
    ctx.signal = baseSignal();
  });

  // ── rework-diagnosis-and-escalation-01 / 02 ──────────────────────────────
  registry.define(/^the current rework rate is meaningfully above the trailing baseline$/, (ctx) => {
    ctx.signal.baselineRate = 0.2;
    ctx.signal.reworkRate = 0.6; // > 2x baseline
  });

  registry.define(/^the current rework rate is at or below the trailing baseline$/, (ctx) => {
    ctx.signal.baselineRate = 0.2;
    ctx.signal.reworkRate = 0.15;
  });

  registry.define(/^the swarm diagnoses its health$/, (ctx) => {
    const { diagnoseReworkSignal } = require(DIAGNOSIS_MODULE);
    ctx.verdict = diagnoseReworkSignal(ctx.signal);
  });

  registry.define(/^it produces a verdict ranking where it is most suboptimal$/, (ctx) => {
    if (!ctx.verdict) {
      throw new Error('expected a verdict, got none');
    }
    if (typeof ctx.verdict.likelyCause !== 'string' || typeof ctx.verdict.recommendedAction !== 'string') {
      throw new Error(`expected a ranked verdict with a likely cause and recommended action, got ${JSON.stringify(ctx.verdict)}`);
    }
  });

  registry.define(/^it produces no verdict$/, (ctx) => {
    if (ctx.verdict !== null) {
      throw new Error(`expected no verdict, got ${JSON.stringify(ctx.verdict)}`);
    }
  });

  // ── rework-diagnosis-and-escalation-03 ───────────────────────────────────
  registry.define(/^the rework concentrates on one role and one ticket-class$/, (ctx) => {
    ctx.signal.topRole = 'architect';
    ctx.signal.topTicketClass = 'high';
  });

  registry.define(/^the verdict names that role and that ticket-class as the likely cause$/, (ctx) => {
    if (!ctx.verdict.likelyCause.includes('architect') || !ctx.verdict.likelyCause.includes('high')) {
      throw new Error(`expected the likely cause to name both "architect" and "high", got "${ctx.verdict.likelyCause}"`);
    }
  });

  // ── rework-diagnosis-and-escalation-04 (Scenario Outline) ────────────────
  registry.define(/^a verdict recommending (.+)$/, (ctx, remediation) => {
    ctx.remediation = remediation;
  });

  registry.define(/^the swarm classifies the recommended action$/, (ctx) => {
    const { classifyRemediationDisposition } = require(DIAGNOSIS_MODULE);
    ctx.disposition = classifyRemediationDisposition(ctx.remediation);
  });

  registry.define(/^the action is marked (.+)$/, (ctx, disposition) => {
    if (!KNOWN_DISPOSITIONS.has(disposition)) {
      throw new Error(`unknown disposition example value: "${disposition}"`);
    }
    if (ctx.disposition !== disposition) {
      throw new Error(`expected disposition "${disposition}", got "${ctx.disposition}"`);
    }
  });

  // ── rework-diagnosis-and-escalation-05 ───────────────────────────────────
  registry.define(/^a verdict ranking where the swarm is most suboptimal$/, (ctx) => {
    ctx.signal.baselineRate = 0.2;
    ctx.signal.reworkRate = 0.6;
    ctx.signal.topRole = 'hardener';
    const { diagnoseReworkSignal } = require(DIAGNOSIS_MODULE);
    ctx.verdict = diagnoseReworkSignal(ctx.signal);
  });

  registry.define(/^the swarm surfaces the verdict$/, (ctx) => {
    const { formatSuboptimalityVerdictLine } = require(VERDICT_LINE_MODULE);
    ctx.surfacedLine = formatSuboptimalityVerdictLine(ctx.verdict);
  });

  registry.define(/^it appears in the surface the human already reads for swarm health$/, (ctx) => {
    if (typeof ctx.surfacedLine !== 'string' || ctx.surfacedLine.trim().length === 0) {
      throw new Error('expected a non-blank surfaced verdict line');
    }
    if (!ctx.surfacedLine.startsWith('Suboptimality verdict:')) {
      throw new Error(`expected the briefing-line format, got "${ctx.surfacedLine}"`);
    }
  });
}

module.exports = { registerSteps };
