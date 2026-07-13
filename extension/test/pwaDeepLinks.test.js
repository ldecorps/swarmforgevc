const assert = require('node:assert/strict');
const {
  parsePwaBaseUrl,
  readPwaBaseUrl,
  buildTicketDeepLink,
  buildApprovalDeepLink,
  buildRecertDeepLink,
} = require('../out/metrics/pwaDeepLinks');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// BL-256 deep-links-into-pwa-04: no existing pwa_base_url config anywhere
// in this codebase (grep-confirmed) - a new, OPTIONAL swarmforge.conf key,
// mirroring recertificationStore.ts's parseRecertEmailTo/readRecertEmailTo
// convention exactly, except with no universal sensible default (unlike an
// email address, there's no fallback PWA URL) - absent/unset degrades to
// no deep link at all (graceful-missing-data-05), never a broken link.

test('parsePwaBaseUrl reads the configured value', () => {
  assert.equal(parsePwaBaseUrl('config pwa_base_url https://example.github.io/dashboard/\n'), 'https://example.github.io/dashboard/');
});

test('parsePwaBaseUrl returns undefined when the key is absent', () => {
  assert.equal(parsePwaBaseUrl('config notify_email_to a@b.com\n'), undefined);
});

test('readPwaBaseUrl returns undefined when swarmforge.conf itself is missing, never a crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-deep-links-test-'));
  assert.equal(readPwaBaseUrl(dir), undefined);
});

test('readPwaBaseUrl reads the real conf file shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-deep-links-test-'));
  fs.mkdirSync(path.join(dir, 'swarmforge'));
  fs.writeFileSync(path.join(dir, 'swarmforge', 'swarmforge.conf'), 'config pwa_base_url https://example.github.io/dashboard/\n');
  assert.equal(readPwaBaseUrl(dir), 'https://example.github.io/dashboard/');
});

// ── buildTicketDeepLink / buildApprovalDeepLink ─────────────────────────

test('buildTicketDeepLink builds a #ticket= fragment URL, normalizing a missing trailing slash', () => {
  assert.equal(buildTicketDeepLink('https://example.github.io/dashboard', 'BL-200'), 'https://example.github.io/dashboard/#ticket=BL-200');
});

test('buildTicketDeepLink preserves an already-trailing-slash base', () => {
  assert.equal(buildTicketDeepLink('https://example.github.io/dashboard/', 'BL-200'), 'https://example.github.io/dashboard/#ticket=BL-200');
});

test('buildTicketDeepLink returns null when no base URL is configured', () => {
  assert.equal(buildTicketDeepLink(undefined, 'BL-200'), null);
});

test('buildApprovalDeepLink builds a #approval= fragment URL', () => {
  assert.equal(buildApprovalDeepLink('https://example.github.io/dashboard/', 'BL-200'), 'https://example.github.io/dashboard/#approval=BL-200');
});

test('buildApprovalDeepLink returns null when no base URL is configured', () => {
  assert.equal(buildApprovalDeepLink(undefined, 'BL-200'), null);
});

// ── buildRecertDeepLink (BL-339) ──────────────────────────────────────────

test('BL-339: buildRecertDeepLink builds a #recert=1 fragment URL, a batch-level link (no per-scenario id)', () => {
  assert.equal(buildRecertDeepLink('https://example.github.io/dashboard/'), 'https://example.github.io/dashboard/#recert=1');
});

test('buildRecertDeepLink normalizes a missing trailing slash, same as the other deep-link builders', () => {
  assert.equal(buildRecertDeepLink('https://example.github.io/dashboard'), 'https://example.github.io/dashboard/#recert=1');
});

test('buildRecertDeepLink returns null when no base URL is configured', () => {
  assert.equal(buildRecertDeepLink(undefined), null);
});
