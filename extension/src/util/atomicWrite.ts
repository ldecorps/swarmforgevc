import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/** Atomically write content to a file via temp-file + rename. */
export function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

/** Append content to a file using O_APPEND — safe for concurrent writers. */
export function atomicAppend(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, content, { encoding: 'utf8', flag: 'a' });
}
