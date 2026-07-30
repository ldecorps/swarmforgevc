'use strict';

// BL-723: live-swarm queue-jump review of 13 offline-pilot-landed defect
// tickets. Every step here reads a real committed artifact - the review
// body, the briefing email body, or a reviewed ticket's own YAML - never a
// prompt-text assertion. The review body's markdown shape (headings,
// **Verdict:**, **Filed defects:** markers) is a contract this file and
// docs/how-to/BL-723-pilot-tonight-quality-review.md must both honor.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REVIEW_BODY_PATH = path.join(REPO_ROOT, 'docs', 'how-to', 'BL-723-pilot-tonight-quality-review.md');
const EMAIL_BODY_PATH = path.join(REPO_ROOT, 'docs', 'briefings', '2026-07-30-bl723-pilot-review.md');
const BACKLOG_DONE_DIR = path.join(REPO_ROOT, 'backlog', 'done');
const BACKLOG_SEARCH_DIRS = ['paused', 'active', 'done', 'hold'].map((d) => path.join(REPO_ROOT, 'backlog', d));

const FEATURE = "Live swarm reviews tonight's pilot-landed defect quality";

const PRIMARY_TICKETS = [
  'BL-718', 'BL-627', 'BL-636', 'BL-637', 'BL-641', 'BL-642', 'BL-646',
  'BL-623', 'BL-671', 'BL-694', 'BL-559', 'BL-661', 'BL-662',
];

const SEATS = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

// Parent of the specifier's BL-723 reset commit - predates any review work
// on these 13 tickets. The prior (voided) pass left no artifacts to revert
// (per that commit's own message), so this is a safe pre-review baseline.
const REVIEW_BASE_REF = '6312ec862c~1';

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function findInDirs(id, dirs) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find((f) => f.startsWith(`${id}-`) && f.endsWith('.yaml'));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

function findBacklogFile(id) {
  return findInDirs(id, BACKLOG_SEARCH_DIRS);
}

function findDoneFile(id) {
  return findInDirs(id, [BACKLOG_DONE_DIR]);
}

// Splits a markdown document into heading-delimited sections. Only ATX
// (`#`..`######`) headings are recognized - the format this file and the
// review body both commit to.
function splitSections(text) {
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
  const matches = [...text.matchAll(headingRe)];
  return matches.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    return { level: m[1].length, title: m[2].trim(), body: text.slice(start, end).trim() };
  });
}

// Shared parser for both the review body and the email body - the two
// artifacts deliberately share one markdown shape (overall verdict,
// per-seat viewpoint sections, optional per-ticket verdict sections).
function parseReviewLikeDocument(text) {
  const sections = splitSections(text);
  const viewpoints = new Map();
  const perTicket = new Map();

  for (const section of sections) {
    if (/viewpoint/i.test(section.title)) {
      const seat = SEATS.find((s) => section.title.toLowerCase().startsWith(s.toLowerCase()));
      if (seat) viewpoints.set(seat.toLowerCase(), section);
    }
    const idMatch = section.title.match(/^(BL-\d+)$/);
    if (idMatch) {
      const verdictMatch = section.body.match(/\*\*Verdict:\*\*\s*(on-par|not-on-par)/i);
      const filedMatch = section.body.match(/\*\*Filed defects:\*\*\s*([\s\S]*?)(?=\n\n|$)/i);
      const filedDefects = filedMatch ? filedMatch[1].match(/BL-\d+/g) || [] : [];
      perTicket.set(idMatch[1], {
        body: section.body,
        verdict: verdictMatch ? verdictMatch[1].toLowerCase() : null,
        filedDefects,
      });
    }
  }

  const overallMatch = text.match(/\*\*Overall verdict:\*\*\s*(NOT ON PAR|ON PAR)/i);
  const overallVerdict = overallMatch ? (/^NOT/i.test(overallMatch[1]) ? 'not-on-par' : 'on-par') : null;

  const reasonsMatch = text.match(/\*\*Verdict reasons:\*\*\s*([\s\S]*?)(?=\n\*\*Process:|\n#{1,6}\s|$)/i);
  const reasonsText = reasonsMatch ? reasonsMatch[1].trim() : '';

  const firstNonEmptyLine = (text.split('\n').find((l) => l.trim().length > 0) || '').trim();

  return { sections, viewpoints, perTicket, overallVerdict, reasonsText, firstNonEmptyLine };
}

// Extracts a top-level YAML key's raw block (header line through the line
// before the next top-level key, or EOF) without a full YAML parse - good
// enough to byte-compare a `description:`/`acceptance:` block across two
// revisions of the same file.
function extractTopLevelBlock(text, key) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n').trimEnd();
}

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

// Several scenarios enter directly on a step that needs the parsed review
// body without an earlier "the review body is read" step in that same
// scenario (e.g. review-05's own When step IS the entry point) - load and
// cache lazily rather than assuming step order across scenarios.
function ensureReviewBody(ctx) {
  if (!ctx.reviewBody) {
    ctx.reviewBodyText = ctx.reviewBodyText || readFile(REVIEW_BODY_PATH);
    ctx.reviewBody = parseReviewLikeDocument(ctx.reviewBodyText);
  }
  return ctx.reviewBody;
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  scoped(registry, /^the review body docs\/how-to\/BL-723-pilot-tonight-quality-review\.md exists$/, (ctx) => {
    if (!fs.existsSync(REVIEW_BODY_PATH)) {
      throw new Error(`review body does not exist: ${REVIEW_BODY_PATH}`);
    }
    ctx.reviewBodyText = readFile(REVIEW_BODY_PATH);
  });

  scoped(registry, /^the email body docs\/briefings\/2026-07-30-bl723-pilot-review\.md exists$/, (ctx) => {
    if (!fs.existsSync(EMAIL_BODY_PATH)) {
      throw new Error(`email body does not exist: ${EMAIL_BODY_PATH}`);
    }
    ctx.emailBodyText = readFile(EMAIL_BODY_PATH);
  });

  // ── shared "is read" steps ──────────────────────────────────────────
  scoped(registry, /^the review body is read$/, (ctx) => {
    ctx.reviewBodyText = readFile(REVIEW_BODY_PATH);
    ctx.reviewBody = parseReviewLikeDocument(ctx.reviewBodyText);
    ctx.lastRead = 'review';
  });

  scoped(registry, /^the email body is read$/, (ctx) => {
    ctx.emailBodyText = readFile(EMAIL_BODY_PATH);
    ctx.emailBody = parseReviewLikeDocument(ctx.emailBodyText);
    ctx.lastRead = 'email';
  });

  // ── review-01: every primary ticket gets a quality look ─────────────
  scoped(registry, /^it carries a per-ticket verdict section for each of (.+)$/, (ctx, listText) => {
    const reviewBody = ensureReviewBody(ctx);
    const ids = listText.match(/BL-\d+/g) || [];
    if (ids.length !== PRIMARY_TICKETS.length) {
      throw new Error(`expected ${PRIMARY_TICKETS.length} tickets named in the step text, found ${ids.length}`);
    }
    for (const id of ids) {
      const section = reviewBody.perTicket.get(id);
      if (!section) {
        throw new Error(`review body has no per-ticket verdict section for ${id}`);
      }
    }
  });

  // ── review-02 / review-08: explicit overall verdict (shared text) ───
  scoped(registry, /^it states the overall on-par or not-on-par verdict$/, (ctx) => {
    const doc = ctx.lastRead === 'email' ? ctx.emailBody : ensureReviewBody(ctx);
    if (!doc || !doc.overallVerdict) {
      throw new Error(`no parsable "**Overall verdict:**" line found in the ${ctx.lastRead || 'review'} body`);
    }
  });

  scoped(registry, /^it names reasons for that verdict against normal live coder-through-qa expectations$/, (ctx) => {
    const reasons = ensureReviewBody(ctx).reasonsText;
    if (!reasons || reasons.length < 40) {
      throw new Error('review body has no substantive "**Verdict reasons:**" text');
    }
    const lower = reasons.toLowerCase();
    if (!lower.includes('coder') || !lower.includes('qa')) {
      throw new Error('verdict reasons do not reference live coder-through-QA pipeline expectations');
    }
  });

  // ── review-03: a per-seat viewpoint is recorded for every required stage ─
  scoped(registry, /^it carries a distinct viewpoint section for each of (.+)$/, (ctx, seatText) => {
    const reviewBody = ensureReviewBody(ctx);
    const seat = seatText.trim();
    const key = seat.toLowerCase();
    const section = reviewBody.viewpoints.get(key);
    if (!section || section.body.trim().length === 0) {
      throw new Error(`review body has no non-empty viewpoint section for seat "${seat}"`);
    }
    const bodies = [...reviewBody.viewpoints.values()].map((v) => v.body.trim());
    const matchesThisSeat = bodies.filter((b) => b === section.body.trim());
    if (matchesThisSeat.length > 1) {
      throw new Error(`viewpoint section for "${seat}" duplicates another seat's section verbatim - not distinct`);
    }
  });

  // ── review-04: the QA viewpoint is the fullest section ───────────────
  scoped(registry, /^the QA viewpoint section is longer than every other seat's viewpoint section$/, (ctx) => {
    const reviewBody = ensureReviewBody(ctx);
    const qa = reviewBody.viewpoints.get('qa');
    if (!qa) {
      throw new Error('review body has no QA viewpoint section');
    }
    const qaLen = qa.body.trim().length;
    for (const [seat, section] of reviewBody.viewpoints) {
      if (seat === 'qa') continue;
      const len = section.body.trim().length;
      if (len >= qaLen) {
        throw new Error(`QA viewpoint (${qaLen} chars) is not longer than ${seat} viewpoint (${len} chars)`);
      }
    }
  });

  // ── review-05: shortfalls file both remaining-work and pilot-process ─
  scoped(registry, /^the review body records a shortfall against live-swarm quality$/, (ctx) => {
    const reviewBody = ensureReviewBody(ctx);
    const shortfalls = [];
    for (const [id, info] of reviewBody.perTicket) {
      if (info.verdict === 'not-on-par') shortfalls.push({ id, ...info });
    }
    if (shortfalls.length === 0) {
      throw new Error('review body records no shortfall (no ticket carries a not-on-par verdict)');
    }
    ctx.shortfalls = shortfalls;
  });

  scoped(registry, /^a remaining-work defect ticket exists for what is still wrong or unfinished$/, (ctx) => {
    for (const shortfall of ctx.shortfalls) {
      if (shortfall.filedDefects.length < 1) {
        throw new Error(`${shortfall.id}: review body lists no filed defects for this shortfall`);
      }
      const id = shortfall.filedDefects[0];
      const file = findBacklogFile(id);
      if (!file) {
        throw new Error(`${shortfall.id}: remaining-work defect ${id} has no backlog ticket file`);
      }
      shortfall.remainingWorkId = id;
      shortfall.remainingWorkFile = file;
    }
  });

  scoped(registry, /^a pilot-process defect ticket also exists$/, (ctx) => {
    for (const shortfall of ctx.shortfalls) {
      if (shortfall.filedDefects.length < 2) {
        throw new Error(`${shortfall.id}: fewer than two filed defects listed - need remaining-work AND pilot-process`);
      }
      const id = shortfall.filedDefects[1];
      const file = findBacklogFile(id);
      if (!file) {
        throw new Error(`${shortfall.id}: pilot-process defect ${id} has no backlog ticket file`);
      }
      shortfall.pilotProcessId = id;
      shortfall.pilotProcessFile = file;
    }
  });

  scoped(registry, /^the pilot-process defect names what the pilot missed or which gate should have caught it$/, (ctx) => {
    for (const shortfall of ctx.shortfalls) {
      const text = readFile(shortfall.pilotProcessFile).toLowerCase();
      const namesGateOrMiss = text.includes('pilot') && /gate|catch|miss/.test(text);
      if (!namesGateOrMiss) {
        throw new Error(`${shortfall.pilotProcessId}: does not name what the pilot missed or which gate should have caught it`);
      }
    }
  });

  scoped(registry, /^each filed defect carries type defect with an explicit severity$/, (ctx) => {
    for (const shortfall of ctx.shortfalls) {
      for (const file of [shortfall.remainingWorkFile, shortfall.pilotProcessFile]) {
        const text = readFile(file);
        if (!/^type:\s*defect\s*$/m.test(text)) {
          throw new Error(`${file}: missing "type: defect"`);
        }
        if (!/^severity:\s*\S+/m.test(text)) {
          throw new Error(`${file}: missing an explicit "severity:"`);
        }
      }
    }
  });

  // ── review-06: verdicts are written back onto reviewed tickets ──────
  scoped(registry, /^each reviewed done ticket's YAML is read$/, (ctx) => {
    ctx.doneTickets = new Map();
    for (const id of PRIMARY_TICKETS) {
      const file = findDoneFile(id);
      if (!file) {
        throw new Error(`${id}: not found in backlog/done`);
      }
      ctx.doneTickets.set(id, { file, text: readFile(file) });
    }
  });

  scoped(registry, /^its notes carry that ticket's on-par or not-on-par verdict$/, (ctx) => {
    const reviewBody = ensureReviewBody(ctx);
    for (const [id, ticket] of ctx.doneTickets) {
      const expected = reviewBody.perTicket.get(id)?.verdict;
      if (!expected) {
        throw new Error(`${id}: review body has no verdict to cross-check its notes against`);
      }
      if (!ticket.text.toLowerCase().includes(expected)) {
        throw new Error(`${id}: notes do not carry the "${expected}" verdict`);
      }
    }
  });

  scoped(registry, /^its notes point to any remaining-work or pilot-process defect filed against it$/, (ctx) => {
    const reviewBody = ensureReviewBody(ctx);
    for (const [id, ticket] of ctx.doneTickets) {
      const info = reviewBody.perTicket.get(id);
      for (const defectId of info.filedDefects) {
        if (!ticket.text.includes(defectId)) {
          throw new Error(`${id}: notes do not point to filed defect ${defectId}`);
        }
      }
    }
  });

  // ── review-07: reviewing a landing never rewrites its done history ──
  scoped(registry, /^the review completes$/, () => {
    // Marker step only - review-06/07's own When steps do the real reads.
  });

  scoped(registry, /^every reviewed ticket remains in backlog\/done$/, () => {
    for (const id of PRIMARY_TICKETS) {
      if (!findDoneFile(id)) {
        throw new Error(`${id}: no longer present in backlog/done`);
      }
    }
  });

  scoped(registry, /^no reviewed ticket's acceptance or description was rewritten without a warranted revert$/, () => {
    for (const id of PRIMARY_TICKETS) {
      const file = findDoneFile(id);
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      const current = readFile(file);
      let base;
      try {
        base = execFileSync('git', ['show', `${REVIEW_BASE_REF}:${rel}`], { cwd: REPO_ROOT, encoding: 'utf8' });
      } catch (err) {
        throw new Error(`${id}: could not read pre-review baseline for ${rel} at ${REVIEW_BASE_REF}: ${err.message}`);
      }
      for (const key of ['description', 'acceptance']) {
        const before = extractTopLevelBlock(base, key);
        const after = extractTopLevelBlock(current, key);
        if (before !== after) {
          throw new Error(`${id}: "${key}:" was rewritten during the review (no warranted-revert marker present)`);
        }
      }
    }
  });

  // ── review-08: the email body reaches the human through the live send path ─
  scoped(registry, /^it carries the per-seat viewpoints including QA$/, (ctx) => {
    const doc = ctx.lastRead === 'email' ? ctx.emailBody : ensureReviewBody(ctx);
    for (const seat of SEATS) {
      const section = doc.viewpoints.get(seat.toLowerCase());
      if (!section || section.body.trim().length === 0) {
        throw new Error(`email body has no non-empty viewpoint section for seat "${seat}"`);
      }
    }
  });

  scoped(registry, /^its first non-empty line is a headline of at most 80 characters carrying the verdict$/, (ctx) => {
    const firstLine = ctx.emailBody.firstNonEmptyLine;
    if (!firstLine) {
      throw new Error('email body has no non-empty first line');
    }
    if (firstLine.length > 80) {
      throw new Error(`email body headline is ${firstLine.length} chars, exceeds the 80-char bound: ${JSON.stringify(firstLine)}`);
    }
    const lower = firstLine.toLowerCase();
    if (!lower.includes('on par') && !lower.includes('on-par')) {
      throw new Error(`email body headline does not carry the on-par / not-on-par verdict: ${JSON.stringify(firstLine)}`);
    }
  });

  // ── review-09: this review is not run as offline pilot ───────────────
  scoped(registry, /^it records that BL-723 walked the live swarm path after queue-jump$/, (ctx) => {
    const lower = ctx.reviewBodyText.toLowerCase();
    if (!lower.includes('queue-jump') || !lower.includes('live swarm')) {
      throw new Error('review body does not record that BL-723 walked the live swarm path after queue-jump');
    }
  });

  scoped(registry, /^it records that BL-723 was not driven by the offline expeditor or pilot$/, (ctx) => {
    const lower = ctx.reviewBodyText.toLowerCase();
    if (!lower.includes('expeditor') || !lower.includes('pilot')) {
      throw new Error('review body does not record that BL-723 was not driven by the offline expeditor or pilot');
    }
  });
}

module.exports = { registerSteps, parseReviewLikeDocument, extractTopLevelBlock };
