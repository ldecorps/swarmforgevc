// BL-831: Bubble's Pipeline page — the in-flight agent x ticket grid as a
// remote HTML page, with a blurb per ticket on the main view and a
// tap-through detail sheet carrying the spec and its Gherkin.
//
// Invariant 1: every cell/mark/stage placement comes from
// pipelineGridLive.ts's own computeLivePipelineBoard - the SAME
// ticketMeta/roleHeld build and computePipelineBoard call
// capturePipelineGridLive (the Mini App board) already drives. This module
// derives no stage placement of its own, only reshapes those rows into
// JSON and attaches the blurb (pipelineGridLive.ts's own `blurb`,
// required_wiring anchor).

import * as fs from 'fs';
import * as path from 'path';
import { readBacklogFolders } from '../panel/backlogReader';
import { computeLivePipelineBoard, blurb } from './pipelineGridLive';
import { PIPELINE_BOARD_COLUMN_ORDER } from '../concierge/pipelineBoard';

export interface BubblePipelineGridEntry {
  id: string;
  title: string;
  column: string;
  blurb: string;
}

export interface BubblePipelineBoardState {
  // BL-831: the fixed stage-column order the grid marks against - the SAME
  // PIPELINE_BOARD_COLUMN_ORDER the existing Pipeline board renders its own
  // matrix from (invariant 1: no second read model / no invented column
  // set), served here so the page can render a real agent x ticket matrix
  // rather than a flat list.
  columns: readonly string[];
  inFlight: BubblePipelineGridEntry[];
}

export interface BubblePipelineDetailSheet {
  id: string;
  title: string;
  description?: string;
  invariants?: string[];
  outOfScope?: string;
  scenarios: string[];
  scenariosNote?: string;
}

export function captureBubblePipelineBoard(targetPath: string): BubblePipelineBoardState {
  const { data, byId } = computeLivePipelineBoard(targetPath);
  const inFlight = data.rows.map((row) => {
    const item = byId[row.id];
    return {
      id: row.id,
      title: row.title ?? row.id,
      column: row.column,
      blurb: item ? blurb(item) : (row.title ?? row.id),
    };
  });
  return { columns: PIPELINE_BOARD_COLUMN_ORDER, inFlight };
}

function parseFeatureScenarioTitles(featureText: string): string[] {
  return featureText
    .split('\n')
    .filter((line) => /^\s*(Scenario|Scenario Outline):/.test(line))
    .map((line) => line.replace(/^\s*(Scenario|Scenario Outline):\s*/, '').trim());
}

/**
 * BL-831 pipeline-page-detail-sheet-04/05: the ticket's own substance as
 * readable sections plus the feature file's scenario titles when
 * `acceptance:` names one that exists - never a raw YAML dump, and a
 * missing feature file still opens the sheet.
 */
export function captureBubblePipelineDetail(targetPath: string, ticketId: string): BubblePipelineDetailSheet | null {
  const folders = readBacklogFolders(targetPath);
  const item = [...folders.active, ...folders.paused].find((entry) => entry.id === ticketId);
  if (!item) {
    return null;
  }
  const sheet: BubblePipelineDetailSheet = {
    id: item.id,
    title: item.title,
    description: item.description,
    invariants: item.invariants,
    outOfScope: item.outOfScope,
    scenarios: [],
  };
  const featurePath = item.acceptance && item.acceptance.endsWith('.feature')
    ? path.join(targetPath, item.acceptance)
    : undefined;
  if (featurePath && fs.existsSync(featurePath)) {
    const featureText = fs.readFileSync(featurePath, 'utf8');
    sheet.scenarios = parseFeatureScenarioTitles(featureText);
  } else {
    sheet.scenariosNote = 'No acceptance scenarios are recorded for this ticket.';
  }
  return sheet;
}
