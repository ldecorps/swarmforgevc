/**
 * BL-1147: read-only classification of legacy topic adoption paths on disk.
 * Never mutates maps or calls Telegram.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readBacklogTopicMap } from '../concierge/backlogTopicMapStore';
import { selectLegacyPerTicketTopics } from '../concierge/legacyTopicReconcile';
import { frontDeskTopicMapWithoutCursorBridge } from './telegramCursorBridgeCore';
import { readBubbleTopicId, readCursorBridgeTopicId, readTopicMap } from './telegram-front-desk-bot';
import { readSwarmEnvValue } from './swarmEnv';

export type CursorHostRouting = 'bridge' | 'operator-re-adopt' | 'unbound';

export interface FrontDeskBridgeBinding {
  topicId: string;
  subjectId: string;
}

export interface LegacyTopicAdoptionProbeReport {
  legacyPerTicketTopics: Array<{ backlogId: string; topicId: number }>;
  cursorHostTopicId?: number;
  bubbleTopicId?: number;
  letsTalkProvider: string;
  cursorHostRouting: CursorHostRouting;
  frontDeskBindingsOnBridgeTopics: FrontDeskBridgeBinding[];
  scrubCandidates: string[];
}

export function classifyCursorHostRouting(
  cursorTopicId: number | undefined,
  provider: string
): CursorHostRouting {
  if (cursorTopicId === undefined) {
    return 'unbound';
  }
  const normalized = provider.trim().toLowerCase();
  const cursorBridgeRoutingEnabled = normalized === '' || normalized === 'cursor';
  return cursorBridgeRoutingEnabled ? 'bridge' : 'operator-re-adopt';
}

export function computeScrubCandidates(
  topicMap: Record<string, string>,
  cursorTopicId: number | undefined,
  bubbleTopicId: number | undefined
): string[] {
  const scrubbed = frontDeskTopicMapWithoutCursorBridge(topicMap, cursorTopicId, [bubbleTopicId]);
  return Object.keys(topicMap).filter((key) => !(key in scrubbed));
}

function bridgeTopicKeySet(cursorTopicId: number | undefined, bubbleTopicId: number | undefined): Set<string> {
  return new Set(
    [cursorTopicId, bubbleTopicId]
      .filter((id): id is number => typeof id === 'number')
      .map(String)
  );
}

export function resolveLetsTalkProvider(targetPath: string): string {
  return (
    readSwarmEnvValue(targetPath, 'SWARMFORGE_LETS_TALK_PROVIDER') ||
    process.env.SWARMFORGE_LETS_TALK_PROVIDER?.trim() ||
    ''
  );
}

export function probeLegacyTopicAdoption(targetPath: string): LegacyTopicAdoptionProbeReport {
  const legacyPerTicketTopics = selectLegacyPerTicketTopics(readBacklogTopicMap(targetPath));
  const cursorHostTopicId = readCursorBridgeTopicId(targetPath);
  const bubbleTopicId = readBubbleTopicId(targetPath);
  const topicMap = readTopicMap(targetPath);
  const letsTalkProvider = resolveLetsTalkProvider(targetPath);
  const cursorHostRouting = classifyCursorHostRouting(cursorHostTopicId, letsTalkProvider);
  const bridgeKeys = bridgeTopicKeySet(cursorHostTopicId, bubbleTopicId);
  const frontDeskBindingsOnBridgeTopics = Object.entries(topicMap)
    .filter(([topicId]) => bridgeKeys.has(topicId))
    .map(([topicId, subjectId]) => ({ topicId, subjectId }));
  const scrubCandidates = computeScrubCandidates(topicMap, cursorHostTopicId, bubbleTopicId);
  return {
    legacyPerTicketTopics,
    cursorHostTopicId,
    bubbleTopicId,
    letsTalkProvider,
    cursorHostRouting,
    frontDeskBindingsOnBridgeTopics,
    scrubCandidates,
  };
}

export function formatProbeReport(report: LegacyTopicAdoptionProbeReport): string[] {
  const lines: string[] = ['legacy topic adoption probe'];
  if (report.legacyPerTicketTopics.length === 0) {
    lines.push('legacy per-ticket topics: (none)');
  } else {
    lines.push('legacy per-ticket topics:');
    for (const entry of report.legacyPerTicketTopics) {
      lines.push(`  ${entry.backlogId} -> topic ${entry.topicId}`);
    }
  }
  lines.push(
    `cursor Host topic: ${report.cursorHostTopicId ?? '(unbound)'}`,
    `bubble topic: ${report.bubbleTopicId ?? '(unbound)'}`,
    `SWARMFORGE_LETS_TALK_PROVIDER: ${report.letsTalkProvider || '(empty)'}`,
    `cursor Host routing: ${report.cursorHostRouting}`
  );
  if (report.frontDeskBindingsOnBridgeTopics.length === 0) {
    lines.push('front-desk bindings on bridge topics: (none)');
  } else {
    lines.push('front-desk bindings on bridge topics:');
    for (const binding of report.frontDeskBindingsOnBridgeTopics) {
      lines.push(`  topic ${binding.topicId} -> ${binding.subjectId}`);
    }
  }
  if (report.scrubCandidates.length === 0) {
    lines.push('scrub candidates: (none)');
  } else {
    lines.push(`scrub candidates: ${report.scrubCandidates.join(', ')}`);
  }
  return lines;
}

export function assertReadableTargetPath(targetPath: string): void {
  if (!targetPath.trim()) {
    throw new Error('target path is required');
  }
  let stat;
  try {
    stat = fs.statSync(path.resolve(targetPath));
  } catch {
    throw new Error(`target path is not readable: ${targetPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`target path is not a directory: ${targetPath}`);
  }
}
