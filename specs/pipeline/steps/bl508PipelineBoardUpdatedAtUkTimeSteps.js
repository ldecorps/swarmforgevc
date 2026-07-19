'use strict';

// BL-508: step handlers for the pipeline board updated-at footer rendering
// the injected instant in Europe/London time with an explicit BST/GMT marker.
// Drives the real compiled formatter rather than reimplementing board time
// rules in the acceptance layer.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { formatUpdatedAtLabel } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));

const KNOWN_UTC_INSTANTS = new Map([
  ['Jul 16 20:05', Date.UTC(2026, 6, 16, 20, 5)],
  ['Jan 05 03:07', Date.UTC(2026, 0, 5, 3, 7)],
  ['Jun 30 23:30', Date.UTC(2026, 5, 30, 23, 30)],
]);

const KNOWN_UK_LABELS = new Set(['Jul 16 21:05', 'Jan 05 03:07', 'Jul 01 00:30']);
const KNOWN_ZONE_MARKERS = new Set(['BST', 'GMT']);

function requireKnown(map, value, columnName) {
  if (!map.has(value)) {
    throw new Error(`BL-508: unrecognized <${columnName}> example value "${value}"`);
  }
  return map.get(value);
}

function requireKnownSet(set, value, columnName) {
  if (!set.has(value)) {
    throw new Error(`BL-508: unrecognized <${columnName}> example value "${value}"`);
  }
}

function registerSteps(registry) {
  registry.define(/^the last content-change instant is "([^"]+)" in UTC$/, (ctx, utc) => {
    ctx.lastContentChangeMs = requireKnown(KNOWN_UTC_INSTANTS, utc, 'utc');
  });

  registry.define(/^the pipeline board footer is rendered$/, (ctx) => {
    ctx.footerLabel = formatUpdatedAtLabel(ctx.lastContentChangeMs);
    ctx.footerText = `updated at ${ctx.footerLabel}`;
  });

  registry.define(/^the footer shows "([^"]+)" with the "([^"]+)" zone marker$/, (ctx, uk, zone) => {
    requireKnownSet(KNOWN_UK_LABELS, uk, 'uk');
    requireKnownSet(KNOWN_ZONE_MARKERS, zone, 'zone');
    const expected = `updated at ${uk} ${zone}`;
    if (ctx.footerText !== expected) {
      throw new Error(`expected footer "${expected}", got "${ctx.footerText}"`);
    }
  });
}

module.exports = { registerSteps };
