import { sendResendEmail, EmailMessage, SendEmailResult } from './resendClient';
import { buildEmailSubject, buildEmailBody, TicketBadge } from './emailContent';

// Persistent + cooldown trigger (BL-073): only email once a role's
// needs-human state has held for `graceSeconds`, and at most once per
// `cooldownSeconds` per role, so a quickly-answered question or a chatty
// agent never floods the human's inbox.
export interface EmailNotifyConfig {
  enabled: boolean;
  graceSeconds: number;
  cooldownSeconds: number;
  to: string;
  from: string;
}

export type NotifyDecision = 'send' | 'wait' | 'cooldown' | 'skip';

export function decideNotifyAction(
  needsHumanSinceMs: number | null,
  lastEmailSentMs: number | null,
  nowMs: number,
  config: Pick<EmailNotifyConfig, 'graceSeconds' | 'cooldownSeconds'>
): NotifyDecision {
  if (needsHumanSinceMs === null) {
    return 'skip';
  }
  const graceElapsedSeconds = (nowMs - needsHumanSinceMs) / 1000;
  if (graceElapsedSeconds < config.graceSeconds) {
    return 'wait';
  }
  if (lastEmailSentMs !== null) {
    const cooldownElapsedSeconds = (nowMs - lastEmailSentMs) / 1000;
    if (cooldownElapsedSeconds < config.cooldownSeconds) {
      return 'cooldown';
    }
  }
  return 'send';
}

export interface NeedsHumanUpdate {
  role: string;
  needsHuman: boolean;
  snippet?: string;
}

export interface EmailNotifierAdapters {
  getSessionUrl: (role: string) => string | null;
  getTicketBadge: (role: string) => TicketBadge | null;
  sendEmail: (message: EmailMessage) => Promise<SendEmailResult>;
  onSendResult?: (role: string, result: SendEmailResult) => void;
}

export class NeedsHumanEmailNotifier {
  private since = new Map<string, number>();
  private lastSent = new Map<string, number>();
  private snippet = new Map<string, string>();

  constructor(
    private config: EmailNotifyConfig,
    private adapters: EmailNotifierAdapters
  ) {}

  // Edge-triggered updates from the existing needs-human detector (BL-045):
  // a role entering needs-human starts its grace clock; leaving it (answered)
  // before the sweep fires cancels the pending email outright.
  recordUpdates(updates: NeedsHumanUpdate[], nowMs: number): void {
    for (const update of updates) {
      if (update.needsHuman) {
        if (!this.since.has(update.role)) {
          this.since.set(update.role, nowMs);
        }
        if (update.snippet) {
          this.snippet.set(update.role, update.snippet);
        }
      } else {
        this.since.delete(update.role);
      }
    }
  }

  sweep(nowMs: number): void {
    if (!this.config.enabled) {
      return;
    }
    for (const [role, sinceMs] of this.since.entries()) {
      const lastSentMs = this.lastSent.get(role) ?? null;
      const action = decideNotifyAction(sinceMs, lastSentMs, nowMs, this.config);
      if (action !== 'send') {
        continue;
      }
      // Record the cooldown before the request settles: a failed or slow
      // Resend call must never turn into a retry storm (BL-073 failure
      // tolerance).
      this.lastSent.set(role, nowMs);

      const message: EmailMessage = {
        to: this.config.to,
        from: this.config.from,
        subject: buildEmailSubject(role),
        text: buildEmailBody({
          role,
          snippet: this.snippet.get(role) ?? '',
          sessionUrl: this.adapters.getSessionUrl(role),
          ticketBadge: this.adapters.getTicketBadge(role),
        }),
      };

      this.adapters
        .sendEmail(message)
        .then((result) => this.adapters.onSendResult?.(role, result))
        .catch((err) => {
          const detail = err instanceof Error ? err.message : 'unknown error';
          this.adapters.onSendResult?.(role, { success: false, error: detail });
        });
    }
  }
}
