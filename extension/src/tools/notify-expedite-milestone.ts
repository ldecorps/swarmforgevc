#!/usr/bin/env node
/**
 * BL-656: post one expedite milestone line to BL-346's standing Operator topic.
 *
 * Usage: node notify-expedite-milestone.js <project-root>
 * Env: EXPEDITE_ANNOUNCE_LINE (text)
 */
import { sendOperatorTopicMessage } from './notify-dead-letters';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';

export async function main(): Promise<void> {
  const line = process.env.EXPEDITE_ANNOUNCE_LINE;
  if (!line) {
    process.stderr.write('notify-expedite-milestone: EXPEDITE_ANNOUNCE_LINE unset\n');
    process.exit(1);
    return;
  }
  const argvRoot = process.argv[2];
  const projectRoot = argvRoot ?? resolveCliMainWorktreeContext().projectRoot;
  const result = await sendOperatorTopicMessage(projectRoot, line);
  printJsonToStdout({ sent: result.success, error: result.error });
  if (!result.success) {
    process.exit(1);
  }
}

if (require.main === module) {
  runCliMain(main);
}
