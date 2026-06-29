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

/** Atomically append content to a file (read current + append + write). */
export function atomicAppend(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const appended = existing + content;
  atomicWrite(filePath, appended);
}
