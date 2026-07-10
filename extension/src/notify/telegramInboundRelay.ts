// BL-239: the ONLY inbound surface this adapter exposes - a human's Telegram
// reply to a specific, previously-posted gate-prompt message is relayed as a
// gate answer (via BL-240's answerCapturedGate write path, wired in by the
// caller). Deliberately narrow, matching the operator's BL-240 remote scope:
// there is no command parser here at all. A message is honored ONLY when it
// is (a) from the one pre-authorized chat ("bot auth of the human" - any
// other chat is a stranger, not a spoofed operator) AND (b) a reply to a
// message id this relay itself recorded as a pending gate prompt. Anything
// else - a bare "/stop", "/respawn coder", an unprompted message, a reply to
// some unrelated message - falls through unhandled: not because of a deny-
// list of forbidden commands, but because there is no code path that could
// ever execute one. This module never imports anything from the handoff/
// mailbox machinery - it only ever calls the single injected answerGate
// adapter, which is how "never an agent-to-agent coordination channel" is
// enforced structurally, not just by convention.
import { TelegramUpdate } from './telegramClient';

export interface GateAnswerOutcome {
  success: boolean;
  reason?: string;
}

export interface TelegramInboundRelayAdapters {
  answerGate: (role: string, answer: string) => GateAnswerOutcome;
  onRelayed?: (role: string, answer: string, result: GateAnswerOutcome) => void;
  onRejected?: (reason: string, update: TelegramUpdate) => void;
}

export class TelegramInboundRelay {
  private pendingGatesByMessageId = new Map<number, string>();

  constructor(
    private authorizedChatId: string,
    private adapters: TelegramInboundRelayAdapters
  ) {}

  // Called by the narrator-wiring composition once a 'gate' narration event
  // has actually been posted (see TelegramNarrator's onSendResult) - this is
  // how the relay learns WHICH role a reply to a given message should
  // answer, without importing the narrator or vice versa.
  recordGatePrompt(messageId: number, role: string): void {
    this.pendingGatesByMessageId.set(messageId, role);
  }

  handleUpdate(update: TelegramUpdate): void {
    const message = update.message;
    if (!message || typeof message.text !== 'string') {
      // Non-text updates (edits, reactions, other update types) carry no
      // answer text - never treated as a gate reply.
      return;
    }
    if (String(message.chat.id) !== this.authorizedChatId) {
      this.adapters.onRejected?.('message from an unauthorized chat', update);
      return;
    }
    const replyToId = message.reply_to_message?.message_id;
    if (replyToId === undefined) {
      this.adapters.onRejected?.(
        'not a reply to a gate prompt - inbound is answer-only, no other commands are honored',
        update
      );
      return;
    }
    const role = this.pendingGatesByMessageId.get(replyToId);
    if (!role) {
      this.adapters.onRejected?.('reply does not target a currently pending gate prompt', update);
      return;
    }

    const result = this.adapters.answerGate(role, message.text);
    if (result.success) {
      this.pendingGatesByMessageId.delete(replyToId);
    }
    this.adapters.onRelayed?.(role, message.text, result);
  }
}

// Pure: the next offset to pass to getTelegramUpdates so an already-
// delivered update is never redelivered (Telegram's own "offset" contract -
// the highest update_id seen so far, plus one).
export function nextUpdateOffset(updates: TelegramUpdate[], currentOffset: number): number {
  return updates.reduce((max, u) => Math.max(max, u.update_id + 1), currentOffset);
}
