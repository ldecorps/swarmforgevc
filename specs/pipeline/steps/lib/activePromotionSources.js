'use strict';

// BL-1083: finds every production source that MOVES a ticket into
// backlog/active/, so each can be held to the promotion-gates chokepoint.
//
// The defect was not that a gate was wrong - promotion_gates_lib.bb is correct
// - but that a second way in existed beside it, and nothing noticed. So the
// check has to be an enumeration rather than a spot check on the paths anyone
// happens to remember: on 2026-08-22 the forgotten path promoted BL-1078 onto
// an unlanded BL-713.
//
// DETECTION, and its deliberate limits. A file counts when it both performs a
// move AND names backlog/active as a move DESTINATION. Naming the folder is
// not enough - a dozen files read it, count it, or move things OUT of it
// (expedite_lib.bb's active->done, ticket_close_guard_lib.bb's close check),
// and sweeping those in would make the check noise. Destination-shaped means
// the folder appears in a variable or expression whose own name says
// destination, which is how both real movers are written and how a third would
// have to be written to be legible at all.
//
// Test trees are excluded: a fixture that moves a file into a fake
// backlog/active is not a promotion path, and treating it as one would force
// every fixture to carry the gates.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

const SEARCH_ROOTS = [
  path.join(REPO_ROOT, 'extension', 'src'),
  path.join(REPO_ROOT, 'swarmforge', 'scripts'),
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.sh', '.bb']);

// Excluded as a directory NAME anywhere in the path, so both
// swarmforge/scripts/test/ and extension/src/**/test/ are covered.
const EXCLUDED_DIRS = new Set(['test', 'tests', 'node_modules', 'out']);

const MOVE_VERB = /\brenameSync\b|\bgit\s+mv\b|(^|[;&|]\s*|\s)mv\s|\bfs\/move\b|\bmoveBacklogFileTo\b/;

// The folder in a destination-shaped position: a destination-named binding, or
// a move whose target argument is the active folder on the same line.
const ACTIVE_DESTINATION = [
  /\b(dest|DEST|destDir|DEST_DIR|destination|ACTIVE_DIR|activeDir)\b[^\n]{0,80}backlog[\/'",\s]+active/i,
  /\b(dest|DEST|destDir|DEST_DIR|destination)\b\s*=\s*"?\$?\{?(ACTIVE_DIR|activeDir)\b/,
];

function listSourceFiles(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) listSourceFiles(full, acc);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      acc.push(full);
    }
  }
  return acc;
}

/** Every production source that moves a ticket INTO backlog/active/. */
function findActivePromotionSources() {
  const found = [];
  for (const root of SEARCH_ROOTS) {
    for (const file of listSourceFiles(root, [])) {
      const text = fs.readFileSync(file, 'utf8');
      if (!MOVE_VERB.test(text)) continue;
      if (!ACTIVE_DESTINATION.some((re) => re.test(text))) continue;
      found.push(path.relative(REPO_ROOT, file));
    }
  }
  return found.sort();
}

/** True when a source takes its verdict from the shared chokepoint. */
function referencesPromotionGates(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8').includes('promotion_gates');
}

// Gate RULE names, as opposed to the chokepoint's own name. Finding these as
// live code outside promotion_gates_lib.bb means the rules were copied rather
// than consulted - the BL-897 shape, which passes a feature file today and
// drifts within weeks.
const GATE_RULE_NAMES = ['depends_on', 'active_backlog_max_depth', 'human_approval'];

// Comments are where these names BELONG outside the chokepoint: explaining why
// the verdict is taken rather than recomputed is exactly the right thing to
// write down. Only live code is a second copy.
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/^[ \t]*;;.*$/gm, '')
    .replace(/^[ \t]*#(?![!]).*$/gm, '');
}

/** Gate-rule names appearing as live code in a source. */
function gateRuleNamesInCode(relPath) {
  const code = stripComments(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
  return GATE_RULE_NAMES.filter((name) => code.includes(name));
}

module.exports = {
  REPO_ROOT,
  GATE_RULE_NAMES,
  findActivePromotionSources,
  referencesPromotionGates,
  gateRuleNamesInCode,
  stripComments,
};
