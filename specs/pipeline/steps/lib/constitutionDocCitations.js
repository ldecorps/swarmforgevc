'use strict';

// BL-945: scans constitution articles for backtick-quoted `docs/...` paths
// cited as normative authority and reports any that do not resolve on disk
// (an agent worktree is a checkout of main, so "resolves on disk" ==
// "resolves on main" from every role's own vantage point). Scoped to
// backtick-quoted `docs/` paths specifically - not any backtick token with a
// dot in it - because the articles also backtick-quote scripts
// (`swarm_handoff.sh`), config (`swarmforge.conf`), API calls
// (`fs.mkdtempSync`), and bare cross-article filenames (`05_amendments.md`,
// `PIPELINE.md`) that were never meant to be checked here; a `docs/` prefix
// requirement excludes all of those without a false positive (verified
// 2026-08-19 against every real citation in swarmforge/constitution/articles/
// and its reference/ subdirectory) while still catching the one genuinely
// dangling citation this ticket exists to fix
// (docs/branding/icon-system.md). Source-comment citations
// (extension/src/concierge/epicIcon.ts, topicIcon.ts) are deliberately out of
// scope - constitution articles only.

const fs = require('node:fs');
const path = require('node:path');

const CITATION_RE = /`(docs\/[^`]+)`/g;

function extractDocCitations(text) {
  const citations = [];
  let match;
  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text)) !== null) {
    citations.push(match[1]);
  }
  return citations;
}

function isArticleFile(name) {
  return name.endsWith('.md') || name.endsWith('.prompt');
}

function listArticleFiles(articlesDir) {
  const files = fs
    .readdirSync(articlesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && isArticleFile(e.name))
    .map((e) => path.join(articlesDir, e.name));

  const refDir = path.join(articlesDir, 'reference');
  if (fs.existsSync(refDir)) {
    const refFiles = fs
      .readdirSync(refDir, { withFileTypes: true })
      .filter((e) => e.isFile() && isArticleFile(e.name))
      .map((e) => path.join(refDir, e.name));
    files.push(...refFiles);
  }

  return files.sort();
}

// Returns [{ file, citation }] for every citation that does not resolve
// under repoRoot - file is repo-relative, citation is the raw cited path.
function findUnresolvedCitations(articlesDir, repoRoot) {
  const unresolved = [];
  for (const file of listArticleFiles(articlesDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const citation of extractDocCitations(text)) {
      if (!fs.existsSync(path.join(repoRoot, citation))) {
        unresolved.push({ file: path.relative(repoRoot, file), citation });
      }
    }
  }
  return unresolved;
}

module.exports = { extractDocCitations, listArticleFiles, findUnresolvedCitations };
