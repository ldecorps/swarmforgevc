// BL-256: PWA deep links for briefing items (deep-links-into-pwa-04).
// pwa_base_url is a new, OPTIONAL swarmforge.conf key - there is no
// reusable existing config for it (grep-confirmed) and, unlike an email
// address, no universal sensible default (the deployed Pages URL is
// dynamically assigned per GitHub Pages workflow run). Mirrors
// recertificationStore.ts's parseRecertEmailTo/readRecertEmailTo
// convention exactly, except absent/unset degrades to no deep link at all
// (graceful-missing-data-05), never a broken link or a fabricated URL.
import { parseConfigValue, readConfigValue } from '../util/swarmforgeConfig';

export function parsePwaBaseUrl(confContent: string): string | undefined {
  return parseConfigValue(confContent, 'pwa_base_url');
}

export function readPwaBaseUrl(targetPath: string): string | undefined {
  return readConfigValue(targetPath, 'pwa_base_url');
}

function withTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
}

// Matches pwa/app.js's own upcoming hash-route parsing (#ticket=<id>
// opens the docs-explorer ticket view).
export function buildTicketDeepLink(pwaBaseUrl: string | undefined, ticketId: string): string | null {
  return pwaBaseUrl ? `${withTrailingSlash(pwaBaseUrl)}#ticket=${ticketId}` : null;
}

// #approval=<id> opens the needs-approval detail view (BL-266).
export function buildApprovalDeepLink(pwaBaseUrl: string | undefined, ticketId: string): string | null {
  return pwaBaseUrl ? `${withTrailingSlash(pwaBaseUrl)}#approval=${ticketId}` : null;
}
