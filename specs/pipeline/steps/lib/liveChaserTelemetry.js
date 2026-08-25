'use strict';

/**
 * BL-987 / BL-336 invariant 2: live chaser telemetry path is derived at run
 * time the same way the writer composes it (resourceTelemetry.monthlyTelemetryFile),
 * never a calendar-month literal.
 *
 * Prefer the compiled extension helper when present; fall back to the same
 * YYYY-MM composition so the audit stays loadable before a compile.
 */
const path = require('node:path');
const fs = require('node:fs');

function composeMonthlyChaserPath(targetPath, atMs) {
  const monthKey = new Date(atMs).toISOString().slice(0, 7);
  return path.join(targetPath, '.swarmforge', 'telemetry', `chaser-${monthKey}.jsonl`);
}

function loadCompiledMonthlyTelemetryFile() {
  const compiled = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'extension',
    'out',
    'metrics',
    'resourceTelemetry.js'
  );
  if (!fs.existsSync(compiled)) return null;
  try {
    const mod = require(compiled);
    return typeof mod.monthlyTelemetryFile === 'function' ? mod.monthlyTelemetryFile : null;
  } catch {
    return null;
  }
}

function liveChaserTelemetryPath(targetPath, atMs = Date.now()) {
  const compiled = loadCompiledMonthlyTelemetryFile();
  if (compiled) return compiled(targetPath, atMs);
  return composeMonthlyChaserPath(targetPath, atMs);
}

function countResourceSampleLines(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').filter((l) => l.includes('"type":"resource_sample"')).length;
}

module.exports = {
  composeMonthlyChaserPath,
  liveChaserTelemetryPath,
  countResourceSampleLines,
};
