'use strict';

// BL-680: step handlers for "the specifier may merge and split intakes, not
// only drain them one to one". Scenarios 01-05 are prose-content checks
// against the real, already-amended specifier.prompt - same "read the live
// file, assert on its literal content" pattern bl633InvariantsSectionSteps.js
// and bl654InvariantPropertyTestSteps.js established for governance/prose
// tickets. Scenarios 06-07 drive the REAL compiled mergeIntakes/splitIntake
// (extension/out/tools/intakeConsolidationCore.js) in-process, so the two
// traceability scenarios exercise actual behavior, not a stub of the outcome
// (the same posture bl729CommitClaimCheckSteps.js established for a real
// pure module driven from Gherkin).
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SPECIFIER_PROMPT_PATH = path.join(REPO_ROOT, 'swarmforge', 'roles', 'specifier.prompt');
const { mergeIntakes, splitIntake } = require(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'intakeConsolidationCore'));

// Collapses markdown/prompt line-wrapping into single spaces so a substring
// check doesn't depend on exactly where a paragraph happens to wrap (same
// convention as bl633InvariantsSectionSteps.js / bl654InvariantPropertyTestSteps.js).
function readNormalizedDoc(docPath) {
  return fs.readFileSync(docPath, 'utf8').replace(/\s+/g, ' ');
}

function requireIncludes(text, fragment, label) {
  if (!text.includes(fragment)) {
    throw new Error(`expected ${label} to contain "${fragment}"`);
  }
}

const BOUND_SUBSTRINGS = {
  'a merged result still fits the slice size envelope': 'A merged result still fits the slice size envelope',
  'a ticket in the active backlog is never consolidated': 'a ticket in the active backlog is never consolidated',
};

// "the specifier role prompt" is also bl633InvariantsSectionSteps.js's exact
// Background step text (and others' - it's a common Given across prose-
// content tickets), registered earlier in specs/pipeline/steps/index.js's
// DOMAINS array. registry.resolve()'s unscoped fallback returns the first
// match in registration order, so an unscoped registration here would never
// fire. Scoped to THIS feature's title (bl654InvariantPropertyTestSteps.js's
// precedent for the same collision), it wins only when this feature is
// running; every other feature's identical Given is unaffected.
const FEATURE_NAME = 'the specifier may merge and split intakes, not only drain them one to one';

function registerSteps(registry) {
  // ── Background: the specifier role prompt ───────────────────────────────
  registry.defineScoped(
    /^the specifier role prompt$/,
    (ctx) => {
      ctx.bl680Text = readNormalizedDoc(SPECIFIER_PROMPT_PATH);
    },
    FEATURE_NAME
  );

  // ── Scenario 01: N-to-1 merge grant + traceability contract ─────────────
  registry.define(/^it instructs that several intakes may become one ticket$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'Several intakes may become one ticket', 'the specifier prompt');
  });

  registry.define(/^it instructs that the resulting ticket lists every source intake$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'the resulting ticket lists every source intake', 'the specifier prompt');
  });

  registry.define(/^it instructs that each source intake archives with a pointer to that ticket$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'each source intake archives with a pointer to that ticket', 'the specifier prompt');
  });

  // ── Scenario 02: 1-to-N split grant + traceability contract ─────────────
  registry.define(/^it instructs that one intake may become several tickets$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'One intake may become several tickets', 'the specifier prompt');
  });

  registry.define(/^it instructs that the intake archives once pointing at every resulting ticket$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'The intake archives once, pointing at every resulting ticket', 'the specifier prompt');
  });

  registry.define(/^it instructs stating which part of the intake went to which ticket$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'states which part of the intake went to which ticket', 'the specifier prompt');
  });

  // ── Scenario 03: the human-sentence hard constraint ──────────────────────
  registry.define(/^it instructs that every operator directive quoted in a source intake survives verbatim$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'every operator directive quoted in a source intake survives verbatim', 'the specifier prompt');
  });

  registry.define(/^it names that rule as the one hard constraint on consolidating$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'The one hard constraint on consolidating', 'the specifier prompt');
  });

  // ── Scenario 04: epic-top-priority consolidation pass ────────────────────
  registry.define(/^it instructs sweeping the open intakes and paused tickets in a top-priority epic's orbit$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'Epic-top-priority consolidation pass', 'the specifier prompt');
    requireIncludes(ctx.bl680Text, "sweep every open intake and every paused ticket in that epic's orbit", 'the specifier prompt');
  });

  registry.define(/^it instructs merging overlaps, splitting oversized slices and retiring superseded ones$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'merge overlaps, split oversized slices, and retire superseded ones', 'the specifier prompt');
  });

  registry.define(/^it instructs correcting depends_on entries the cluster contradicts$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'Correct any depends_on entries the cluster contradicts', 'the specifier prompt');
  });

  registry.define(/^it instructs recording the consolidation on the epic so the history stays walkable$/, (ctx) => {
    requireIncludes(ctx.bl680Text, 'Record the consolidation on the epic so the history stays walkable', 'the specifier prompt');
  });

  // ── Scenario 05: bounds on what consolidation may touch/produce ─────────
  registry.define(/^it instructs that (a merged result still fits the slice size envelope|a ticket in the active backlog is never consolidated)$/, (ctx, bound) => {
    const expected = BOUND_SUBSTRINGS[bound];
    if (!expected) {
      throw new Error(`unknown bound "${bound}" — no expected prompt substring registered`);
    }
    requireIncludes(ctx.bl680Text, expected, 'the specifier prompt');
  });

  // ── Scenario 06: a merge preserves both quoted directives ────────────────
  registry.define(/^two source intakes each quoting a distinct operator directive$/, (ctx) => {
    ctx.bl680Sources = [
      { intakeId: 'INTAKE-alpha', directives: ['ship the walker for the profiler'] },
      { intakeId: 'INTAKE-beta', directives: ['ship the walker for the burn meter'] },
    ];
  });

  registry.define(/^they are merged into one ticket$/, (ctx) => {
    ctx.bl680Merged = mergeIntakes(ctx.bl680Sources);
  });

  registry.define(/^both quoted directives appear verbatim in the resulting ticket$/, (ctx) => {
    for (const source of ctx.bl680Sources) {
      for (const directive of source.directives) {
        if (!ctx.bl680Merged.directives.includes(directive)) {
          throw new Error(`expected the merged ticket to carry the verbatim directive "${directive}"`);
        }
      }
    }
  });

  // ── Scenario 07: a split maps every mechanism onto exactly one ticket ───
  registry.define(/^one intake proposing three separable mechanisms$/, (ctx) => {
    ctx.bl680SourceIntakeId = 'INTAKE-gamma';
    ctx.bl680Parts = [
      { ticketId: 'BL-901', mechanism: 'turn profiler' },
      { ticketId: 'BL-902', mechanism: 'context-telemetry producer' },
      { ticketId: 'BL-903', mechanism: "budget governor's burn meter" },
    ];
  });

  registry.define(/^it is split into three tickets$/, (ctx) => {
    ctx.bl680Split = splitIntake(ctx.bl680SourceIntakeId, ctx.bl680Parts);
  });

  registry.define(/^each mechanism is named in exactly one resulting ticket$/, (ctx) => {
    const mechanisms = ctx.bl680Split.parts.map((p) => p.mechanism);
    for (const part of ctx.bl680Parts) {
      const occurrences = mechanisms.filter((m) => m === part.mechanism).length;
      if (occurrences !== 1) {
        throw new Error(`expected mechanism "${part.mechanism}" to be named in exactly one resulting ticket, found ${occurrences}`);
      }
    }
  });

  registry.define(/^the archived intake points at all three$/, (ctx) => {
    if (ctx.bl680Split.sourceIntakeId !== ctx.bl680SourceIntakeId) {
      throw new Error('expected the split result to record which intake it came from');
    }
    const resultTicketIds = ctx.bl680Split.parts.map((p) => p.ticketId);
    const expectedTicketIds = ctx.bl680Parts.map((p) => p.ticketId);
    for (const ticketId of expectedTicketIds) {
      if (!resultTicketIds.includes(ticketId)) {
        throw new Error(`expected the archived intake to point at resulting ticket "${ticketId}"`);
      }
    }
  });
}

module.exports = { registerSteps };
