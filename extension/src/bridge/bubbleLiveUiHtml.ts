// BL-775: Bubble's Live page, served in the UI bundle at /live.
//
// Per the human's 2026-08-06 "flip BL-775 to remote" ruling, this is NOT a
// second implementation of the coordinator + resident Live Screen - it is
// the SAME renderer the Telegram Mini App shell already uses
// (residentSpyUiHtml.ts's renderLiveScreenBody), published under a second
// URL so Bubble's pager can open it. Invariant 1 forbids a copy; this file
// exists only to give that one renderer a second entry path.

import { renderLiveScreenBody } from './residentSpyUiHtml';

export function getBubbleLiveUiHtml(): string {
  return renderLiveScreenBody();
}

export function isBubbleLivePath(url: string): boolean {
  return url.split('?', 1)[0] === '/live';
}
