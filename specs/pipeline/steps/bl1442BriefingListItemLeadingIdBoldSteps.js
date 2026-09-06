'use strict';

// BL-1442: step handlers for "A briefing-email list item that opens with a
// ticket id renders that id in bold" (Art Director brief,
// docs/design/briefs/2026-09-06-briefing-list-item-scan-weight.md). Drives
// the real briefing_email_lib.bb (bold-leading-ticket-ids + render-briefing-html)
// through briefing_email_harness.bb - the same drive as
// bl1419BriefingEmailReflowSteps.js, reusing its shared harness-fixture
// helper. Scenarios 03/04 reuse BL-1419's own real-briefing fixture file
// directly - never a second copy of it.
const path = require('node:path');
const fs = require('node:fs');
const {
  ensureBriefingsDir: sharedEnsureBriefingsDir,
  writeBriefing: sharedWriteBriefing,
  runHarness: sharedRunHarness,
} = require('./lib/briefingEmailHarnessFixture');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');
const REAL_BRIEFING_FIXTURE = path.join(__dirname, 'fixtures', 'BL-1419-2026-09-05-briefing.md');
const FILE_NAME = '2026-09-05.md';

const FEATURE = "BL-1442 A briefing-email list item that opens with a ticket id renders that id in bold";

// Fixture-root hygiene (BL-459's acceptance sibling): the shared
// briefingEmailHarnessFixture.js helper (also used by briefingBodyHtmlSteps.js
// and bl1419BriefingEmailReflowSteps.js, both pre-existing and out of scope
// here) mkdtempSyncs a fixture dir but registers no cleanup of its own -
// every scenario in this file leaked its temp dir until now. Registered
// here, scoped to this file's own fixture roots only; the shared helper and
// its other two callers are untouched (BL-1442's own "one brief, one
// ticket" scope).
const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Every Examples: column value must be load-bearing (engineering.prompt):
// "nothing" is the one non-id value the <bold> column ever takes.
function parseBoldColumn(bold) {
  return bold === 'nothing' ? [] : bold.split(',').map((s) => s.trim());
}

function ensureBriefingsDir(ctx) {
  const alreadyHad = Boolean(ctx.briefingsDir);
  const dir = sharedEnsureBriefingsDir(ctx, 'aps-bl1442-briefing-bold-');
  if (!alreadyHad) {
    fixtureRoots.push(dir);
  }
  return dir;
}

function writeBriefing(briefingsDir, content) {
  sharedWriteBriefing(briefingsDir, FILE_NAME, content);
}

function runHarness(briefingsDir, mode) {
  return sharedRunHarness(HARNESS, briefingsDir, mode);
}

function countTag(html, tag) {
  return (html.match(new RegExp(`<${tag}[^>]*>`, 'g')) || []).length;
}

// Every <li>...</li> substring. render-list-block never nests a <li>
// inside another and never puts a newline inside one, so a non-greedy
// match between one <li> and the next </li> can never span more than one
// real item (the same property briefing_email_lib.bb's own
// bold-leading-ticket-ids relies on).
function liBlocks(html) {
  return html.match(/<li[^>]*>.*?<\/li>/g) || [];
}

function strongMatches(html) {
  return [...html.matchAll(/<strong([^>]*)>([^<]*)<\/strong>/g)];
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a briefing markdown written hard-wrapped at 74 columns$/, (ctx) => {
    // Framing only (BL-1419's own precedent) - every scenario below writes
    // its own fixture content directly.
    ctx.diagramMode = ctx.diagramMode || 'success';
  });

  scoped(/^the briefing email payload is built$/, (ctx) => {
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode || 'success');
  });

  // ── Scenario 01/02 shared Given ─────────────────────────────────────────
  scoped(/^the briefing contains a list item reading "(.+)"$/, (ctx, item) => {
    ctx.item = item;
    writeBriefing(ensureBriefingsDir(ctx), `- ${item}\n`);
  });

  // ── Scenario 01 Then ─────────────────────────────────────────────────────
  scoped(/^that list item renders exactly (.+) in bold$/, (ctx, boldColumn) => {
    const expected = parseBoldColumn(boldColumn);
    const html = ctx.result.lastSentHtml || '';
    const li = liBlocks(html)[0] || '';
    const actual = strongMatches(li).map((m) => m[2]);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`expected exactly ${JSON.stringify(expected)} bold in the item, got ${JSON.stringify(actual)}: ${li}`);
    }
  });

  // ── Scenario 02 Then ─────────────────────────────────────────────────────
  scoped(/^every <strong> inside an <li> carries font-weight:600 inline and no color$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    for (const li of liBlocks(html)) {
      for (const [, attrs] of strongMatches(li)) {
        const styleMatch = /style="([^"]*)"/.exec(attrs);
        if (!styleMatch || styleMatch[1] !== 'font-weight:600') {
          throw new Error(`expected every <strong> inside an <li> to carry style="font-weight:600" and nothing else, got attrs="${attrs}" in: ${li}`);
        }
      }
    }
  });

  scoped(/^the HTML part contains no <style> block$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (html.includes('<style')) {
      throw new Error(`expected no <style> block at all, got: ${html}`);
    }
  });

  // ── Scenario 03/04 shared Given ──────────────────────────────────────────
  scoped(/^docs\/briefings\/2026-09-05\.md as the briefing$/, (ctx) => {
    ctx.diagramMode = 'success';
    const content = fs.readFileSync(REAL_BRIEFING_FIXTURE, 'utf8');
    ctx.realBriefingContent = content;
    writeBriefing(ensureBriefingsDir(ctx), content);
  });

  // ── Scenario 03 Then ──────────────────────────────────────────────────────
  scoped(/^the HTML part still has exactly (\d+) <li>$/, (ctx, expectedLi) => {
    const html = ctx.result.lastSentHtml || '';
    const liCount = countTag(html, 'li');
    if (liCount !== Number(expectedLi)) {
      throw new Error(`expected exactly ${expectedLi} <li>, got ${liCount}`);
    }
  });

  scoped(/^exactly (\d+) <li> open with a bold ticket id$/, (ctx, expectedCount) => {
    const html = ctx.result.lastSentHtml || '';
    const openWithBoldId = liBlocks(html).filter((li) => /^<li[^>]*><strong style="font-weight:600">(?:BL|GH)-\d+<\/strong>/.test(li));
    if (openWithBoldId.length !== Number(expectedCount)) {
      throw new Error(`expected exactly ${expectedCount} <li> opening with a bold ticket id, got ${openWithBoldId.length}`);
    }
  });

  scoped(/^exactly (\d+) ticket ids render bold in the whole HTML part, one per id in an item's leading label$/, (ctx, expectedCount) => {
    const html = ctx.result.lastSentHtml || '';
    const boldIds = [...html.matchAll(/<strong style="font-weight:600">((?:BL|GH)-\d+)<\/strong>/g)];
    if (boldIds.length !== Number(expectedCount)) {
      throw new Error(`expected exactly ${expectedCount} bold ticket ids, got ${boldIds.length}: ${boldIds.map((m) => m[1]).join(', ')}`);
    }
  });

  // ── Scenario 04 Then ──────────────────────────────────────────────────────
  scoped(/^the plain-text part is byte-identical to the composed markdown$/, (ctx) => {
    if (ctx.result.lastSentText !== ctx.realBriefingContent) {
      throw new Error(
        `expected the plain-text part to be byte-identical to the composed markdown; got: ${JSON.stringify(ctx.result.lastSentText)} vs ${JSON.stringify(ctx.realBriefingContent)}`
      );
    }
  });

  scoped(/^the briefing file on disk is byte-identical to the fixture$/, (ctx) => {
    const onDisk = fs.readFileSync(path.join(ensureBriefingsDir(ctx), FILE_NAME), 'utf8');
    if (onDisk !== ctx.realBriefingContent) {
      throw new Error('expected the briefing file on disk to be byte-identical to the fixture - it was rewritten');
    }
  });
}

module.exports = { registerSteps };
