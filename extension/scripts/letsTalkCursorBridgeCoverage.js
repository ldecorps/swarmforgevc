#!/usr/bin/env node
// Reports statement coverage for Let's Talk + Cursor bridge modules.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COVERAGE_PATH = path.join(ROOT, 'coverage', 'coverage-final.json');
const TARGET_SUFFIXES = [
  'src/bridge/letsTalkCore.ts',
  'src/bridge/letsTalkRoutes.ts',
  'src/bridge/letsTalkAudio.ts',
  'src/bridge/letsTalkLocalAudio.ts',
  'src/bridge/letsTalkUiHtml.ts',
  'src/bridge/cursorBridgeAgentSession.ts',
  'src/tools/telegramCursorBridgeCore.ts',
  'src/tools/telegramCursorBridgeLive.ts',
  'src/tools/start-bridge-headless.ts',
];

const THRESHOLD = 90;

function pct(hit, total) {
  return total === 0 ? 100 : (hit / total) * 100;
}

function main() {
  if (!fs.existsSync(COVERAGE_PATH)) {
    console.error(`Missing ${COVERAGE_PATH}. Run npm run coverage:lets-talk-cursor-bridge first.`);
    process.exit(1);
  }
  const coverage = JSON.parse(fs.readFileSync(COVERAGE_PATH, 'utf8'));
  let totalStmts = 0;
  let hitStmts = 0;
  const rows = [];
  let failed = false;

  for (const suffix of TARGET_SUFFIXES) {
    const key = Object.keys(coverage).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
    if (!key) {
      rows.push({ file: suffix, pct: 0, hit: 0, total: 0, missing: true });
      failed = true;
      continue;
    }
    const vals = Object.values(coverage[key].s ?? {});
    const hit = vals.filter((v) => v > 0).length;
    const total = vals.length;
    const filePct = pct(hit, total);
    totalStmts += total;
    hitStmts += hit;
    rows.push({ file: suffix, pct: filePct, hit, total, missing: false });
    if (filePct < THRESHOLD) {
      failed = true;
    }
  }

  for (const row of rows) {
    const label = row.missing ? 'NO DATA' : `${row.pct.toFixed(1)}% (${row.hit}/${row.total})`;
    const flag = !row.missing && row.pct < THRESHOLD ? ' *** below 90% ***' : '';
    console.log(`${label.padStart(18)}  ${row.file}${flag}`);
  }
  const overall = pct(hitStmts, totalStmts);
  console.log(`\nOverall: ${overall.toFixed(1)}% (${hitStmts}/${totalStmts} statements)`);
  if (overall < THRESHOLD || rows.some((row) => !row.missing && Math.round(row.pct) < THRESHOLD)) {
    console.error(`\nCoverage gate failed: scoped files must reach ${THRESHOLD}%`);
    process.exit(1);
  }
  console.log(`\nCoverage gate passed (>= ${THRESHOLD}% per scoped file).`);
}

main();
