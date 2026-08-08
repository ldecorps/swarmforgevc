'use strict';

// BL-681: step handlers for "a consolidation never drops a human sentence" -
// the constitutional ratification (Article 5.3) of the hard constraint
// BL-680 already states as a role obligation in specifier.prompt. This
// ticket states law, not mechanics (out_of_scope excludes the consolidation
// mechanics themselves), so every scenario is a prose-content check against
// the real, already-committed constitution article and the real
// specifier.prompt citation - same "read the live file, assert on its
// literal content" pattern bl680ConsolidationAuthoritySteps.js and
// bl633InvariantsSectionSteps.js established for governance/prose tickets.
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const AMENDMENTS_ARTICLE_PATH = path.join(
  REPO_ROOT, 'swarmforge', 'constitution', 'articles', '05_amendments.md'
);
const SPECIFIER_PROMPT_PATH = path.join(REPO_ROOT, 'swarmforge', 'roles', 'specifier.prompt');

// Collapses markdown line-wrapping into single spaces so a substring check
// doesn't depend on exactly where a paragraph happens to wrap (same
// convention as bl680ConsolidationAuthoritySteps.js).
function readNormalizedDoc(docPath) {
  return fs.readFileSync(docPath, 'utf8').replace(/\s+/g, ' ');
}

function requireIncludes(text, fragment, label) {
  if (!text.includes(fragment)) {
    throw new Error(`expected ${label} to contain "${fragment}"`);
  }
}

// "the specifier role prompt" is a common Given across prose-content tickets
// (bl633, bl654, bl680); registry.resolve()'s unscoped fallback returns the
// first match in registration order, so an unscoped registration here would
// never fire. Scoped to THIS feature's title (bl680's precedent for the same
// collision), it wins only when this feature is running.
const FEATURE_NAME = 'a consolidation never drops a human sentence';

function registerSteps(registry) {
  // ── Background: the constitution's amendments article ───────────────────
  registry.define(/^the constitution's amendments article$/, (ctx) => {
    ctx.bl681ArticleText = readNormalizedDoc(AMENDMENTS_ARTICLE_PATH);
  });

  registry.defineScoped(
    /^the specifier role prompt$/,
    (ctx) => {
      ctx.bl681SpecifierText = readNormalizedDoc(SPECIFIER_PROMPT_PATH);
    },
    FEATURE_NAME
  );

  // ── Scenario 01: the clause exists and binds the act rather than a role ──
  registry.define(/^it states that a consolidation never drops a human sentence$/, (ctx) => {
    requireIncludes(ctx.bl681ArticleText, 'A consolidation never drops a human sentence.', '05_amendments.md');
  });

  registry.define(/^the clause names no specific role as its subject$/, (ctx) => {
    requireIncludes(ctx.bl681ArticleText, 'The clause binds the ACT of consolidating, not any one office.', '05_amendments.md');
  });

  // ── Scenario 02: the clause says what surviving means ────────────────────
  registry.define(/^it states that every directive quoted from a human survives verbatim$/, (ctx) => {
    requireIncludes(
      ctx.bl681ArticleText,
      'every directive quoted from a human survives verbatim into the resulting ticket or tickets',
      '05_amendments.md'
    );
  });

  registry.define(/^it states that a consolidation which cannot preserve one is refused rather than trimmed$/, (ctx) => {
    requireIncludes(ctx.bl681ArticleText, 'A consolidation that cannot preserve one is refused rather than trimmed.', '05_amendments.md');
  });

  // ── Scenario 03: the clause is reachable from the role that exercises it ─
  registry.define(/^it cites the constitutional clause as the binding source of the rule$/, (ctx) => {
    requireIncludes(
      ctx.bl681SpecifierText,
      'its binding source is **constitutional law, Article 5.3 "A consolidation never drops a human sentence"**',
      'the specifier prompt'
    );
  });
}

module.exports = { registerSteps };
