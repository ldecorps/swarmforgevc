// BL-522: push the Resident Spy Mini App URL into the standing Telegram
// topic when the cloudflare quick-tunnel URL (or bridge token) changes.

import { EditInPlaceMessageState } from './editInPlaceMessageSync';
import { InlineKeyboardButton } from '../notify/telegramClient';

export const RESIDENT_SPY_TUNNEL_NOTIFY_FORMAT_VERSION = 4;

export function buildResidentSpyMiniAppUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/resident-spy?bearer=${encodeURIComponent(token)}`;
}

export function buildConsoleMiniAppUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/console?bearer=${encodeURIComponent(token)}`;
}

export function consoleUrlFromLiveUrl(liveUrl: string): string {
  const parsed = new URL(liveUrl);
  parsed.pathname = '/console';
  return parsed.toString();
}

/**
 * BL-716 dns-05: one-tap Bubble re-pair link built from the same live tunnel
 * URL already carrying the bridge token in its query string. Bubble
 * registers this custom scheme in its manifest; the near-term discovery
 * channel picked for the ticket (deep link over the existing Telegram
 * notify) rather than a stable hostname or a polled discovery document.
 */
export function buildBubblePairingDeepLink(liveUrl: string): string {
  const parsed = new URL(liveUrl);
  const token = parsed.searchParams.get('token') ?? parsed.searchParams.get('bearer') ?? '';
  return `swarmforge-bubble://pair?url=${encodeURIComponent(parsed.origin)}&token=${encodeURIComponent(token)}`;
}

export interface ResidentSpyTunnelUrls {
  liveUrl: string;
  consoleUrl: string;
  pairingDeepLink: string;
}

export function buildResidentSpyTunnelUrls(baseUrl: string, token: string): ResidentSpyTunnelUrls {
  const liveUrl = buildResidentSpyMiniAppUrl(baseUrl, token);
  return {
    liveUrl,
    consoleUrl: buildConsoleMiniAppUrl(baseUrl, token),
    pairingDeepLink: buildBubblePairingDeepLink(liveUrl),
  };
}

export function formatResidentSpyTunnelTopicMessage(botUsername?: string): string {
  const botHint = botUsername ? `@${botUsername}` : 'the front-desk bot';
  return [
    'SwarmForge phone console',
    '',
    `In Telegram (recommended): open a private chat with ${botHint}, then tap the menu button (☰) next to the message field.`,
    'That opens inside Telegram with fullscreen support.',
    '',
    'Browser fallback: tap the button below.',
    '',
    'Bubble pairing stale? Tap "Update Bubble pairing" to re-pair without hunting logs.',
  ].join('\n');
}

/** Group/forum topics cannot use web_app buttons — url opens the system browser. */
export function buildResidentSpyTunnelTopicButtons(urls: ResidentSpyTunnelUrls): InlineKeyboardButton[][] {
  return [
    [{ text: 'Open in browser', url: urls.consoleUrl }],
    [{ text: 'Update Bubble pairing', url: urls.pairingDeepLink }],
  ];
}

/** web_app buttons work only in a private chat with the bot. */
export function buildResidentSpyTunnelPrivateWebAppButtons(urls: ResidentSpyTunnelUrls): InlineKeyboardButton[][] {
  return [
    [{ text: 'Open console', webAppUrl: urls.consoleUrl }],
    [{ text: 'Live screen', webAppUrl: urls.liveUrl }],
    [{ text: 'Update Bubble pairing', url: urls.pairingDeepLink }],
  ];
}

export function shouldNotifyResidentSpyTunnel(
  prev: ResidentSpyTunnelNotifyState | undefined,
  urls: ResidentSpyTunnelUrls
): boolean {
  if (!prev) {
    return true;
  }
  const liveUrl = prev.liveUrl ?? (prev as { url?: string }).url;
  const consoleUrl = prev.consoleUrl ?? (liveUrl ? consoleUrlFromLiveUrl(liveUrl) : undefined);
  if (liveUrl !== urls.liveUrl || consoleUrl !== urls.consoleUrl) {
    return true;
  }
  return (prev.formatVersion ?? 1) < RESIDENT_SPY_TUNNEL_NOTIFY_FORMAT_VERSION;
}

/** @deprecated Use shouldNotifyResidentSpyTunnel */
export function shouldNotifyResidentSpyTunnelUrl(prevUrl: string | undefined, nextUrl: string): boolean {
  return prevUrl !== nextUrl;
}

export interface ResidentSpyTunnelNotifyAdapters {
  ensureTopic: () => Promise<number | undefined>;
  postMessage: (topicId: number, text: string, buttons: InlineKeyboardButton[][]) => Promise<number | undefined>;
  editMessage: (topicId: number, messageId: number, text: string, buttons: InlineKeyboardButton[][]) => Promise<boolean>;
  deleteMessage?: (messageId: number) => Promise<boolean>;
}

export type ResidentSpyTunnelNotifyState = EditInPlaceMessageState & {
  liveUrl?: string;
  consoleUrl?: string;
  formatVersion?: number;
};

export type ResidentSpyTunnelNotifyOutcome =
  | 'posted'
  | 'edited'
  | 'skipped-unchanged'
  | 'failed-no-topic'
  | 'failed-post'
  | 'failed-edit';

export async function syncResidentSpyTunnelUrl(
  liveUrl: string,
  prevState: ResidentSpyTunnelNotifyState | undefined,
  adapters: ResidentSpyTunnelNotifyAdapters,
  options: { botUsername?: string } = {}
): Promise<{ state: ResidentSpyTunnelNotifyState; outcome: ResidentSpyTunnelNotifyOutcome }> {
  const consoleUrl = consoleUrlFromLiveUrl(liveUrl);
  const urls: ResidentSpyTunnelUrls = { liveUrl, consoleUrl, pairingDeepLink: buildBubblePairingDeepLink(liveUrl) };
  if (!shouldNotifyResidentSpyTunnel(prevState, urls)) {
    return { state: prevState ?? {}, outcome: 'skipped-unchanged' };
  }

  const topicId = await adapters.ensureTopic();
  if (topicId === undefined) {
    return { state: prevState ?? {}, outcome: 'failed-no-topic' };
  }

  const text = formatResidentSpyTunnelTopicMessage(options.botUsername);
  const buttons = buildResidentSpyTunnelTopicButtons(urls);
  const reminted = prevState?.topicId !== undefined && prevState.topicId !== topicId;
  const nextStateBase = {
    topicId,
    liveUrl,
    consoleUrl,
    formatVersion: RESIDENT_SPY_TUNNEL_NOTIFY_FORMAT_VERSION,
    renderedText: text,
  };

  if (reminted || prevState?.messageId === undefined) {
    const messageId = await adapters.postMessage(topicId, text, buttons);
    if (messageId === undefined) {
      return { state: { ...prevState, ...nextStateBase, messageId: undefined }, outcome: 'failed-post' };
    }
    return { state: { ...nextStateBase, messageId }, outcome: 'posted' };
  }

  const ok = await adapters.editMessage(topicId, prevState.messageId, text, buttons);
  if (!ok) {
    const messageId = await adapters.postMessage(topicId, text, buttons);
    if (messageId === undefined) {
      return { state: prevState, outcome: 'failed-edit' };
    }
    if (adapters.deleteMessage) {
      await adapters.deleteMessage(prevState.messageId);
    }
    return { state: { ...nextStateBase, messageId }, outcome: 'posted' };
  }
  return { state: { ...prevState, ...nextStateBase, messageId: prevState.messageId }, outcome: 'edited' };
}
