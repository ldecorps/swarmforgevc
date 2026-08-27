'use strict';

// BL-781 scenario 07: classify git-grep hits as live callers vs non-live
// references (history, docs, acceptance prose that names retired basenames
// to assert their absence, step handlers, and dedicated test runners).

/**
 * @param {string} relPath repo-relative path from `git grep -l`
 * @returns {boolean} true when the hit is a live product/caller reference
 */
function isLiveGrepOffender(relPath) {
  const norm = String(relPath || '').replace(/^\.\//, '');
  if (norm.startsWith('backlog/') || norm.startsWith('docs/')) return false;
  if (norm.startsWith('specs/pipeline/steps/')) return false;
  if (norm.startsWith('swarmforge/scripts/test/')) return false;
  // Feature Examples name the retired basenames to assert absence — not live callers (QA D1).
  if (norm.startsWith('specs/features/')) return false;
  return norm.length > 0;
}

module.exports = { isLiveGrepOffender };
