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
  'src/tools/telegram-cursor-bridge.ts',
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

  for (const suffix of TARGET_SUFFIXES) {
    const key = Object.keys(coverage).find((k) => k.replace(/\\/g, '/').endsWith(suffix));
    if (!key) {
      rows.push({ file: suffix, pct: 0, hit: 0, total: 0, missing: true });
      continue;
    }
    const vals = Object.values(coverage[key].s ?? {});
    const hit = vals.filter((v) => v > 0).length;
    const total = vals.length;
    totalStmts += total;
    hitStmts += hit;
    rows.push({ file: suffix, pct: pct(hit, total), hit, total, missing: false });
  }

  for (const row of rows) {
    const label = row.missing ? 'NO DATA' : `${row.pct.toFixed(1)}% (${row.hit}/${row.total})`;
    console.log(`${label.padStart(18)}  ${row.file}`);
  }
  const overall = pct(hitStmts, totalStmts);
  console.log(`\nOverall: ${overall.toFixed(1)}% (${hitStmts}/${totalStmts} statements)`);
  if (overall < THRESHOLD) {
    console.error(`\nCoverage gate failed: ${overall.toFixed(1)}% < ${THRESHOLD}%`);
    process.exit(1);
  }
  console.log(`\nCoverage gate passed (>= ${THRESHOLD}%).`);
}

main();
