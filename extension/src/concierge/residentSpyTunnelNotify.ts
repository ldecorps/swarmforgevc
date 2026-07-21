// BL-522: push the Resident Spy Mini App URL into the standing Telegram
// topic when the cloudflare quick-tunnel URL (or bridge token) changes.

import { syncEditInPlaceMessage, EditInPlaceMessageState } from './editInPlaceMessageSync';

export function buildResidentSpyMiniAppUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/resident-spy?token=${encodeURIComponent(token)}`;
}

export function formatResidentSpyTunnelTopicMessage(fullUrl: string): string {
  return `Live feed (Mini App):\n${fullUrl}`;
}

export function shouldNotifyResidentSpyTunnelUrl(prevUrl: string | undefined, nextUrl: string): boolean {
  return prevUrl !== nextUrl;
}

export interface ResidentSpyTunnelNotifyAdapters {
  ensureTopic: () => Promise<number | undefined>;
  postMessage: (topicId: number, text: string) => Promise<number | undefined>;
  editMessage: (topicId: number, messageId: number, text: string) => Promise<boolean>;
}

export type ResidentSpyTunnelNotifyState = EditInPlaceMessageState & { url?: string };

export async function syncResidentSpyTunnelUrl(
  fullUrl: string,
  prevState: ResidentSpyTunnelNotifyState | undefined,
  adapters: ResidentSpyTunnelNotifyAdapters
) {
  if (!shouldNotifyResidentSpyTunnelUrl(prevState?.url, fullUrl)) {
    return { state: prevState ?? {}, outcome: 'skipped-unchanged' as const };
  }
  const text = formatResidentSpyTunnelTopicMessage(fullUrl);
  const result = await syncEditInPlaceMessage(text, prevState, adapters);
  return {
    ...result,
    state: { ...result.state, url: fullUrl },
  };
}
