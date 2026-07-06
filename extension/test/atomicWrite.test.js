import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { atomicWrite, atomicAppend } from '../out/util/atomicWrite.js';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-test-'));
}

test('atomicWrite creates new file with content', () => {
  const dir = createTempDir();
  const filePath = path.join(dir, 'test.txt');
  const content = 'Hello, World!';

  atomicWrite(filePath, content);

  const result = fs.readFileSync(filePath, 'utf-8');
  assert.strictEqual(result, content);
});

test('atomicWrite overwrites existing file', () => {
  const dir = createTempDir();
  const filePath = path.join(dir, 'test.txt');

  fs.writeFileSync(filePath, 'old content', 'utf-8');
  atomicWrite(filePath, 'new content');

  const result = fs.readFileSync(filePath, 'utf-8');
  assert.strictEqual(result, 'new content');
});

test('atomicWrite creates parent directories', () => {
  const dir = createTempDir();
  const filePath = path.join(dir, 'a', 'b', 'c', 'test.txt');
  const content = 'nested content';

  atomicWrite(filePath, content);

  const result = fs.readFileSync(filePath, 'utf-8');
  assert.strictEqual(result, content);
});

test('atomicAppend appends to existing file', () => {
  const dir = createTempDir();
  const filePath = path.join(dir, 'test.txt');

  atomicWrite(filePath, 'Line 1\n');
  atomicAppend(filePath, 'Line 2\n');

  const result = fs.readFileSync(filePath, 'utf-8');
  assert.strictEqual(result, 'Line 1\nLine 2\n');
});

test('atomicAppend creates file if it does not exist', () => {
  const dir = createTempDir();
  const filePath = path.join(dir, 'test.txt');
  const content = 'First line\n';

  atomicAppend(filePath, content);

  const result = fs.readFileSync(filePath, 'utf-8');
  assert.strictEqual(result, content);
});

test('atomicWrite does not leave tmp files', () => {
  const dir = createTempDir();
  const filePath = path.join(dir, 'test.txt');

  atomicWrite(filePath, 'content');

  const files = fs.readdirSync(dir);
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0], 'test.txt');
});
