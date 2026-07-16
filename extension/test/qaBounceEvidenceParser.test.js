const assert = require('node:assert/strict');
const {
  parseTicketIdFromFilename,
  parseDateFromFilename,
  parseFailureClassFromEvidence,
  parseProducingRoleFromEvidence,
  parseCommitFromEvidence,
  parseBounceEvidenceFile,
} = require('../out/quality/qaBounceEvidenceParser');

// BL-454: heuristic extraction over the free-text backlog/evidence/*.md
// corpus. Fixtures below deliberately mirror the several real shapes found
// in that corpus (heading vs inline failure-class field, filename-suffixed
// vs prose-only role attribution, an explicit "bounce to <role>" verdict) -
// see backlog/evidence/BL-233-*, BL-249-*, BL-414-* for the real originals
// this is modeled on.

// ── parseTicketIdFromFilename / parseDateFromFilename ───────────────────

test('parseTicketIdFromFilename normalizes the standard "BL-NNN" prefix', () => {
  assert.equal(parseTicketIdFromFilename('BL-340-role-benchmark-harness-slice-1-bounce-20260714.md'), 'BL-340');
});

test('parseTicketIdFromFilename normalizes the lowercase no-hyphen "blNNN" prefix', () => {
  assert.equal(parseTicketIdFromFilename('bl389-offset-fix-bounce-20260714.md'), 'BL-389');
});

test('parseTicketIdFromFilename returns null for a filename with no ticket id', () => {
  assert.equal(parseTicketIdFromFilename('incident-20260713-quiet-swarm-postmortem.md'), null);
});

test('parseDateFromFilename extracts a YYYYMMDD run into an ISO date', () => {
  assert.equal(parseDateFromFilename('BL-340-role-benchmark-harness-slice-1-bounce-20260714.md'), '2026-07-14');
});

test('parseDateFromFilename returns null when no date is present', () => {
  assert.equal(parseDateFromFilename('BL-340-no-date.md'), null);
});

// ── parseFailureClassFromEvidence ─────────────────────────────────────────

test('extracts a failure class from a heading followed by a backtick-quoted value', () => {
  const content = '# BL-340 bounce\n\n## Failure class\n\n`behavior`\n';
  assert.equal(parseFailureClassFromEvidence(content), 'behavior');
});

test('extracts a failure class from a heading followed by a bold value with trailing prose', () => {
  const content = '## 4. Failure Class\n\n**behavior** — the documented architecture does not match.\n';
  assert.equal(parseFailureClassFromEvidence(content), 'behavior');
});

test('extracts a failure class from an inline bold label on the same line', () => {
  const content = '3. **Commit hash**: `abc123`\n4. **Failure class**: `compile`.\n';
  assert.equal(parseFailureClassFromEvidence(content), 'compile');
});

test('extracts a failure class from an inline bold label with the colon inside the bold span', () => {
  const content = '4. **Failure class:** `behavior`.\n';
  assert.equal(parseFailureClassFromEvidence(content), 'behavior');
});

test('returns null when the field value is outside the closed set (e.g. a real "scope" finding)', () => {
  const content = '## Failure class\n\n`scope`\n';
  assert.equal(parseFailureClassFromEvidence(content), null);
});

test('returns null when there is no failure class field at all', () => {
  const content = '# BL-100 scope gap\n\nSome prose with no structured fields.\n';
  assert.equal(parseFailureClassFromEvidence(content), null);
});

// ── parseProducingRoleFromEvidence ────────────────────────────────────────

test('prefers an explicit "bounce to <role>" verdict line over the heading', () => {
  const content = '# BL-414 hardener bounce — 20260715\n\n## Verdict: BOUNCE to coder — no rate-limit protection\n';
  assert.equal(parseProducingRoleFromEvidence(content, 'BL-414-bounce-20260715.md'), 'coder');
});

// A role named in the filename/heading is who REPORTED the bounce, not who
// produced the defect - the real corpus confirms this (BL-233's cleaner-
// authored file bounces a compile error the CODER introduced). So the
// reporter maps to the pipeline stage immediately before it: a hardener-
// authored bounce attributes to the architect, whose forwarded work the
// hardener was reviewing.
test('maps a role token in the filename to the pipeline stage immediately before it (a hardener-authored bounce attributes to the architect)', () => {
  const content = '# BL-259 hardener bounce evidence\n\nSome prose.\n';
  assert.equal(parseProducingRoleFromEvidence(content, 'BL-259-gated-dependency-rule-checker-bounce-20260710-hardener.md'), 'architect');
});

test('maps a role token in the first heading line to the pipeline stage immediately before it when the filename has none', () => {
  const content = '# BL-249 bounce evidence — 20260710 (hardener)\n\nProse.\n';
  assert.equal(parseProducingRoleFromEvidence(content, 'BL-249-locale-font-cache-purge-regression-20260710.md'), 'architect');
});

test('a QA-authored bounce (no explicit verdict) defaults to coder, this pipeline\'s own routing convention', () => {
  const content = '# BL-259 bounce evidence — 20260710 (QA)\n\nProse.\n';
  assert.equal(parseProducingRoleFromEvidence(content, 'BL-259-gated-dependency-rule-checker-bounce-20260710-qa2.md'), 'coder');
});

test('normalizes the natural-English "hardener" spelling to the codebase\'s own "hardender" role', () => {
  assert.equal(parseProducingRoleFromEvidence('bounced to hardener for follow-up', 'BL-1-x.md'), 'hardender');
});

test('returns null when no role can be found anywhere', () => {
  const content = '# BL-100 scope gap\n\nNo role named here.\n';
  assert.equal(parseProducingRoleFromEvidence(content, 'BL-100-scope-gap-20260709.md'), null);
});

// ── parseCommitFromEvidence ───────────────────────────────────────────────

test('extracts and normalizes a commit hash to 10 lowercase hex characters', () => {
  assert.equal(parseCommitFromEvidence('Commit hash tested\n`974050F9D8AA`\n'), '974050f9d8');
});

test('returns an empty string when no commit hash is present', () => {
  assert.equal(parseCommitFromEvidence('No hash here.'), '');
});

// ── parseBounceEvidenceFile (the combined gate) ──────────────────────────

test('a genuine bounce file with a heading-style failure class and a filename role suffix is parsed in full', () => {
  const filename = 'BL-259-gated-dependency-rule-checker-bounce-20260710-hardener.md';
  const content = ['# BL-259 hardener bounce', '', '## Failure class', '', '`behavior`', '', 'Commit hash tested', '`abc1234567890`'].join('\n');
  const parsed = parseBounceEvidenceFile(filename, content);
  assert.deepEqual(parsed, {
    ticket: 'BL-259',
    producingRole: 'architect',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-10T00:00:00.000Z',
  });
});

test('a genuine bounce file with an inline failure class and an explicit verdict line is parsed in full', () => {
  const filename = 'BL-414-title-age-first-tick-rate-limit-bounce-20260715.md';
  const content = ['# BL-414 hardener bounce — 20260715', '', '## Verdict: BOUNCE to coder', '', '4. **Failure class**: `behavior`.'].join(
    '\n'
  );
  const parsed = parseBounceEvidenceFile(filename, content);
  assert.equal(parsed.ticket, 'BL-414');
  assert.equal(parsed.producingRole, 'coder');
  assert.equal(parsed.failureClass, 'behavior');
});

test('a non-bounce evidence file (no failure class field) is not parsed as a bounce', () => {
  const filename = 'BL-368-already-shipped-20260716.md';
  const content = '# BL-368 already shipped\n\nThe feature was already delivered by BL-367; no action needed.\n';
  assert.equal(parseBounceEvidenceFile(filename, content), null);
});

test('a file whose failure class is outside the closed set is not parsed as a bounce', () => {
  const filename = 'BL-100-scope-gap-20260709.md';
  const content = '# BL-100 scope gap (coder)\n\n## Failure class\n\n`scope`\n';
  assert.equal(parseBounceEvidenceFile(filename, content), null);
});

test('a file with no ticket id in its filename is not parsed as a bounce', () => {
  const filename = 'roadmap-gap-scan-20260710.md';
  const content = '## Failure class\n\n`behavior`\n(coder)\n';
  assert.equal(parseBounceEvidenceFile(filename, content), null);
});
