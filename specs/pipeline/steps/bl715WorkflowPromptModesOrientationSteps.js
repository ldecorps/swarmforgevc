'use strict';

// BL-715: step handlers for "Workflow articles orient agents on queue-jump,
// ambulance, and expeditor". Reads the REAL workflow.prompt and
// workflow-detailed.prompt straight off disk (a plain content/grep check,
// no compiled module involved - this is a governance/orientation-prose-only
// ticket, invariant #3 in the ticket YAML).
//
// modes-05 ("orientation is prose only") is verified by discovering every
// commit on this branch whose subject starts with "BL-715:" (the repo's own
// commit-message convention) and asserting every file each such commit
// touches falls inside an allowlist of governance articles plus the
// acceptance-test infrastructure BL-112 requires alongside them (feature
// file, step handlers, the steps registry). This stays correct for every
// downstream stage that re-runs this suite (cleaner, architect, hardener,
// documenter, QA), not just the coder's own authoring pass - it does not
// hardcode a commit sha the way a diff-range check would have to.
//
// BL-654 stated reason (all three of BL-715's declared invariants): none
// admits a fast-check property-test encoding. A property test quantifies a
// claim over a GENERATED state space; every one of these invariants
// quantifies over a single fixed artifact instead - one governance
// article's committed text, or one ticket's committed file list - with no
// varying input to generate over. That is exactly BL-654's
// non-encodability hatch ("some invariants quantify over prose/process,
// not a pure module"). The deterministic Gherkin scenarios this file drives
// (BL-715 modes-01..05, specifier-authored, this file wired by the coder)
// are the substitute: each is non-vacuous (fails against a broken/missing
// orientation - the collision and scope bugs caught during authoring above
// are the demonstration - and passes against the correct one) and re-runs
// at every downstream gate via the acceptance suite, same as any other
// stage's re-verification.

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOW_PROMPT_PATH = path.join(REPO_ROOT, 'swarmforge', 'constitution', 'articles', 'workflow.prompt');
const WORKFLOW_DETAILED_PATH = path.join(
  REPO_ROOT, 'swarmforge', 'constitution', 'articles', 'reference', 'workflow-detailed.prompt'
);

const GOVERNANCE_PREFIX = 'swarmforge/constitution/articles/';
const TEST_INFRA_PREFIXES = ['specs/features/', 'specs/pipeline/steps/'];
const BEHAVIOR_PREFIXES = ['swarmforge/scripts/', 'extension/src/'];

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function bl715CommitShas() {
  const log = git(['log', 'HEAD', '--oneline', '-E', '--grep=^BL-715:']);
  return log.trim().split('\n').filter(Boolean).map((line) => line.split(' ')[0]);
}

function changedFilesForCommit(sha) {
  const out = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
  return out.trim().split('\n').filter(Boolean);
}

function bl715ChangedFiles() {
  const shas = bl715CommitShas();
  const files = new Set();
  for (const sha of shas) {
    for (const file of changedFilesForCommit(sha)) {
      files.add(file);
    }
  }
  return [...files];
}

function isAllowedInfraOrArticle(file) {
  if (file.startsWith(GOVERNANCE_PREFIX)) return true;
  return TEST_INFRA_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isBehaviorFile(file) {
  return BEHAVIOR_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function readWorkflowPrompt(ctx) {
  if (ctx.workflowPrompt === undefined) {
    ctx.workflowPrompt = fs.readFileSync(WORKFLOW_PROMPT_PATH, 'utf8');
  }
  return ctx.workflowPrompt;
}

function readWorkflowDetailed(ctx) {
  if (ctx.workflowDetailed === undefined) {
    ctx.workflowDetailed = fs.readFileSync(WORKFLOW_DETAILED_PATH, 'utf8');
  }
  return ctx.workflowDetailed;
}

const WORKFLOW_PROMPT_SECTION_HEADING = '## How Work Moves — Normal Live Swarm, Queue-Jump, Ambulance, Expeditor';
const WORKFLOW_DETAILED_SECTION_HEADING = '## How Work Moves — The Escalation Ladder';

// Scoped to the section THIS ticket adds - not the whole article - so a
// pre-existing, unrelated "expedite" mention elsewhere in either file (e.g.
// Concurrent Work Orthogonality's Article 3.2.4 cross-reference) can't
// false-flag modes-03/04. Those legacy sentences are disambiguated by the
// ladder's lookup table, not by being rewritten in place (out of scope: the
// ticket only requires new orientation prose to prefer the new names).
function extractSection(text, headingStartsWith) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((line) => line.startsWith(headingStartsWith));
  if (startIdx === -1) {
    throw new Error(`BL-715: expected to find a section heading starting with "${headingStartsWith}"`);
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

function newOrientationText(ctx) {
  if (ctx.bl715OrientationText === undefined) {
    const promptSection = extractSection(readWorkflowPrompt(ctx), WORKFLOW_PROMPT_SECTION_HEADING);
    const detailedSection = extractSection(readWorkflowDetailed(ctx), WORKFLOW_DETAILED_SECTION_HEADING);
    // Hard-wrapped markdown breaks a sentence across source lines - collapse
    // all whitespace runs (including newlines) to a single space so a
    // multi-line phrase like "ambulance\n  is not the expeditor." reads as
    // one contiguous phrase, same as a reader sees it rendered.
    ctx.bl715OrientationText = `${promptSection}\n${detailedSection}`.replace(/\s+/g, ' ');
  }
  return ctx.bl715OrientationText;
}

const MODE_EFFECT = {
  'queue-jump': 'promotes sooner then walks the normal live pipeline',
  ambulance: 'holds other parcels on a live stack for one ticket',
  expeditor: 'drives one ticket with the swarm stopped',
};
const MODE_EFFECT_ALTERNATION = Object.values(MODE_EFFECT)
  .map((effect) => effect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.define(/^the swarm workflow rules article$/, (ctx) => {
    readWorkflowPrompt(ctx);
  });

  registry.define(/^the workflow detailed reference article$/, (ctx) => {
    readWorkflowDetailed(ctx);
  });

  // ── When steps - nothing further to fixture, Background already loaded
  //    the real articles; the Then steps below inspect ctx directly. ───────
  registry.define(/^I read the workflow rules orientation$/, () => {});
  registry.define(/^I read the workflow orientation$/, () => {});

  // ── modes-01 ───────────────────────────────────────────────────────────
  registry.define(/^it states that the normal live swarm is the default path$/, (ctx) => {
    if (!/normal live swarm is the default path/i.test(readWorkflowPrompt(ctx))) {
      throw new Error('BL-715: expected workflow.prompt to state the normal live swarm is the default path');
    }
  });

  registry.define(/^it states that other modes do not replace that path$/, (ctx) => {
    if (!/none of them replaces that path/i.test(readWorkflowPrompt(ctx))) {
      throw new Error('BL-715: expected workflow.prompt to state that the specials do not replace the default path');
    }
  });

  // ── modes-02 (Scenario Outline substitutes <mode>/<effect> literally) ───
  registry.define(/^it names (queue-jump|ambulance|expeditor)$/, (ctx, mode) => {
    const escaped = mode.replace(/-/g, '\\-');
    const namedAsHeading = new RegExp(`\\*\\*${escaped}\\*\\*`, 'i');
    if (!namedAsHeading.test(readWorkflowPrompt(ctx))) {
      throw new Error(`BL-715: expected workflow.prompt to name "${mode}" as a bolded term`);
    }
  });

  registry.define(
    new RegExp(`^it states that (queue-jump|ambulance|expeditor) (${MODE_EFFECT_ALTERNATION})$`),
    (ctx, mode, effect) => {
      const expected = MODE_EFFECT[mode];
      if (effect !== expected) {
        throw new Error(`BL-715: unexpected effect text "${effect}" for mode "${mode}", expected "${expected}"`);
      }
      if (!readWorkflowPrompt(ctx).toLowerCase().includes(expected.toLowerCase())) {
        throw new Error(`BL-715: expected workflow.prompt to state "${expected}" for ${mode}`);
      }
    }
  );

  // ── modes-03 ───────────────────────────────────────────────────────────
  registry.define(/^it states that queue-jump is not ambulance$/, (ctx) => {
    if (!/queue-jump is not ambulance/i.test(newOrientationText(ctx))) {
      throw new Error('BL-715: expected the orientation to state "queue-jump is not ambulance"');
    }
  });

  registry.define(/^it states that queue-jump is not the expeditor$/, (ctx) => {
    if (!/queue-jump is not the expeditor/i.test(newOrientationText(ctx))) {
      throw new Error('BL-715: expected the orientation to state "queue-jump is not the expeditor"');
    }
  });

  registry.define(/^it states that ambulance is not the expeditor$/, (ctx) => {
    if (!/ambulance is not the expeditor/i.test(newOrientationText(ctx))) {
      throw new Error('BL-715: expected the orientation to state "ambulance is not the expeditor"');
    }
  });

  // ── modes-04 ───────────────────────────────────────────────────────────
  registry.define(
    /^if it mentions expedite it ties that word to queue-jump or the expeditor explicitly$/,
    (ctx) => {
      // Scoped to the NEW orientation section only (see newOrientationText,
      // already whitespace-normalized) - a pre-existing "expedited defects"
      // sentence elsewhere in either article is legacy content this ticket
      // disambiguates via the ladder's lookup table, not by rewriting in
      // place.
      const sentences = newOrientationText(ctx).split(/(?<=\.)\s+/);
      const offenders = sentences.filter(
        (sentence) => /expedite[ds]?/i.test(sentence) && !/queue-jump|expeditor/i.test(sentence)
      );
      if (offenders.length > 0) {
        throw new Error(
          `BL-715: found "expedite" mentioned without tying it to queue-jump or the expeditor: ${JSON.stringify(offenders)}`
        );
      }
    }
  );

  registry.define(/^it does not use expedite alone as the primary name for queue-jump$/, (ctx) => {
    const text = newOrientationText(ctx);
    if (/^#+\s*expedite\b/im.test(text)) {
      throw new Error('BL-715: found a heading naming "expedite" alone instead of "queue-jump"');
    }
    if (/\*\*expedite\*\*(?!\s*\()/i.test(text)) {
      throw new Error('BL-715: found "expedite" emphasized as if it were the primary name for a mode');
    }
  });

  // ── modes-05 ───────────────────────────────────────────────────────────
  registry.define(/^I inspect the change that adds the orientation$/, (ctx) => {
    ctx.bl715ChangedFiles = bl715ChangedFiles();
    if (ctx.bl715ChangedFiles.length === 0) {
      throw new Error(
        'BL-715: found no commit on this branch with a subject starting "BL-715:" - commit the orientation change first'
      );
    }
  });

  registry.define(/^it changes workflow governance articles only$/, (ctx) => {
    const files = ctx.bl715ChangedFiles || bl715ChangedFiles();
    const unexpected = files.filter((file) => !isAllowedInfraOrArticle(file));
    if (unexpected.length > 0) {
      throw new Error(
        `BL-715: expected only governance-article/acceptance-test-infra files, found: ${unexpected.join(', ')}`
      );
    }
  });

  registry.define(/^it does not change daemon, promotion, or ambulance-marker behavior$/, (ctx) => {
    const files = ctx.bl715ChangedFiles || bl715ChangedFiles();
    const behaviorHits = files.filter(isBehaviorFile);
    if (behaviorHits.length > 0) {
      throw new Error(`BL-715: found daemon/promotion/ambulance-marker-adjacent file changes: ${behaviorHits.join(', ')}`);
    }
  });
}

module.exports = { registerSteps };
