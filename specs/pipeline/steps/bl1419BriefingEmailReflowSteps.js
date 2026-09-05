'use strict';

// BL-1419: step handlers for "the daily briefing email reflows its text
// and reads well on a phone". Drives the real briefing_email_lib.bb
// (render-briefing-html + markdown_to_html_lib.bb's block-aware renderer)
// through briefing_email_harness.bb (BL-214's own harness) - no real
// render binary, no real email send, no live daemon. Each scenario writes
// its own fixture content directly (no adapters), matching
// briefingBodyHtmlSteps.js's own convention for this exact harness.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_email_harness.bb');
const REAL_BRIEFING_FIXTURE = path.join(__dirname, 'fixtures', 'BL-1419-2026-09-05-briefing.md');
const FILE_NAME = '2026-09-05.md';

const FEATURE = 'BL-1419 The daily briefing email reflows its text and reads well on a phone';

function ensureBriefingsDir(ctx) {
  if (!ctx.briefingsDir) {
    ctx.briefingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1419-briefing-reflow-'));
  }
  return ctx.briefingsDir;
}

function writeBriefing(briefingsDir, content) {
  fs.writeFileSync(path.join(briefingsDir, FILE_NAME), content);
}

function runHarness(briefingsDir, mode) {
  const out = execFileSync('bb', [HARNESS, briefingsDir, mode], { encoding: 'utf8' });
  return JSON.parse(out);
}

// Every open-tag occurrence of `tag`, so a scenario can assert exactly one
// (or exactly N) block element was produced, not merely that the text
// happens to be present somewhere.
function countTag(html, tag) {
  return (html.match(new RegExp(`<${tag}[^>]*>`, 'g')) || []).length;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a briefing markdown written hard-wrapped at 74 columns$/, (ctx) => {
    // Framing only - every scenario below writes its own fixture content,
    // hard-wrapped the same way the documenter's own real briefings are.
    ctx.diagramMode = ctx.diagramMode || 'success';
  });

  scoped(/^the briefing email payload is built$/, (ctx) => {
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode);
  });

  // ── Scenario 01 (Outline): consecutive wrapped lines render as one block ──
  const CONSTRUCT_FIXTURES = {
    'a paragraph': {
      content: 'This is a paragraph\nthat wraps across two\nlines of text.\n',
      joinedText: 'This is a paragraph that wraps across two lines of text.',
    },
    'a blockquote of "> " lines': {
      content: '> Line one of the\n> quote continues here.\n',
      joinedText: 'Line one of the quote continues here.',
    },
    'a bold span that wraps across two lines': {
      content: '**Bold text that\nwraps** and more.\n',
      joinedText: null, // asserted separately below - the strong element only wraps the bold span itself
    },
  };

  scoped(/^the briefing contains (.+) spanning several wrapped lines$/, (ctx, construct) => {
    const fixture = CONSTRUCT_FIXTURES[construct];
    if (!fixture) {
      throw new Error(`unknown <construct>: ${construct}`);
    }
    ctx.construct = construct;
    ctx.constructFixture = fixture;
    writeBriefing(ensureBriefingsDir(ctx), fixture.content);
  });

  scoped(/^the HTML part renders it as one (\w+) whose text joins the lines with single spaces$/, (ctx, element) => {
    const html = ctx.result.lastSentHtml || '';
    const count = countTag(html, element);
    if (count !== 1) {
      throw new Error(`expected exactly one <${element}>, got ${count}: ${html}`);
    }
    if (element === 'strong') {
      if (!/<strong[^>]*>Bold text that wraps<\/strong>/.test(html)) {
        throw new Error(`expected the wrapped bold span to close as one <strong> with single-spaced text, got: ${html}`);
      }
    } else {
      const joined = ctx.constructFixture.joinedText;
      if (!html.includes(joined)) {
        throw new Error(`expected the <${element}> text to read "${joined}" (lines joined with single spaces), got: ${html}`);
      }
    }
  });

  // ── Scenario 02: a "- " list with continuation renders as one list ──────
  scoped(/^the briefing contains a list of three "- " items each with indented continuation lines$/, (ctx) => {
    writeBriefing(
      ensureBriefingsDir(ctx),
      [
        '- first item begins here',
        '  and continues on this indented line.',
        '- second item begins here',
        '  and also continues indented.',
        '- third item, no continuation.',
        '',
      ].join('\n')
    );
  });

  scoped(/^the HTML part renders one <ul> with exactly three <li>$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (countTag(html, 'ul') !== 1) {
      throw new Error(`expected exactly one <ul>, got: ${html}`);
    }
    if (countTag(html, 'li') !== 3) {
      throw new Error(`expected exactly three <li>, got: ${html}`);
    }
    if (!html.includes('first item begins here and continues on this indented line')) {
      throw new Error(`expected the first item's continuation line to be joined in, got: ${html}`);
    }
  });

  scoped(/^no <p> or <li> in the HTML part begins with "- ", "> " or two spaces$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    const ragged = html.match(/<(?:p|li)[^>]*>(?:- |&gt; |  )/g);
    if (ragged) {
      throw new Error(`expected no <p>/<li> to begin with a raw markdown marker, got: ${JSON.stringify(ragged)}`);
    }
  });

  // ── Scenario 03: backtick spans and headings ─────────────────────────
  scoped(/^the briefing contains backtick spans inside a paragraph and ## headings$/, (ctx) => {
    writeBriefing(
      ensureBriefingsDir(ctx),
      ['## A heading', '', 'Run `bb foo.bb` to see it.', '', '## Another heading', ''].join('\n')
    );
  });

  scoped(/^each backtick span renders as a <code> element and each heading as an <h2>$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (!/<code[^>]*>bb foo\.bb<\/code>/.test(html)) {
      throw new Error(`expected the backtick span to render as <code>, got: ${html}`);
    }
    if (countTag(html, 'h2') !== 2) {
      throw new Error(`expected two <h2> headings, got: ${html}`);
    }
  });

  // ── Scenario 04: phone layout with inline styles ─────────────────────
  scoped(/^the HTML part wraps the body in a single column with a declared maximum width and a font stack$/, (ctx) => {
    ctx.diagramMode = 'diagram-available';
    writeBriefing(ensureBriefingsDir(ctx), 'Layout body text.\n');
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode);
    const html = ctx.result.lastSentHtml || '';
    if (!/<div style="[^"]*max-width:640px[^"]*font-family:[^"]*">/.test(html)) {
      throw new Error(`expected a single bounded-width column with a font stack, got: ${html}`);
    }
  });

  scoped(/^every block element carries its spacing and type styles inline$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    if (!/<p style="[^"]+">Layout body text\.<\/p>/.test(html)) {
      throw new Error(`expected the body paragraph to carry an inline style, got: ${html}`);
    }
    if (html.includes('<style')) {
      throw new Error(`expected no <style> block at all (mail clients drop them), got: ${html}`);
    }
  });

  scoped(/^a header names the briefing and its date before the first section$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    const headerIdx = html.indexOf('SwarmForge briefing');
    const dateIdx = html.indexOf('2026-09-05');
    const bodyIdx = html.indexOf('Layout body text.');
    if (headerIdx === -1 || dateIdx === -1 || bodyIdx === -1) {
      throw new Error(`expected a header naming the briefing and its date, and the body, all present; got: ${html}`);
    }
    if (!(headerIdx < bodyIdx && dateIdx < bodyIdx)) {
      throw new Error(`expected the header (name + date) to come before the first section (the body); got: ${html}`);
    }
  });

  scoped(/^the diagrams section appears under its own heading after the body$/, (ctx) => {
    const html = ctx.result.lastSentHtml || '';
    const bodyIdx = html.indexOf('Layout body text.');
    const diagramsHeadingIdx = html.indexOf('Diagrams');
    if (diagramsHeadingIdx === -1 || !(bodyIdx < diagramsHeadingIdx)) {
      throw new Error(`expected a "Diagrams" heading after the body; got: ${html}`);
    }
    if (!html.includes('cid:architecture-diagram')) {
      throw new Error(`expected the diagram content itself to follow its heading; got: ${html}`);
    }
  });

  // ── Scenario 05: the plain-text part is untouched ────────────────────
  scoped(/^the plain-text part is byte-identical to the composed markdown$/, (ctx) => {
    ctx.diagramMode = 'success';
    const content = 'Composed markdown,\nunchanged by any HTML rendering.\n';
    writeBriefing(ensureBriefingsDir(ctx), content);
    ctx.result = runHarness(ensureBriefingsDir(ctx), ctx.diagramMode);
    if (ctx.result.lastSentText !== content) {
      throw new Error(
        `expected the plain-text part to be byte-identical to the composed markdown; got: ${JSON.stringify(ctx.result.lastSentText)} vs ${JSON.stringify(content)}`
      );
    }
  });

  // ── Scenario 06: the real 2026-09-05 briefing renders clean ──────────
  scoped(/^docs\/briefings\/2026-09-05\.md as the briefing$/, (ctx) => {
    ctx.diagramMode = 'success';
    const content = fs.readFileSync(REAL_BRIEFING_FIXTURE, 'utf8');
    ctx.realBriefingContent = content;
    writeBriefing(ensureBriefingsDir(ctx), content);
  });

  scoped(/^the HTML part has exactly (\d+) <li>, one <blockquote>, three <h2>$/, (ctx, expectedLi) => {
    const html = ctx.result.lastSentHtml || '';
    const liCount = countTag(html, 'li');
    const blockquoteCount = countTag(html, 'blockquote');
    const h2Count = countTag(html, 'h2');
    if (liCount !== Number(expectedLi)) {
      throw new Error(`expected exactly ${expectedLi} <li>, got ${liCount}`);
    }
    if (blockquoteCount !== 1) {
      throw new Error(`expected exactly one <blockquote>, got ${blockquoteCount}`);
    }
    if (h2Count !== 3) {
      throw new Error(`expected exactly three <h2>, got ${h2Count}`);
    }
  });
}

module.exports = { registerSteps };
