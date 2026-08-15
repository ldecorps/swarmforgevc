'use strict';

// BL-895: step handlers for "the BL-607 paragraph appears once in
// Specification.MD". Reads the REAL docs/reference/Specification.MD from
// the repo checkout - the whole point of this ticket is restoring that
// real file, so there is nothing to fixture; a copy would validate a
// stand-in, not the artifact the ticket is about.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SPEC_PATH = path.join(REPO_ROOT, 'docs', 'reference', 'Specification.MD');

const FEATURE_NAME = 'BL-895 the BL-607 paragraph appears once in Specification.MD';

const BL607_PREFIX = '**Pipeline role clarifying questions into per-role topics (BL-607).**';
const CORRECT_OPTIONS = `--options '["opt1","opt2"]'`;
const CORRUPT_OPTIONS = `--options ''[opt1,opt2]''`;
const CHAT_ADAPTER_HEADING =
  '### Chat adapter (Signal / Telegram / WhatsApp / Teams) — human channel only';
const BL354_MARKER = 'The pending question follows the human across threads (BL-354).';
const BL708_MARKER = "BL-607's relay transport was dark until BL-708 (2026-08-04).";

function nearestNonBlank(lines, start, dir) {
  let i = start;
  while (i >= 0 && i < lines.length && lines[i].trim() === '') {
    i += dir;
  }
  return i >= 0 && i < lines.length ? lines[i] : null;
}

function nearestHeadingAbove(lines, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    if (/^#{1,6}\s/.test(lines[i])) {
      return lines[i];
    }
  }
  return null;
}

function registerSteps(registry) {
  registry.defineScoped(
    /^the reference specification docs\/reference\/Specification\.MD$/,
    (ctx) => {
      ctx.specPath = SPEC_PATH;
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the specification is read$/,
    (ctx) => {
      ctx.content = fs.readFileSync(ctx.specPath, 'utf8');
      ctx.lines = ctx.content.split('\n');
      ctx.bl607Indices = ctx.lines.reduce((acc, line, i) => {
        if (line.startsWith(BL607_PREFIX)) {
          acc.push(i);
        }
        return acc;
      }, []);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the BL-607 clarifying-questions paragraph occurs exactly once$/,
    (ctx) => {
      if (ctx.bl607Indices.length !== 1) {
        throw new Error(
          `expected exactly 1 occurrence of the BL-607 paragraph, found ${ctx.bl607Indices.length}`,
        );
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the surviving BL-607 paragraph shows the single-quoted JSON options argument$/,
    (ctx) => {
      const line = ctx.lines[ctx.bl607Indices[0]];
      if (!line.includes(CORRECT_OPTIONS)) {
        throw new Error(`expected the surviving BL-607 paragraph to contain ${CORRECT_OPTIONS}`);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the corrupted unquoted options argument appears nowhere in the specification$/,
    (ctx) => {
      if (ctx.content.includes(CORRUPT_OPTIONS)) {
        throw new Error('expected the corrupted options argument to be absent, but it is still present');
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the surviving BL-607 paragraph sits under the chat adapter heading$/,
    (ctx) => {
      const heading = nearestHeadingAbove(ctx.lines, ctx.bl607Indices[0]);
      if (heading !== CHAT_ADAPTER_HEADING) {
        throw new Error(
          `expected the surviving BL-607 paragraph's nearest heading to be "${CHAT_ADAPTER_HEADING}", got "${heading}"`,
        );
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^it sits between the BL-354 pending-question paragraph and the BL-708 relay paragraph$/,
    (ctx) => {
      const bl607Idx = ctx.bl607Indices[0];
      const bl354Idx = ctx.lines.findIndex((l) => l.includes(BL354_MARKER));
      const bl708Idx = ctx.lines.findIndex((l) => l.includes(BL708_MARKER));
      if (bl354Idx === -1 || bl708Idx === -1) {
        throw new Error('expected to find both the BL-354 and BL-708 marker paragraphs');
      }
      if (!(bl354Idx < bl607Idx && bl607Idx < bl708Idx)) {
        throw new Error(`expected BL-354 (${bl354Idx}) < BL-607 (${bl607Idx}) < BL-708 (${bl708Idx})`);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^no bullet list has a body paragraph interleaved between its items$/,
    (ctx) => {
      const { lines } = ctx;
      // The historical defect spliced the BL-607 paragraph (and only that
      // paragraph) directly between adjacent list bullets. A fully generic
      // "any prose between any two bullets" scan false-positives on this
      // doc's normal structure (headings/labels/continuation lines
      // legitimately sit between bullets elsewhere), so this checks the
      // actual defect shape plus the concrete example the ticket names.
      for (const idx of ctx.bl607Indices) {
        const prev = nearestNonBlank(lines, idx - 1, -1);
        const next = nearestNonBlank(lines, idx + 1, 1);
        if (prev && next && /^-\s+\S/.test(prev) && /^-\s+\S/.test(next)) {
          throw new Error(`BL-607 paragraph at line ${idx + 1} sits directly between two bullet-list items`);
        }
      }

      const headingIdx = lines.findIndex((l) => l.startsWith('## Out of Scope (v1)'));
      if (headingIdx === -1) {
        throw new Error('expected to find the "## Out of Scope (v1)" heading');
      }
      let end = lines.length;
      for (let i = headingIdx + 1; i < lines.length; i++) {
        if (/^#{1,6}\s/.test(lines[i])) {
          end = i;
          break;
        }
      }
      const body = lines.slice(headingIdx + 1, end).filter((l) => l.trim() !== '');
      const nonBullet = body.filter((l) => !/^-\s+\S/.test(l));
      if (nonBullet.length !== 0) {
        throw new Error(
          `expected every non-blank line under "## Out of Scope (v1)" to be a bullet, found: ${nonBullet.join(' | ')}`,
        );
      }
    },
    FEATURE_NAME,
  );
}

module.exports = { registerSteps };
