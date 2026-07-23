import { ApprovalDecisionVerdict, approvalAskTextShowsDecidedVerdict } from './approvalAskClosing';

export interface RecordedApprovalAskForClose {
  topicId: number;
  messageId: number;
  text: string;
}

export const DECIDED_ASK_CLOSE_GAP_MS = 150;

export function decidedApprovalAsksNeedingClose(
  recordedAsks: Readonly<Record<string, RecordedApprovalAskForClose>>,
  verdictFor: (backlogId: string) => ApprovalDecisionVerdict | undefined
): string[] {
  return Object.keys(recordedAsks)
    .filter((backlogId) => {
      const ask = recordedAsks[backlogId];
      if (!ask || approvalAskTextShowsDecidedVerdict(ask.text)) {
        return false;
      }
      return verdictFor(backlogId) !== undefined;
    })
    .sort((a, b) => a.localeCompare(b));
}

export interface DecideApprovalAskCloseAdapters {
  readApprovalAskMessages: () => Readonly<Record<string, RecordedApprovalAskForClose>>;
  readCloseVerdict: (backlogId: string) => ApprovalDecisionVerdict | undefined;
  closeApprovalAsk: (backlogId: string, verdict: ApprovalDecisionVerdict, nowMs: number) => Promise<void>;
  waitBetweenCloses?: (ms: number) => Promise<void>;
}

export async function reconcileDecidedApprovalAskCloses(
  adapters: DecideApprovalAskCloseAdapters,
  nowMs: number
): Promise<void> {
  const wait = adapters.waitBetweenCloses ?? (async () => undefined);
  const recorded = adapters.readApprovalAskMessages();
  const needing = decidedApprovalAsksNeedingClose(recorded, adapters.readCloseVerdict);
  for (let i = 0; i < needing.length; i += 1) {
    const backlogId = needing[i];
    const verdict = adapters.readCloseVerdict(backlogId);
    if (verdict) {
      await adapters.closeApprovalAsk(backlogId, verdict, nowMs);
      if (i + 1 < needing.length) {
        await wait(DECIDED_ASK_CLOSE_GAP_MS);
      }
    }
  }
}
