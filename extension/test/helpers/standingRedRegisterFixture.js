'use strict';

// BL-1429: the standing-red register row-writer shared by the unit test,
// the property test, and the acceptance step handler - all three built the
// same loop independently (writeRegisterFixture / writeStandingCategory),
// differing only in the fixture file-name prefix embedded in each row's
// path column. Factored out here at the cleaner stage (cleanup pass,
// 2026-09-05) so the register-row shape (owned tickets minted into
// backlog/active/, unowned ones left absent, one shared oldestAgeDays
// across every row so the report's MAX-based oldest_age_days is exactly
// that value) is defined once.
const fs = require('node:fs');
const path = require('node:path');

// Writes `count` register rows sharing `oldestAgeDays`; the first
// `unownedCount` name a ticket that resolves absent (never minted), the
// rest name a ticket minted into backlog/active/ (resolves owned). count 0
// writes an empty register (no rows at all - oldest_age_days reads back
// null).
function writeStandingRedRegisterFixture(root, { count, oldestAgeDays, unownedCount = 0, filePrefix = 'bl1429-fixture' }) {
  const firstSeen = new Date(Date.now() - oldestAgeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const owned = i >= unownedCount;
    const ticket = owned ? `BL-9${800 + i}` : `BL-9${900 + i}`;
    rows.push(`unit\textension/test/${filePrefix}-${i}.test.js\t${ticket}\t${firstSeen}\tfixture row`);
    if (owned) {
      const activeDir = path.join(root, 'backlog', 'active');
      fs.mkdirSync(activeDir, { recursive: true });
      fs.writeFileSync(path.join(activeDir, `${ticket}-fixture.yaml`), `id: ${ticket}\ntitle: t\nstatus: todo\n`);
    }
  }
  const registerPath = path.join(root, 'backlog', 'standing-reds.tsv');
  fs.mkdirSync(path.dirname(registerPath), { recursive: true });
  fs.writeFileSync(registerPath, `# fixture register\n${rows.join('\n')}\n`);
}

module.exports = { writeStandingRedRegisterFixture };
