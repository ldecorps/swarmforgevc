'use strict';

// BL-994: resolves the ACTUAL rendered grid column count for a given
// (paneCount, viewportWidth) from the real generated <style> text -
// jsdom does not evaluate @media queries against getComputedStyle (verified
// empirically: a jsdom window at innerWidth 1024 still reports a base,
// non-media grid-template-columns value), so this small, narrowly-scoped
// cascade resolver reads the REAL CSS text and applies the one media
// breakpoint the Live Screen stylesheet actually uses, rather than
// re-asserting a hand-typed column count divorced from the generated CSS
// (the qa_e2e directive: "assert the resolved column count, not the
// presence of a CSS string - a rule that exists but is overridden passes
// the weaker check").
//
// Scope is deliberately narrow: only `.split` / `.split.pane-count-N`
// selectors, only `grid-template-columns`, only one min-width breakpoint.
// Not a general CSS engine.

function extractStyleBlock(html) {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!match) {
    throw new Error('no <style> block found in getResidentSpyUiHtml() output');
  }
  // Strip /* ... */ comments before any rule parsing below - a selector
  // capture of `[^{}]+` otherwise swallows a preceding comment's own text
  // (including any literal .split inside the comment's PROSE), so an exact
  // selector match against ".split" never hits (found the hard way: this
  // stylesheet's own "Square-ish role tiles: CSS grid..." comment directly
  // precedes the .split rule).
  return match[1].replace(/\/\*[\s\S]*?\*\//g, '');
}

// Pulls every `@media (min-width: Npx) { ... }` block out of css (brace-depth
// aware, since the block body itself contains nested `{ }` rules), returning
// the remaining non-media css text plus the extracted blocks.
function splitMediaBlocks(css) {
  const mediaBlocks = [];
  let rest = '';
  let cursor = 0;
  const openRe = /@media\s*\(min-width:\s*(\d+)px\)\s*\{/g;
  let match;
  while ((match = openRe.exec(css))) {
    rest += css.slice(cursor, match.index);
    let depth = 1;
    let i = openRe.lastIndex;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    mediaBlocks.push({ minWidth: Number(match[1]), body: css.slice(openRe.lastIndex, i - 1) });
    cursor = i;
    openRe.lastIndex = i;
  }
  rest += css.slice(cursor);
  return { rest, mediaBlocks };
}

function columnsFromValue(value) {
  const repeatMatch = value.match(/repeat\((\d+),/);
  if (repeatMatch) {
    return Number(repeatMatch[1]);
  }
  if (/minmax\(/.test(value)) {
    return 1;
  }
  throw new Error(`cannot parse a column count from grid-template-columns: "${value}"`);
}

// Scans a css fragment for every rule whose selector list contains
// `selectorText` exactly, returning the LAST match's grid-template-columns
// value (source-order-wins, matching this stylesheet's own cascade - no
// selector here is repeated at differing specificity), or null.
function findRuleColumns(cssFragment, selectorText) {
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let found = null;
  let match;
  while ((match = ruleRe.exec(cssFragment))) {
    const selectors = match[1].split(',').map((s) => s.trim());
    if (selectors.includes(selectorText)) {
      const colMatch = match[2].match(/grid-template-columns:\s*([^;]+);/);
      if (colMatch) {
        found = colMatch[1].trim();
      }
    }
  }
  return found;
}

// The full resolution: base .split rule, overridden by a narrow-scope
// .pane-count-N rule if one exists, overridden again by a min-width media
// rule for .pane-count-N if the viewport is wide enough and one exists.
function resolveGridColumns(html, paneCount, viewportWidth) {
  const css = extractStyleBlock(html);
  const { rest, mediaBlocks } = splitMediaBlocks(css);

  let value = findRuleColumns(rest, `.split.pane-count-${paneCount}`) || findRuleColumns(rest, '.split');
  if (!value) {
    throw new Error(`could not resolve a base grid-template-columns value for pane count ${paneCount}`);
  }

  for (const block of mediaBlocks) {
    if (viewportWidth >= block.minWidth) {
      const override = findRuleColumns(block.body, `.split.pane-count-${paneCount}`);
      if (override) {
        value = override;
      }
    }
  }

  return columnsFromValue(value);
}

module.exports = { resolveGridColumns, extractStyleBlock };
