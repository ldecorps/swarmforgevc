import { createMessage, readLog } from './messageBus';

/**
 * Log a human instruction directed at role into the message store.
 * Returns the message id.
 */
export function logHumanInput(dir: string, role: string, text: string, seq: number): string {
  return createMessage(dir, {
    from: 'human',
    to: role,
    subject: 'human-input',
    body: text,
    seq,
  });
}

/**
 * Returns true if the first event in logPath is a human-input message.
 * The chase monitor uses this to skip human-input messages.
 */
export function isHumanInputMessage(logPath: string): boolean {
  const events = readLog(logPath);
  if (events.length === 0) return false;
  const first = events[0];
  return first.from === 'human' && first.subject === 'human-input';
}
