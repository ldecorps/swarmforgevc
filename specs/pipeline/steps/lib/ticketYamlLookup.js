'use strict';

const fs = require('node:fs');
const path = require('node:path');

// BL-1462: mirrors pre_qa_gate_gather_lib.bb's find-ticket-yaml-content
// search order (backlog/active, then backlog/paused, then backlog/done -
// milestone subdirectories included) so this step-file world has no SECOND
// idea of where a ticket's YAML lives. Pinned to the bb function by a test
// that runs both sides over the same fixture (BL-897's mirror rule) -
// extension/test/bl1462TicketYamlLookupAgreement.test.js.
const SEARCH_ORDER = ['active', 'paused', 'done'];

function readYamlField(content, field) {
  const prefix = `${field}: `;
  for (const line of content.split('\n')) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }
  return null;
}

function findYamlWithId(dir, ticketId) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findYamlWithId(full, ticketId);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      const content = fs.readFileSync(full, 'utf8');
      if (readYamlField(content, 'id') === ticketId) {
        return full;
      }
    }
  }
  return null;
}

// Resolves ticketId's own backlog YAML path under projectRoot's
// backlog/active, backlog/paused, backlog/done (nested-under-milestone
// included) - in that order. Null when not found anywhere, rather than
// throwing, so a step handler asserting on it fails NAMING the missing
// precondition instead of producing an opaque stack trace.
function resolveTicketYamlPath(projectRoot, ticketId) {
  for (const sub of SEARCH_ORDER) {
    const found = findYamlWithId(path.join(projectRoot, 'backlog', sub), ticketId);
    if (found) return found;
  }
  return null;
}

module.exports = { resolveTicketYamlPath, readYamlField, SEARCH_ORDER };
