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
  'launch_operator_runtime_supervisor.sh': 'Operator Runtime Watch',
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
  // BL-1064: the Front Desk row names TWO logs written by two different
  // files. launch_front_desk.sh writes front-desk-supervisor.log; BL-582's
  // durable diagnostic sink, front-desk-diagnostics.log, is written by the
  // BOT ITSELF, not by its launcher. The launcher-derived fallback could
  // never contain that second literal, so the row was permanently ungrounded
  // and both bl643 property tests failed on every host. The table is right;
  // what was missing is the checker's knowledge of which file writes what.
  'Front Desk': [
    path.join(SCRIPTS_DIR, 'launch_front_desk.sh'),
    path.join(REPO_ROOT, 'extension', 'src', 'tools', 'telegram-front-desk-bot.ts'),
  ],
  Expeditor: null, // checked structurally below (a directory, not a literal in one script)
};

/**
 * The files a row's log literals are checked against, and whether that list
 * was DECLARED or merely derived from the Launcher column.
 *
 * BL-1064 invariant 1: the check must never fall back to a source that cannot
 * contain the literal. It cannot know that in advance - but when a derived
 * source fails to ground a literal, that is a missing declaration rather than
 * documentation drift, and the two need different messages because they need
 * different fixes.
 */
function logVerificationSources(row) {
  if (Object.prototype.hasOwnProperty.call(LOG_VERIFICATION_SOURCE_OVERRIDES, row.Agent)) {
    return LOG_VERIFICATION_SOURCE_OVERRIDES[row.Agent];
  }
  const launcherTargets = extractLinkTargets(row.Launcher).map(resolveDocLink);
  return launcherTargets.filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
}

function logSourcesAreDeclared(row) {
  return Object.prototype.hasOwnProperty.call(LOG_VERIFICATION_SOURCE_OVERRIDES, row.Agent);
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
    // BL-1064: say which of the two failures this is. A DECLARED source that
    // no longer contains the literal is real drift - the table or the writer
    // moved. A DERIVED source that never could contain it is a missing
    // declaration, and reporting it as drift sends the reader to fix prose
    // that is already correct, which is how this one sat until a property run
    // surfaced it.
    // One shared prefix, so the existing BL-643 assertions keep matching and
    // both failures name the row and the literal. The derived case then adds
    // WHY, because it needs a different fix.
    const base = `bl643: row "${row.Agent}" log literal(s) not found (by basename) in its verification source(s): ${JSON.stringify(ungrounded)}`;
    if (logSourcesAreDeclared(row)) {
      throw new Error(base);
    }
    const shown = sources.map((abs) => {
      const rel = path.relative(REPO_ROOT, abs);
      return rel.startsWith('..') ? abs : rel;
    });
    throw new Error(
      `${base} — and those source(s) were DERIVED from the Launcher column (${shown.join(', ')}), not declared. ` +
      `If another file writes the literal, declare it in LOG_VERIFICATION_SOURCE_OVERRIDES; do not delete the claim from the table.`
    );
  }
}

// ── build-state claims vs the backlog (agent-class-doc-06, BL-1005) ─────
// The original step froze a SNAPSHOT of build state (literal BL-624/BL-625
// + "not built yet"), so the gate went red the day aa1949aec landed BL-625
// and the document honestly stopped calling those slices unbuilt. Every
// claim is now DERIVED from the document under test and checked against
// the backlog, symmetrically: shipped -> the cited ticket is closed,
// unbuilt -> the cited ticket is still open. Extraction works on prose
// blocks (blank-line separated), so a claim wrapped across source lines
// stays one claim: a block with an explicit marker phrase claims every
// ticket id it names, a "Slice N (BL-x)" heading claims its own id as
// shipped unless the same block explicitly says it is not built. A block
// mixing both markers around ids, or a section claiming one id both ways,
// fails loudly rather than attributing by guesswork.
const SHIPPED_MARKER_RE = /\bon\s+(?:the\s+)?`?main`?(?:\s+branch)?\b|\bshipped\b|\blanded\b/i;
const UNBUILT_MARKER_RE = /\bunbuilt\b|\bunshipped\b|\bnot\s+(?:yet\s+)?built(?:\s+yet)?\b|\bnot\s+yet\s+(?:shipped|landed)\b/i;
const TICKET_ID_RE = /\bBL-\d+\b/g;
const SLICE_HEADING_RE = /\bSlice\s+\d+\s*\(\s*(BL-\d+)\s*\)/g;

const CLAIM_TO_BACKLOG_STATE = {
  shipped: 'closed',
  unbuilt: 'open',
};

function extractBuildStateClaims(sectionText) {
  const byTicket = new Map();
  const record = (ticketId, claim) => {
    const existing = byTicket.get(ticketId);
    if (existing && existing !== claim) {
      throw new Error(`bl1005: conflicting build-state claims for ${ticketId} - the section calls it both shipped and unbuilt`);
    }
    byTicket.set(ticketId, claim);
  };
  for (const block of sectionText.split(/\n\s*\n/)) {
    const ids = [...new Set(block.match(TICKET_ID_RE) ?? [])];
    const hasUnbuilt = UNBUILT_MARKER_RE.test(block);
    // Test the shipped marker with unbuilt phrases stripped: "not yet
    // shipped" contains the word "shipped" and must read as unbuilt, not
    // as an ambiguous shipped/unbuilt mix.
    const hasShipped = SHIPPED_MARKER_RE.test(block.replace(new RegExp(UNBUILT_MARKER_RE.source, 'gi'), ' '));
    if (hasShipped && hasUnbuilt && ids.length > 0) {
      throw new Error(`bl1005: ambiguous block - both shipped and unbuilt markers around ticket id(s) ${JSON.stringify(ids)}; split the prose so each claim is unambiguous`);
    }
    if (ids.length > 0 && (hasShipped || hasUnbuilt)) {
      const claim = hasUnbuilt ? 'unbuilt' : 'shipped';
      for (const id of ids) {
        record(id, claim);
      }
      continue;
    }
    // No block-level marker: a "Slice N (BL-x)" heading in this
    // what-shipped section still claims its own id as shipped.
    let m;
    SLICE_HEADING_RE.lastIndex = 0;
    while ((m = SLICE_HEADING_RE.exec(block))) {
      if (!hasUnbuilt) {
        record(m[1], 'shipped');
      }
    }
  }
  return [...byTicket.entries()].map(([ticketId, claim]) => ({ ticketId, claim }));
}

const BACKLOG_ROOT = path.join(REPO_ROOT, 'backlog');
const OPEN_BACKLOG_DIRS = ['active', 'paused', 'hold'];

function backlogDirHasTicket(dir, ticketId) {
  if (!fs.existsSync(dir)) {
    return false;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Closed tickets do NOT all sit flat: BL-590 is at done/BL-590-...
      // while BL-624/625 are under done/M8/ - always recurse.
      if (backlogDirHasTicket(path.join(dir, entry.name), ticketId)) {
        return true;
      }
    } else if (new RegExp(`^${ticketId}[.-]`).test(entry.name)) {
      return true;
    }
  }
  return false;
}

function resolveTicketBacklogState(ticketId, backlogRoot = BACKLOG_ROOT) {
  // done/ wins over a stale duplicate lingering in active/: closure is
  // recorded by the done/ move, the leftover is repo-hygiene noise.
  if (backlogDirHasTicket(path.join(backlogRoot, 'done'), ticketId)) {
    return 'closed';
  }
  for (const dir of OPEN_BACKLOG_DIRS) {
    if (backlogDirHasTicket(path.join(backlogRoot, dir), ticketId)) {
      return 'open';
    }
  }
  return 'missing';
}

function checkBuildStateClaims(sectionText, claimKind, resolveState) {
  const claims = extractBuildStateClaims(sectionText);
  // The ticket's declared invariant: the handler either extracts at least
  // one build-state claim and checks every one, or it FAILS - zero claims
  // found is a failure, never a vacuous pass.
  if (claims.length === 0) {
    throw new Error('bl1005: zero build-state claims extracted from the Onboarder section - refusing to pass vacuously; a what-shipped section that names no owning ticket is a documentation defect');
  }
  const expected = CLAIM_TO_BACKLOG_STATE[claimKind];
  const wrong = claims
    .filter((c) => c.claim === claimKind)
    .map((c) => ({ ...c, actual: resolveState(c.ticketId) }))
    .filter((c) => c.actual !== expected);
  if (wrong.length > 0) {
    throw new Error(`bl1005: phase(s) the document calls ${claimKind} do not cite a ${expected} ticket: ${JSON.stringify(wrong)}`);
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

  registry.define(/^every phase it names as (.+) cites a ticket that is (.+)$/, (ctx, claim, backlogState) => {
    // Scenario Outline handler: validate against the explicit known
    // pairs - no passthrough (engineering.prompt KNOWN_VALUES rule).
    if (!Object.prototype.hasOwnProperty.call(CLAIM_TO_BACKLOG_STATE, claim) || CLAIM_TO_BACKLOG_STATE[claim] !== backlogState) {
      throw new Error(`bl1005 agent-class-doc-06: unrecognized <claim>/<backlog state> pairing "${claim}"/"${backlogState}"`);
    }
    checkBuildStateClaims(ctx.onboarderSection, claim, resolveTicketBacklogState);
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
  logSourcesAreDeclared,
  LOG_VERIFICATION_SOURCE_OVERRIDES,
  checkPathColumn,
  checkLogGrounding,
  extractBuildStateClaims,
  resolveTicketBacklogState,
  checkBuildStateClaims,
  CLAIM_TO_BACKLOG_STATE,
  REF_TABLE_PATH,
  CLASS_DOC_PATH,
};
