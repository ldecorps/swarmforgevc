// BL-1351: what the /events stream carries.
//
// buildBridgeState embeds readBacklogFolders whole - active, paused, hold AND
// done - and every item carries its full description, notes, acceptance and
// approval_context prose. Measured on 2026-09-02, one connect frame was
// 6764293 bytes for 1259 tickets, roughly 1200 of them long closed; and
// broadcastSnapshotIfChanged re-sends that entire frame to every SSE client on
// ANY backlog change, so each commit touching backlog/ costs it again per
// client.
//
// The human's ruling (option 1) is to keep every folder on the stream and
// carry only the per-item fields consumers actually read. This module is that
// projection, and the ONE producer of the stream's snapshot string, so the
// connect frame and the poll loop's rebroadcast cannot drift apart (invariant
// 2 - a client can never observe a field only one of the two producers emits).
//
// THE CONSUMER SWEEP (invariant 1: exhaustive, never sampled). Everything that
// reads an /events frame, and what each takes from it:
//
//   - bridge/holisticUiHtml.ts - the only consumer of the state frame. It
//     renders `state.backlog.active` as `item.id + ' - ' + item.title`, joins
//     assignments by `item.id`, and otherwise uses `state.pipeline`,
//     `state.agents` and `state.runLog`. It reads no other per-item field, and
//     no other folder, off the stream: `doneByMilestone` and `assignments`
//     come from /holistic, which is unchanged.
//   - bridge/bubbleHostUiHtml.ts - subscribes to /events but processes ONLY
//     blocks carrying `event: host-activity`; it skips every other block, the
//     state frame included.
//   - tools/telegram-front-desk-bot.ts + tools/telegramFrontDeskBotCore.ts
//     (the reply relay) - reads only records whose event is `telegram-reply`.
//     Its backlog data (notes, approvalContext, rulingOptions,
//     firstAcceptanceStep, remainingSlices, description) comes from
//     readBacklogFolders on DISK via toFoldersSnapshot, never from a frame -
//     so narrowing the stream cannot starve it.
//   - extension/test/bridgeServer.test.js and
//     specs/pipeline/steps/bl1350IdleEventStreamKeepaliveSteps.js - read frame
//     framing (snapshot presence, keepalive comments), not item fields.
//
// So the union of per-item fields read from the stream is {id, title}, which
// is what STREAM_BACKLOG_ITEM_FIELDS holds. Adding a field back is a one-line
// change here; dropping one requires redoing the sweep above.
//
// SCOPE, decided rather than left as a side effect: the projection is applied
// at the STREAM producers only. buildBridgeState is also the source for the
// JSON /state routes (/pipeline, /agents, /backlog, /runlog), and /backlog is
// what the holistic UI's own first render reads; narrowing at that level would
// silently narrow those routes too, which the ticket explicitly refuses to let
// happen as a side effect. The architect pass owns the ruling on whether the
// routes should follow; until then the routes keep their full fidelity.
import { BridgeState, buildBridgeState } from './bridgeState';

// The per-item fields the sweep above found read on the stream. Order is
// irrelevant; membership is the contract.
export const STREAM_BACKLOG_ITEM_FIELDS = ['id', 'title'] as const;

export type StreamBacklogItem = { id: string; title: string };

export interface StreamBridgeState {
  pipeline: BridgeState['pipeline'];
  agents: BridgeState['agents'];
  runLog: BridgeState['runLog'];
  backlog: Record<string, StreamBacklogItem[]>;
}

export function projectBacklogItemForStream(item: { id: string; title: string }): StreamBacklogItem {
  return { id: item.id, title: item.title };
}

// Every folder the reader returned is kept (option 1 narrows items, never
// folders), and a folder it did not return is not invented. The result is a
// fresh object graph: the state the JSON routes serve is never narrowed
// underneath them by this call.
export function projectBridgeStateForStream(state: BridgeState): StreamBridgeState {
  const backlog: Record<string, StreamBacklogItem[]> = {};
  for (const [folder, items] of Object.entries(state.backlog as unknown as Record<string, { id: string; title: string }[]>)) {
    backlog[folder] = (items ?? []).map(projectBacklogItemForStream);
  }
  return { pipeline: state.pipeline, agents: state.agents, runLog: state.runLog, backlog };
}

// The ONE place an /events snapshot string is produced. Both the connect
// snapshot and the poll loop's rebroadcast go through here, so invariant 2
// holds by construction rather than by two call sites agreeing.
export function buildStreamSnapshot(targetPath: string, runLogPath: string): string {
  return JSON.stringify(projectBridgeStateForStream(buildBridgeState(targetPath, runLogPath)));
}
