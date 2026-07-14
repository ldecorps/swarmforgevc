import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { forEachLiveTicketFile, LIVE_BACKLOG_FOLDERS } from '../out/util/liveTicketFiles.js';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'live-ticket-files-'));
}

function writeTicket(dir, fileName, content = 'id: X\n') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

test('LIVE_BACKLOG_FOLDERS is exactly active and paused, never done', () => {
  assert.deepEqual(LIVE_BACKLOG_FOLDERS, ['active', 'paused']);
});

test('visits every .yaml file across both live folders, in folder order', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-1.yaml');
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-2.yaml');

  const visited = [];
  forEachLiveTicketFile(targetPath, (filePath) => visited.push(filePath));

  assert.deepEqual(visited, [
    path.join(targetPath, 'backlog', 'active', 'BL-1.yaml'),
    path.join(targetPath, 'backlog', 'paused', 'BL-2.yaml'),
  ]);
});

test('never visits backlog/done', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'done'), 'BL-3.yaml');

  const visited = [];
  forEachLiveTicketFile(targetPath, (filePath) => visited.push(filePath));

  assert.deepEqual(visited, []);
});

test('ignores non-.yaml files in a live folder', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-1.yaml');
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'README.md');

  const visited = [];
  forEachLiveTicketFile(targetPath, (filePath) => visited.push(filePath));

  assert.deepEqual(visited, [path.join(targetPath, 'backlog', 'active', 'BL-1.yaml')]);
});

test('a missing live folder is tolerated, never a crash', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-2.yaml');

  const visited = [];
  assert.doesNotThrow(() => forEachLiveTicketFile(targetPath, (filePath) => visited.push(filePath)));
  assert.deepEqual(visited, [path.join(targetPath, 'backlog', 'paused', 'BL-2.yaml')]);
});

test('visit returning "stop" ends the walk immediately - a later file is never visited', () => {
  const targetPath = mkTmp();
  writeTicket(path.join(targetPath, 'backlog', 'active'), 'BL-1.yaml');
  writeTicket(path.join(targetPath, 'backlog', 'paused'), 'BL-2.yaml');

  const visited = [];
  forEachLiveTicketFile(targetPath, (filePath) => {
    visited.push(filePath);
    return 'stop';
  });

  assert.deepEqual(visited, [path.join(targetPath, 'backlog', 'active', 'BL-1.yaml')]);
});
