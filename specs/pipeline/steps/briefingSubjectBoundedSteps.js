'use strict';

// BL-392: step handlers for the briefing-email-subject-is-a-bounded-
// readable-headline feature. Drives the real build-briefing-subject
// (briefing_email_lib.bb) through briefing_subject_harness.bb - no
// filesystem fixture needed, the function takes date-label/content
// directly (no real network, no real clock).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const HARNESS = path.join(SWARMFORGE_SCRIPTS, 'test', 'briefing_subject_harness.bb');
const DATE_LABEL = '2026-07-14';
const HEADLINE_LIMIT = 80;

// A single unbroken sentence, well past the 80-char headline limit, with
// clean word boundaries throughout - lets the word-boundary assertion
// below prove the cut lands exactly at a space in the SOURCE line.
const LONG_LEDE =
  'This sentence is intentionally long enough that it will need to be truncated at eighty characters or fewer for the subject line to stay readable in an inbox.';

function buildSubject(content) {
  const out = execFileSync('bb', [HARNESS, DATE_LABEL, content], { encoding: 'utf8' });
  return JSON.parse(out).subject;
}

function headlinePart(subject) {
  const prefix = `SwarmForge briefing ${DATE_LABEL} - `;
  if (!subject.startsWith(prefix)) {
    throw new Error(`expected the subject to start with "${prefix}", got: ${JSON.stringify(subject)}`);
  }
  return subject.slice(prefix.length);
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  registry.define(/^the briefing email subject is built from the briefing's date and first non-empty line$/, () => {
    // Non-behavioral: asserted by every scenario below via buildSubject.
  });

  // ── subject-bound-01 ────────────────────────────────────────────────
  registry.define(/^a briefing whose first non-empty line is longer than the headline limit$/, (ctx) => {
    ctx.content = `${LONG_LEDE}\n\nDetails...`;
  });

  registry.define(/^the briefing email subject is built$/, (ctx) => {
    ctx.subject = buildSubject(ctx.content);
  });

  registry.define(/^the subject names the briefing date$/, (ctx) => {
    if (!ctx.subject.startsWith(`SwarmForge briefing ${DATE_LABEL}`)) {
      throw new Error(`expected the subject to name the briefing date, got: ${JSON.stringify(ctx.subject)}`);
    }
  });

  registry.define(/^its headline is no longer than the headline limit$/, (ctx) => {
    const headline = headlinePart(ctx.subject);
    if (headline.length > HEADLINE_LIMIT) {
      throw new Error(`expected the headline to be <= ${HEADLINE_LIMIT} chars, got ${headline.length}: ${JSON.stringify(headline)}`);
    }
  });

  registry.define(/^the headline is cut at a word boundary and ends with an ellipsis$/, (ctx) => {
    const headline = headlinePart(ctx.subject);
    if (!headline.endsWith('…')) {
      throw new Error(`expected the headline to end with a single-character ellipsis, got: ${JSON.stringify(headline)}`);
    }
    const withoutEllipsis = headline.slice(0, -1);
    if (!LONG_LEDE.startsWith(withoutEllipsis)) {
      throw new Error(`expected the truncated headline to be an unaltered prefix of the source line, got: ${JSON.stringify(withoutEllipsis)}`);
    }
    const nextChar = LONG_LEDE.charAt(withoutEllipsis.length);
    if (nextChar !== '' && nextChar !== ' ') {
      throw new Error(`expected the cut to land right before a space in the source (a word boundary), got next char: ${JSON.stringify(nextChar)}`);
    }
  });

  // ── subject-bound-02 ────────────────────────────────────────────────
  registry.define(/^a briefing whose first non-empty line contains bold and heading markdown$/, (ctx) => {
    ctx.content = '# **Ship the release**\n\nDetails...';
  });

  registry.define(/^the subject contains no markdown emphasis or heading markers$/, (ctx) => {
    if (/\*\*|(^|\s)#|_|`/.test(headlinePart(ctx.subject))) {
      throw new Error(`expected no markdown emphasis/heading markers in the headline, got: ${JSON.stringify(ctx.subject)}`);
    }
  });

  // ── subject-bound-03 ────────────────────────────────────────────────
  registry.define(/^a briefing whose first non-empty line is shorter than the headline limit$/, (ctx) => {
    ctx.content = 'Shipped BL-215\n\nDetails...';
  });

  registry.define(/^the subject's headline is that line unchanged$/, (ctx) => {
    if (headlinePart(ctx.subject) !== 'Shipped BL-215') {
      throw new Error(`expected the headline to pass through unchanged, got: ${JSON.stringify(ctx.subject)}`);
    }
  });

  registry.define(/^the subject contains no ellipsis$/, (ctx) => {
    if (ctx.subject.includes('…')) {
      throw new Error(`expected no ellipsis in a within-limit subject, got: ${JSON.stringify(ctx.subject)}`);
    }
  });

  // ── subject-bound-04 ────────────────────────────────────────────────
  registry.define(/^a briefing whose content is empty$/, (ctx) => {
    ctx.content = '';
  });

  registry.define(/^the subject names the briefing date with no trailing headline separator$/, (ctx) => {
    if (ctx.subject !== `SwarmForge briefing ${DATE_LABEL}`) {
      throw new Error(`expected a date-only subject with no dangling separator, got: ${JSON.stringify(ctx.subject)}`);
    }
  });
}

module.exports = { registerSteps };
