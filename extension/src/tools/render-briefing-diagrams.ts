#!/usr/bin/env node
/**
 * BL-260: renders docs/diagrams/*.mmd to PNG and prints them as JSON for
 * briefing_email_lib.bb (a Babashka script with no way to import compiled
 * TS/npm packages) to shell out to and fold into the daily briefing email
 * as inline images. Same shell-out pattern as suite-duration-line.js /
 * needs-approval-line.js: a non-zero exit (any render failure - a missing
 * dependency, an unparseable .mmd) is the daemon's signal that rendering is
 * unavailable this run and the email should still send, plaintext-only,
 * with a no-diagram note (BL-260 render-unavailable-degradation-04) - never
 * a crash, and this tool itself never decides the graceful-degrade text.
 *
 * Usage: node render-briefing-diagrams.js
 */
import * as fs from 'fs';
import * as path from 'path';
import { renderMermaidToPng } from '../diagrams/mermaidRender';
import { resolveProjectRoot, printJsonToStdout, runCliMain } from './swarm-metrics';

// The two diagrams this project maintains (local-engineering.prompt's
// Diagrams section) - not a directory scan, so a stray/experimental .mmd
// dropped under docs/diagrams/ is never silently emailed out.
const DIAGRAM_FILES = [
  { name: 'architecture', file: 'architecture.mmd' },
  { name: 'swarm-flow', file: 'swarm-flow.mmd' },
];

export interface RenderedDiagram {
  name: string;
  base64: string;
}

export async function renderBriefingDiagrams(projectRoot: string): Promise<RenderedDiagram[]> {
  const diagramsDir = path.join(projectRoot, 'docs', 'diagrams');
  const results: RenderedDiagram[] = [];
  for (const { name, file } of DIAGRAM_FILES) {
    const source = fs.readFileSync(path.join(diagramsDir, file), 'utf8');
    const png = await renderMermaidToPng(source);
    results.push({ name, base64: png.toString('base64') });
  }
  return results;
}

export async function main(): Promise<void> {
  const projectRoot = resolveProjectRoot(process.cwd());
  const diagrams = await renderBriefingDiagrams(projectRoot);
  printJsonToStdout(diagrams);
}

if (require.main === module) {
  runCliMain(main);
}
