'use strict';

// Shared by evidence-report-backed audit step files (e.g. BL-335's
// shippedButInvisibleSteps.js, BL-336's headlessDarkEmitterAuditSteps.js):
// both re-check a durable backlog/evidence/<TICKET>-*.md report as their
// real artifact rather than trusting a fixture of it.
const path = require('node:path');
const fs = require('node:fs');

function findLatestEvidenceFile(evidenceDir, filenamePrefix, ticketLabel) {
  const candidates = fs
    .readdirSync(evidenceDir)
    .filter((f) => f.startsWith(filenamePrefix) && f.endsWith('.md'));
  if (candidates.length === 0) {
    throw new Error(`no ${ticketLabel} evidence report found under ${evidenceDir}`);
  }
  // Most recent by filename (the date suffix sorts lexicographically).
  candidates.sort();
  return path.join(evidenceDir, candidates[candidates.length - 1]);
}

function makeEvidenceReader(evidenceDir, filenamePrefix, ticketLabel) {
  return function readEvidence(ctx) {
    if (!ctx.evidence) {
      ctx.evidencePath = findLatestEvidenceFile(evidenceDir, filenamePrefix, ticketLabel);
      ctx.evidence = fs.readFileSync(ctx.evidencePath, 'utf8');
    }
    return ctx.evidence;
  };
}

module.exports = { findLatestEvidenceFile, makeEvidenceReader };
