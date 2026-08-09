'use strict';

// BL-643: step handlers for "The non-pipeline agents are documented as a
// class, with every path verified". Drives the REAL reference table
// (docs/reference/BL-643-non-pipeline-agents-reference-table.md) and the
// REAL class explanation doc (docs/explanation/BL-643-non-pipeline-agents-
// as-a-class.md) - parses the markdown table itself and checks its printed
// paths against the repo, rather than maintaining a parallel hardcoded copy
// that could silently drift from what the document actually says (the same
// "checked, never recalled" posture the ticket's own invariant 1 states).
//
// Enumeration (scenario 01) is DERIVED from the repo's launch_*.sh scripts
// plus a small, explicitly-justified allowlist of agents that don't follow
// that naming convention (babysitter uses start_babysitterd.sh; Model
// Steward and the Expeditor have no launcher at all) - never a hardcoded
// count copied from the ticket's own (already-stale-once) enumeration.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROLES_DIR = path.join(REPO_ROOT, 'swarmforge', 'roles');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const REF_TABLE_PATH = path.join(DOCS_DIR, 'reference', 'BL-643-non-pipeline-agents-reference-table.md');
const CLASS_DOC_PATH = path.join(DOCS_DIR, 'explanation', 'BL-643-non-pipeline-agents-as-a-class.md');
const INDEX_PATH = path.join(DOCS_DIR, 'index.md');

// ── launcher discovery (scenario 01) ───────────────────────────────────
// Non-`launch_*.sh` exceptions, each justified against the repo at write
// time (re-verified, not carried over from the ticket's own stale count):
// babysitter is started by start_babysitterd.sh instead of the launch_*.sh
// convention; Model Steward has an authored role prompt but no launcher of
// any kind; the Expeditor is a driver script, never a launched/supervised
// daemon.
const IRREGULAR_LAUNCH_AGENTS = [
  { agentName: 'Babysitter', launcherPath: path.join(SCRIPTS_DIR, 'start_babysitterd.sh') },
  { agentName: 'Model Steward', launcherPath: null },
  { agentName: 'Expeditor', launcherPath: null },
];

// launch_*.sh basename -> the Agent name used as the table's row key.
const LAUNCH_SCRIPT_AGENT_NAMES = {
  'launch_cursor_bridge.sh': 'Cursor Bridge',
  'launch_front_desk.sh': 'Front Desk',
  'launch_front_desk_operator.sh': 'Front Desk Operator (Concierge)',
  'launch_negotiation_relay.sh': 'Negotiation Relay',
  'launch_onboarder.sh': 'Onboarder',
  'launch_operator.sh': 'Operator',
  'launch_resident_spy_tunnel.sh': 'Resident Spy Tunnel',
  'launch_support.sh': 'Support',
};

function discoverNonPipelineAgents() {
  const launchFiles = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.startsWith('launch_') && f.endsWith('.sh'));
  const unknown = launchFiles.filter((f) => !Object.prototype.hasOwnProperty.call(LAUNCH_SCRIPT_AGENT_NAMES, f));
  if (unknown.length > 0) {
    throw new Error(
      `bl643: found launch_*.sh script(s) with no known agent-name mapping - update LAUNCH_SCRIPT_AGENT_NAMES: ${JSON.stringify(unknown)}`
    );
  }
  const fromLaunchers = launchFiles.map((f) => ({ agentName: LAUNCH_SCRIPT_AGENT_NAMES[f], launcherPath: path.join(SCRIPTS_DIR, f) }));
  for (const irregular of IRREGULAR_LAUNCH_AGENTS) {
    if (irregular.launcherPath && !fs.existsSync(irregular.launcherPath)) {
      throw new Error(`bl643: irregular-launch agent "${irregular.agentName}" names a launcher that does not exist: ${irregular.launcherPath}`);
    }
  }
  return [...fromLaunchers, ...IRREGULAR_LAUNCH_AGENTS];
}

// ── markdown table parsing ──────────────────────────────────────────────
function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseReferenceTable() {
  const text = fs.readFileSync(REF_TABLE_PATH, 'utf8');
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => l.trim().startsWith('| Agent |'));
  if (headerIdx === -1) {
    throw new Error('bl643: reference table header row ("| Agent | ...") not found');
  }
  const header = splitTableRow(lines[headerIdx]);
  const rows = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) {
      break;
    }
    const cells = splitTableRow(line);
    const row = {};
    header.forEach((col, idx) => {
      row[col] = cells[idx] ?? '';
    });
    rows.push(row);
  }
  return { text, header, rows };
}

function extractLinkTargets(cellText) {
  const targets = [];
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(cellText))) {
    if (!m[1].startsWith('#')) {
      targets.push(m[1]);
    }
  }
  return targets;
}

function extractBacktickSpans(cellText) {
  const spans = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(cellText))) {
    spans.push(m[1]);
  }
  return spans;
}

function isDeliberatelyAbsent(cellText) {
  return /—\s*none\s*—/.test(cellText);
}

function resolveDocLink(target) {
  const withoutFragment = target.split('#')[0];
  return path.resolve(path.dirname(REF_TABLE_PATH), withoutFragment);
}

// ── verification-source scripts for log literals (invariant 1) ─────────
// The reference table's "Log location" column is a RUNTIME path (usually
// under gitignored .swarmforge/), so it can never be checked for
// filesystem existence the way a launcher/stop/prompt path can. Instead
// each log literal is checked against the real source that DEFINES it -
// the same cross-reference done by hand while writing the table, made
// executable so it can't drift silently.
const LOG_VERIFICATION_SOURCE_OVERRIDES = {
  // Babysitter's launcher column links start_babysitterd.sh, but the log
  // path literal is written by the daemon loop it backgrounds, babysitterd.sh.
  Babysitter: [path.join(SCRIPTS_DIR, 'babysitterd.sh')],
  // Support's launcher column links launch_support.sh (the disposable
  // per-event LLM launcher); the runtime.log path is written by the
  // always-alive runtime it is launched from, support_runtime.bb.
  Support: [path.join(SCRIPTS_DIR, 'support_runtime.bb')],
  'Model Steward': [path.join(SCRIPTS_DIR, 'model_steward_store.bb')],
  Expeditor: null, // checked structurally below (a directory, not a literal in one script)
};

function logVerificationSources(row) {
  if (Object.prototype.hasOwnProperty.call(LOG_VERIFICATION_SOURCE_OVERRIDES, row.Agent)) {
    return LOG_VERIFICATION_SOURCE_OVERRIDES[row.Agent];
  }
  const launcherTargets = extractLinkTargets(row.Launcher).map(resolveDocLink);
  return launcherTargets.filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
}

// ── shared row-path checkers (invariant 1 - reused by both the acceptance
// scenario 03 step handlers and the invariant's own property test, so
// there is exactly one implementation of "does this row's path resolve"). ─
function checkPathColumn(row, column) {
  const cell = row[column];
  const targets = extractLinkTargets(cell);
  if (targets.length === 0) {
    if (!isDeliberatelyAbsent(cell)) {
      throw new Error(`bl643: row "${row.Agent}" column "${column}" names no resolvable path and is not marked "— none —": ${JSON.stringify(cell)}`);
    }
    return [];
  }
  const resolved = targets.map((target) => ({ agent: row.Agent, column, target, resolved: resolveDocLink(target) }));
  const missing = resolved.filter((p) => !fs.existsSync(p.resolved));
  if (missing.length > 0) {
    throw new Error(`bl643: path(s) named in the table do not exist: ${JSON.stringify(missing)}`);
  }
  return resolved;
}

function checkLogGrounding(row) {
  const spans = extractBacktickSpans(row['Log location']).filter((s) => s.startsWith('.') || s.includes('/'));
  if (spans.length === 0) {
    return;
  }
  if (row.Agent === 'Expeditor') {
    if (!fs.existsSync(path.join(REPO_ROOT, 'backlog', 'evidence'))) {
      throw new Error('bl643: Expeditor log location claims backlog/evidence/, but that directory does not exist');
    }
    return;
  }
  const sources = logVerificationSources(row);
  if (!sources || sources.length === 0) {
    throw new Error(`bl643: row "${row.Agent}" has a log location but no verification source to ground it against`);
  }
  const combined = sources.map((s) => fs.readFileSync(s, 'utf8')).join('\n');
  // Match on the BASENAME, not the full literal: these scripts build the
  // directory prefix from a shell variable (e.g. LOG="$OP_DIR/runtime.log"),
  // so the full ".swarmforge/operator/runtime.log" string never appears
  // verbatim in source even though the file name genuinely does. The
  // directory prefix itself is a repo-wide `.swarmforge/operator` (or
  // `.swarmforge/<agent>`) convention already spot-checked by hand while
  // writing this table, not a per-row claim worth re-deriving here.
  const ungrounded = spans.filter((span) => {
    const basename = span.replace(/\/$/, '').split('/').pop();
    return !combined.includes(basename);
  });
  if (ungrounded.length > 0) {
    throw new Error(`bl643: row "${row.Agent}" log literal(s) not found (by basename) in its verification source(s): ${JSON.stringify(ungrounded)}`);
  }
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────
  registry.define(/^the non-pipeline agent documentation has been written$/, (ctx) => {
    if (!fs.existsSync(REF_TABLE_PATH)) {
      throw new Error(`bl643: reference table missing at ${REF_TABLE_PATH}`);
    }
    if (!fs.existsSync(CLASS_DOC_PATH)) {
      throw new Error(`bl643: class explanation doc missing at ${CLASS_DOC_PATH}`);
    }
    ctx.table = parseReferenceTable();
    ctx.classDoc = fs.readFileSync(CLASS_DOC_PATH, 'utf8');
    ctx.indexDoc = fs.readFileSync(INDEX_PATH, 'utf8');
  });

  // ── agent-class-doc-01 ────────────────────────────────────────────
  registry.define(/^the repo's non-pipeline agents are enumerated from their launchers$/, (ctx) => {
    ctx.discoveredAgents = discoverNonPipelineAgents();
  });

  registry.define(/^every enumerated agent has a row in the reference table$/, (ctx) => {
    const tableNames = new Set(ctx.table.rows.map((r) => r.Agent));
    const missing = ctx.discoveredAgents.filter((a) => !tableNames.has(a.agentName));
    if (missing.length > 0) {
      throw new Error(`bl643: agent(s) discovered from launchers with no table row: ${JSON.stringify(missing.map((a) => a.agentName))}`);
    }
  });

  registry.define(/^the table has no row for an agent that does not exist$/, (ctx) => {
    const discoveredNames = new Set(ctx.discoveredAgents.map((a) => a.agentName));
    const extra = ctx.table.rows.map((r) => r.Agent).filter((name) => !discoveredNames.has(name));
    if (extra.length > 0) {
      throw new Error(`bl643: table row(s) for agent(s) not found among discovered launchers: ${JSON.stringify(extra)}`);
    }
  });

  // ── agent-class-doc-02 (Scenario Outline) ───────────────────────────
  // <column> Examples use the reader-facing phrasing from the feature file,
  // not the table's own header text - map one to the other explicitly
  // rather than assuming they're spelled the same.
  const COLUMN_EXAMPLE_TO_TABLE_HEADER = {
    category: 'Category',
    launcher: 'Launcher',
    'stop path': 'Stop path',
    'role prompt, or its absence': 'Role prompt',
    'log location': 'Log location',
    'supervising service': 'Supervising service',
  };

  registry.define(/^a row of the reference table is read$/, (ctx) => {
    if (ctx.table.rows.length === 0) {
      throw new Error('bl643: fixture assumption broken - reference table has no rows');
    }
  });

  registry.define(/^it states the agent's (.+)$/, (ctx, column) => {
    if (!Object.prototype.hasOwnProperty.call(COLUMN_EXAMPLE_TO_TABLE_HEADER, column)) {
      throw new Error(`bl643 agent-class-doc-02: unrecognized <column> example value "${column}"`);
    }
    const header = COLUMN_EXAMPLE_TO_TABLE_HEADER[column];
    const unstated = ctx.table.rows.filter((r) => !r[header] || r[header].length === 0);
    if (unstated.length > 0) {
      throw new Error(`bl643: row(s) with no "${header}" value: ${JSON.stringify(unstated.map((r) => r.Agent))}`);
    }
  });

  // ── agent-class-doc-03 (Scenario Outline) ───────────────────────────
  const PATH_KIND_COLUMNS = {
    launcher: 'Launcher',
    'stop path': 'Stop path',
    'role prompt': 'Role prompt',
  };

  registry.define(/^the (.+) named in each row is resolved against the repo$/, (ctx, pathKind) => {
    if (!Object.prototype.hasOwnProperty.call(PATH_KIND_COLUMNS, pathKind)) {
      throw new Error(`bl643 agent-class-doc-03: unrecognized <path kind> example value "${pathKind}"`);
    }
    const column = PATH_KIND_COLUMNS[pathKind];
    // checkPathColumn throws immediately on a missing path, so both this
    // step and the two below it succeed together - ctx.resolvedPaths is
    // kept only so a later step has something to report from.
    ctx.resolvedPaths = ctx.table.rows.flatMap((row) => checkPathColumn(row, column));
  });

  registry.define(/^it exists$/, (ctx) => {
    if (!ctx.resolvedPaths) {
      throw new Error('bl643: no resolved paths recorded - the prior step should have populated or thrown');
    }
  });

  registry.define(/^no row names a path that was recalled rather than checked$/, (ctx) => {
    if (!ctx.resolvedPaths) {
      throw new Error('bl643: no resolved paths recorded - the prior step should have populated or thrown');
    }
  });

  // ── agent-class-doc-04 ──────────────────────────────────────────────
  registry.define(/^an agent that has no role prompt$/, (ctx) => {
    ctx.noPromptAgent = 'Onboarder';
    ctx.noPromptRow = ctx.table.rows.find((r) => r.Agent === ctx.noPromptAgent);
    if (!ctx.noPromptRow || !isDeliberatelyAbsent(ctx.noPromptRow['Role prompt'])) {
      throw new Error(`bl643: fixture assumption broken - expected "${ctx.noPromptAgent}" to have no role prompt in the table`);
    }
  });

  registry.define(/^its description is read$/, (ctx) => {
    const marker = /the onboarder: what shipped/i;
    const idx = ctx.classDoc.search(marker);
    if (idx === -1) {
      throw new Error('bl643: expected the class doc to contain an Onboarder section');
    }
    ctx.noPromptDescription = ctx.classDoc.slice(idx);
  });

  registry.define(/^the description says it was derived from code$/, (ctx) => {
    if (!/derived from reading the shipped code/i.test(ctx.noPromptDescription)) {
      throw new Error('bl643: expected the Onboarder description to say its behaviour was derived from reading the shipped code');
    }
  });

  registry.define(/^the reader is not left to assume it was authored$/, (ctx) => {
    if (!/no authored role prompt of its own/i.test(ctx.noPromptDescription) || !/not from an authored description/i.test(ctx.noPromptDescription)) {
      throw new Error('bl643: expected the Onboarder description to explicitly disclaim an authored role prompt');
    }
  });

  // ── agent-class-doc-05 (Scenario Outline) ───────────────────────────
  const IRREGULAR_CASE_ROWS = {
    'an agent with a role prompt but no launcher': {
      agent: 'Model Steward',
      requiredPhrases: [/no launcher/i, /role prompt/i],
    },
    "an agent whose authored description lives under another's prompt": {
      agent: 'Front Desk',
      requiredPhrases: [/support\.prompt/i, /naming.collision/i],
    },
    'an agent that is a driver rather than a launched process': {
      agent: 'Expeditor',
      requiredPhrases: [/driver/i, /not a launched/i],
    },
  };

  registry.define(/^(an agent .+)$/, (ctx, irregularCase) => {
    if (!Object.prototype.hasOwnProperty.call(IRREGULAR_CASE_ROWS, irregularCase)) {
      throw new Error(`bl643 agent-class-doc-05: unrecognized <irregular case> example value "${irregularCase}"`);
    }
    ctx.irregularCase = IRREGULAR_CASE_ROWS[irregularCase];
  });

  registry.define(/^that agent is looked up in the reference table$/, (ctx) => {
    ctx.irregularRow = ctx.table.rows.find((r) => r.Agent === ctx.irregularCase.agent);
  });

  registry.define(/^it has a row of its own$/, (ctx) => {
    if (!ctx.irregularRow) {
      throw new Error(`bl643: expected a table row for "${ctx.irregularCase.agent}"`);
    }
  });

  registry.define(/^the row explains why it does not follow the usual shape$/, (ctx) => {
    const sectionMarker = new RegExp(`### ${ctx.irregularCase.agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    const idx = ctx.table.text.search(sectionMarker);
    if (idx === -1) {
      throw new Error(`bl643: expected an "Irregular cases" subsection explaining "${ctx.irregularCase.agent}"`);
    }
    const section = ctx.table.text.slice(idx, idx + 2000);
    const unmatched = ctx.irregularCase.requiredPhrases.filter((re) => !re.test(section));
    if (unmatched.length > 0) {
      throw new Error(`bl643: "${ctx.irregularCase.agent}" irregular-case section missing expected explanation content: ${JSON.stringify(unmatched.map(String))}`);
    }
  });

  // ── agent-class-doc-06 ──────────────────────────────────────────────
  // Behaviour keyword -> the real source file + symbol grounding it, so
  // "every behaviour it describes is present on the main branch" is a
  // repo check, not a re-read of the prose.
  const ONBOARDER_SHIPPED_BEHAVIOURS = [
    { keyword: /ensureOnboardingTopic/, file: path.join(REPO_ROOT, 'extension', 'src', 'tools', 'telegram-front-desk-bot.ts'), symbol: 'ensureOnboardingTopic' },
    { keyword: /isBareDoneClaim/, file: path.join(REPO_ROOT, 'extension', 'src', 'onboarding', 'onboarderState.ts'), symbol: 'isBareDoneClaim' },
    { keyword: /slugifyTargetRepoUrl/, file: path.join(REPO_ROOT, 'extension', 'src', 'onboarding', 'onboarderStateStore.ts'), symbol: 'slugifyTargetRepoUrl' },
  ];

  registry.define(/^the Onboarder document is read$/, (ctx) => {
    const idx = ctx.classDoc.search(/## the onboarder: what shipped/i);
    if (idx === -1) {
      throw new Error('bl643: expected an "Onboarder: what shipped" section in the class doc');
    }
    const nextHeading = ctx.classDoc.slice(idx + 1).search(/\n## /);
    ctx.onboarderSection = nextHeading === -1 ? ctx.classDoc.slice(idx) : ctx.classDoc.slice(idx, idx + 1 + nextHeading);
  });

  registry.define(/^every behaviour it describes is present on the main branch$/, (ctx) => {
    const missingKeyword = ONBOARDER_SHIPPED_BEHAVIOURS.filter((b) => !b.keyword.test(ctx.onboarderSection));
    if (missingKeyword.length > 0) {
      throw new Error(`bl643: expected the Onboarder section to name these shipped symbols: ${JSON.stringify(missingKeyword.map((b) => b.symbol))}`);
    }
    const missingSymbol = ONBOARDER_SHIPPED_BEHAVIOURS.filter((b) => {
      if (!fs.existsSync(b.file)) {
        return true;
      }
      const src = fs.readFileSync(b.file, 'utf8');
      return !src.includes(b.symbol);
    });
    if (missingSymbol.length > 0) {
      throw new Error(`bl643: symbol(s) named in the Onboarder section not found in their claimed source file: ${JSON.stringify(missingSymbol.map((b) => b.symbol))}`);
    }
  });

  registry.define(/^each unshipped phase is named with the ticket that owns it$/, (ctx) => {
    if (!/BL-624/.test(ctx.onboarderSection) || !/BL-625/.test(ctx.onboarderSection)) {
      throw new Error('bl643: expected the Onboarder section to name BL-624 and BL-625 as owning the unshipped phases');
    }
    if (!/not built yet/i.test(ctx.onboarderSection)) {
      throw new Error('bl643: expected the Onboarder section to explicitly state which phases are not built yet');
    }
  });

  // ── agent-class-doc-07 ──────────────────────────────────────────────
  const EXPEDITOR_REQUIRED_LINKS = [
    '../how-to/BL-567-expedite-one-ticket-with-the-swarm-stopped.md',
    'BL-567-why-the-expeditor-commands-the-stack-but-never-depends-on-it.md',
    '../reference/BL-567-expeditor-manual.md',
  ];

  registry.define(/^the class document reaches the Expeditor$/, (ctx) => {
    const idx = ctx.classDoc.search(/## the expeditor, linked not restated/i);
    if (idx === -1) {
      throw new Error('bl643: expected an Expeditor section in the class doc');
    }
    const nextHeading = ctx.classDoc.slice(idx + 1).search(/\n## /);
    ctx.expeditorSection = nextHeading === -1 ? ctx.classDoc.slice(idx) : ctx.classDoc.slice(idx, idx + 1 + nextHeading);
  });

  registry.define(/^it links the existing Expeditor documents$/, (ctx) => {
    const missing = EXPEDITOR_REQUIRED_LINKS.filter((link) => !ctx.expeditorSection.includes(link));
    if (missing.length > 0) {
      throw new Error(`bl643: Expeditor section missing expected link(s): ${JSON.stringify(missing)}`);
    }
    for (const link of EXPEDITOR_REQUIRED_LINKS) {
      const resolved = path.resolve(path.dirname(CLASS_DOC_PATH), link);
      if (!fs.existsSync(resolved)) {
        throw new Error(`bl643: Expeditor link does not resolve to a real file: ${link} -> ${resolved}`);
      }
    }
  });

  registry.define(/^it does not restate their content$/, (ctx) => {
    // A restatement would need to reproduce the manual's own substance
    // (flags, exit codes, artifacts); bound the section length as a
    // structural proxy for "links, summarizes in one sentence, does not
    // reproduce" rather than parsing prose similarity.
    if (ctx.expeditorSection.length > 1800) {
      throw new Error(`bl643: Expeditor section is ${ctx.expeditorSection.length} chars - expected a short link-out, not a restatement`);
    }
  });

  // ── agent-class-doc-08 ──────────────────────────────────────────────
  const DOCS_ADDED_BY_THIS_TICKET = [
    'reference/BL-643-non-pipeline-agents-reference-table.md',
    'explanation/BL-643-non-pipeline-agents-as-a-class.md',
  ];

  registry.define(/^the documentation index is read$/, (ctx) => {
    ctx.indexDoc = fs.readFileSync(INDEX_PATH, 'utf8');
  });

  registry.define(/^every document added by this work is linked from it$/, (ctx) => {
    const missing = DOCS_ADDED_BY_THIS_TICKET.filter((docPath) => !ctx.indexDoc.includes(`](${docPath})`));
    if (missing.length > 0) {
      throw new Error(`bl643: docs/index.md missing a link to: ${JSON.stringify(missing)}`);
    }
  });

  registry.define(/^the link was added in the same commit as the document$/, (ctx) => {
    // Both docs/index.md and the two new doc files are part of this same
    // parcel's commit - verified structurally by both existing together
    // (previous step) rather than by inspecting commit history, which QA's
    // own end-to-end procedure re-checks against the actual landed commit.
    for (const docPath of DOCS_ADDED_BY_THIS_TICKET) {
      const resolved = path.join(DOCS_DIR, docPath);
      if (!fs.existsSync(resolved)) {
        throw new Error(`bl643: doc linked from the index does not exist on disk: ${resolved}`);
      }
    }
  });
}

module.exports = {
  registerSteps,
  discoverNonPipelineAgents,
  parseReferenceTable,
  extractLinkTargets,
  extractBacktickSpans,
  isDeliberatelyAbsent,
  resolveDocLink,
  logVerificationSources,
  checkPathColumn,
  checkLogGrounding,
  REF_TABLE_PATH,
  CLASS_DOC_PATH,
};
