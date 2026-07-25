'use strict';

// BL-633: step handlers for "ticket invariants section distinct from
// acceptance". Scenarios 01-03 and 05 are prose-content checks against the
// real, already-updated docs (schema doc, specifier/architect prompts, the
// BL-590 retro-fixture ticket) - same "read the live file, assert on its
// literal content" pattern qaIntegratesCoordinatorBookkeepsSteps.js (BL-247)
// established for governance/prose tickets. Scenario 04 is the one
// deterministic-script scenario: it drives the real
// backlog_epic_milestone_audit.bb / backlog_hygiene_lib.bb against a fixture
// backlog directory to prove the new `invariants:` field doesn't perturb an
// existing reader.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { after } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCHEMA_DOC_PATH = path.join(REPO_ROOT, 'swarmforge', 'backlog-schema.md');
const SPECIFIER_PROMPT_PATH = path.join(REPO_ROOT, 'swarmforge', 'roles', 'specifier.prompt');
const ARCHITECT_PROMPT_PATH = path.join(REPO_ROOT, 'swarmforge', 'roles', 'architect.prompt');
const AUDIT_SCRIPT_PATH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'backlog_epic_milestone_audit.bb');
const HYGIENE_LIB_PATH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'backlog_hygiene_lib.bb');
const BL590_TICKET_PATH = path.join(REPO_ROOT, 'backlog', 'hold', 'BL-590-onboarding-facilitator-agent.yaml');

// BL-633 hardening: scenario 04's fixture root was previously removed only in
// the scenario's last step, so a throw in an earlier step (e.g. "the audit
// exits zero" failing) left the mkdtemp directory behind. Track every root
// created by this file and sweep them all once, after every test in the
// generated entry point has run, regardless of which step failed.
const pendingFixtureRoots = new Set();
after(() => {
  for (const root of pendingFixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  pendingFixtureRoots.clear();
});

// Collapses markdown line-wrapping into single spaces so a substring check
// doesn't depend on exactly where a paragraph happens to wrap (same
// convention as qaIntegratesCoordinatorBookkeepsSteps.js).
function readNormalizedDoc(docPath) {
  return fs.readFileSync(docPath, 'utf8').replace(/\s+/g, ' ');
}

function requireIncludes(text, fragment, label) {
  if (!text.includes(fragment)) {
    throw new Error(`expected ${label} to contain "${fragment}"`);
  }
}

function bbField(text, name) {
  // JSON.stringify escaping is a safe superset of what a Clojure string
  // literal needs for a plain filesystem path (quotes/backslashes), so this
  // never breaks even if REPO_ROOT ever contains one.
  const code = `(load-file ${JSON.stringify(HYGIENE_LIB_PATH)}) (println (pr-str (backlog-hygiene-lib/field ${JSON.stringify(text)} ${JSON.stringify(name)})))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`bb eval failed reading field "${name}": ${result.stderr}`);
  }
  return result.stdout.trim();
}

function registerSteps(registry) {
  // ── Scenario 01: the backlog schema document ────────────────────────────
  registry.define(/^the backlog schema document$/, (ctx) => {
    ctx.bl633Text = readNormalizedDoc(SCHEMA_DOC_PATH);
  });

  registry.define(/^it documents an optional invariants field distinct from acceptance$/, (ctx) => {
    const text = ctx.bl633Text;
    const sectionIdx = text.indexOf('## Optional Fields');
    const fieldIdx = text.indexOf('`invariants`');
    if (sectionIdx === -1 || fieldIdx === -1 || fieldIdx < sectionIdx) {
      throw new Error('expected an `invariants` row under "## Optional Fields" in the backlog schema document');
    }
    requireIncludes(text, 'Distinct from `acceptance:`', 'the backlog schema document');
  });

  registry.define(/^it states that scenarios are examples and an invariant is a property across the whole slice$/, (ctx) => {
    requireIncludes(ctx.bl633Text, 'Gherkin scenarios are EXAMPLES', 'the backlog schema document');
    requireIncludes(ctx.bl633Text, 'PROPERTY quantified over the whole surface', 'the backlog schema document');
  });

  registry.define(/^it states a cap of three entries with the rationale that needing more means the slice is too big$/, (ctx) => {
    requireIncludes(ctx.bl633Text, 'Cap: at most 3 entries', 'the backlog schema document');
    requireIncludes(ctx.bl633Text, 'needing more is a signal the slice is too big', 'the backlog schema document');
  });

  // Shared step text (scenarios 01 and 02) - checks whichever doc the
  // scenario's own Given step loaded into ctx.bl633Text.
  registry.define(/^it states that an absent or empty invariants list is a legitimate outcome$/, (ctx) => {
    requireIncludes(ctx.bl633Text, 'is a legitimate outcome, not a failure', 'the loaded document');
  });

  // ── Scenario 02: the specifier role prompt ──────────────────────────────
  registry.define(/^the specifier role prompt$/, (ctx) => {
    ctx.bl633Text = readNormalizedDoc(SPECIFIER_PROMPT_PATH);
  });

  registry.define(/^it instructs asking what must hold across all scenarios before writing them$/, (ctx) => {
    requireIncludes(ctx.bl633Text, "BEFORE writing a ticket's scenarios, ask: what must hold across ALL of them", 'the specifier prompt');
  });

  registry.define(/^it instructs recording each such property in the ticket invariants list$/, (ctx) => {
    requireIncludes(ctx.bl633Text, 'State each such property as one line', 'the specifier prompt');
    requireIncludes(ctx.bl633Text, "the ticket YAML's `invariants:` list", 'the specifier prompt');
  });

  // ── Scenario 03: the architect role prompt ──────────────────────────────
  registry.define(/^the architect role prompt$/, (ctx) => {
    ctx.bl633Text = readNormalizedDoc(ARCHITECT_PROMPT_PATH);
  });

  registry.define(/^it instructs reviewing the parcel against each declared invariant as a distinct pass$/, (ctx) => {
    requireIncludes(ctx.bl633Text, 'review the parcel against EACH declared invariant as a DISTINCT pass', 'the architect prompt');
  });

  registry.define(/^it instructs sweeping every site violating the same invariant before sending back$/, (ctx) => {
    requireIncludes(ctx.bl633Text, 'do NOT send back yet: first sweep the parcel for EVERY other site violating the SAME invariant', 'the architect prompt');
  });

  registry.define(/^it instructs one bounce per violated property rather than one per site$/, (ctx) => {
    requireIncludes(ctx.bl633Text, 'One bounce per property, never one per site.', 'the architect prompt');
  });

  // ── Scenario 04: an existing ticket reader tolerates the new field ──────
  registry.define(/^a hygienic backlog fixture with two tickets identical except one declares an invariants list$/, (ctx) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl633-hygiene-'));
    pendingFixtureRoots.add(root);
    const activeDir = path.join(root, 'backlog', 'active');
    fs.mkdirSync(activeDir, { recursive: true });
    const shared = 'title: "hygienic fixture ticket"\ntype: feature\nepic: test-epic\nmilestone: M8\npriority: 5\nmutation_cost: low\n';
    const ticketAText = `id: BL-96001\n${shared}`;
    const ticketBText = `id: BL-96002\n${shared}invariants:\n  - "a fixture property, for step-handler coverage only"\n`;
    fs.writeFileSync(path.join(activeDir, 'BL-96001-fixture.yaml'), ticketAText, 'utf8');
    fs.writeFileSync(path.join(activeDir, 'BL-96002-fixture.yaml'), ticketBText, 'utf8');
    ctx.bl633Fixture = { root, ticketAText, ticketBText };
  });

  registry.define(/^the epic and milestone audit parses the fixture$/, (ctx) => {
    ctx.bl633AuditResult = spawnSync('bb', [AUDIT_SCRIPT_PATH, ctx.bl633Fixture.root], { encoding: 'utf8' });
  });

  registry.define(/^the audit exits zero$/, (ctx) => {
    const r = ctx.bl633AuditResult;
    if (r.status !== 0) {
      throw new Error(`expected backlog_epic_milestone_audit.bb to exit 0 on the fixture, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    }
  });

  registry.define(/^the fields the audit already reads parse identically for both tickets$/, (ctx) => {
    // Cleanup for ctx.bl633Fixture.root lives in the module-level `after`
    // hook above, not here - this step must stay pass/fail on the field
    // comparison alone so an earlier-step failure still gets swept.
    for (const name of ['type', 'epic', 'milestone']) {
      const a = bbField(ctx.bl633Fixture.ticketAText, name);
      const b = bbField(ctx.bl633Fixture.ticketBText, name);
      if (a !== b) {
        throw new Error(`field "${name}" parsed differently between the two fixture tickets: ${a} vs ${b}`);
      }
    }
  });

  // ── Scenario 05: BL-590 carries its invariant as the worked example ─────
  registry.define(/^the BL-590 ticket in the backlog hold folder$/, (ctx) => {
    ctx.bl633Bl590Text = fs.readFileSync(BL590_TICKET_PATH, 'utf8');
  });

  registry.define(/^its invariants list includes the durable-write redelivery idempotency property$/, (ctx) => {
    requireIncludes(ctx.bl633Bl590Text, 'invariants:', 'the BL-590 ticket');
    requireIncludes(ctx.bl633Bl590Text, 'idempotent under redelivery', 'the BL-590 ticket invariants list');
  });

  registry.define(/^the backlog schema document cites the BL-590 invariant as its worked example$/, () => {
    const schemaText = readNormalizedDoc(SCHEMA_DOC_PATH);
    requireIncludes(schemaText, 'Worked example: BL-590', 'the backlog schema document');
    requireIncludes(schemaText, 'idempotent under redelivery', 'the backlog schema document worked example');
  });
}

module.exports = { registerSteps };
