'use strict';

// BL-1402: unit tests for the live photo-persistence mechanism
// (telegram-front-desk-bot.ts::persistRoutedPhoto) - the real store, prune,
// and idempotency logic against a real temp directory, with Telegram's own
// two-step getFile -> GET faked out via injectable deps (the same
// DownloadTelegramPhotoDeps convention cursorBridgeTelegramMedia.ts already
// uses for the bridge's own photo path) so no test touches the network.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { persistRoutedPhoto, ROUTED_PHOTO_STORE_BOUND } = require('../out/tools/telegram-front-desk-bot');

const MEDIA_DIR = ['.swarmforge', 'operator', 'media'];

function mediaDir(root) {
  return path.join(root, ...MEDIA_DIR);
}

function mkPhotoUpdate(updateId, fileId = 'photo-1') {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      chat: { id: 1 },
      from: { id: 111 },
      message_thread_id: 7,
      photo: [{ file_id: fileId, width: 90, height: 60 }],
      caption: 'a caption',
    },
  };
}

function mkTextUpdate(updateId) {
  return {
    update_id: updateId,
    message: { message_id: updateId, chat: { id: 1 }, from: { id: 111 }, message_thread_id: 7, text: 'no photo here' },
  };
}

function fakeDeps({ getFile, download } = {}) {
  const calls = { getFile: 0, download: 0 };
  return {
    calls,
    deps: {
      getFileFn: async (...args) => {
        calls.getFile += 1;
        return getFile ? getFile(...args) : { success: true, filePath: 'photos/file.jpg' };
      },
      downloadFn: async (...args) => {
        calls.download += 1;
        return download ? download(...args) : { success: true, bytes: Buffer.from('bytes') };
      },
    },
  };
}

test('BL-1402: a fresh captioned photo is saved under the media store, named by update id', async () => {
  const root = mkTmpDir('bl1402-save-');
  const { deps } = fakeDeps({ getFile: async () => ({ success: true, filePath: 'photos/file.jpg' }) });
  const outcome = await persistRoutedPhoto('token', root, mkPhotoUpdate(101), deps);
  assert.equal(outcome.kind, 'saved');
  assert.equal(outcome.path, path.posix.join(...MEDIA_DIR, '101.jpg'));
  const bytes = fs.readFileSync(path.join(root, outcome.path));
  assert.equal(bytes.toString(), 'bytes');
});

test('BL-1402: not-applicable for a message with no photo - no network call at all', async () => {
  const root = mkTmpDir('bl1402-noop-');
  const { deps, calls } = fakeDeps();
  const outcome = await persistRoutedPhoto('token', root, mkTextUpdate(102), deps);
  assert.deepEqual(outcome, { kind: 'not-applicable' });
  assert.equal(calls.getFile, 0);
  assert.equal(calls.download, 0);
});

test('BL-1402: extension is derived from the resolved file_path for each known Telegram photo type', async () => {
  const root = mkTmpDir('bl1402-ext-');
  const cases = [
    ['photos/file.png', 'png'],
    ['photos/file.webp', 'webp'],
    ['photos/file.gif', 'gif'],
    ['photos/file.jpg', 'jpg'],
    ['photos/file.unknown', 'jpg'],
  ];
  let updateId = 200;
  for (const [filePath, ext] of cases) {
    const { deps } = fakeDeps({ getFile: async () => ({ success: true, filePath }) });
    const outcome = await persistRoutedPhoto('token', root, mkPhotoUpdate(updateId), deps);
    assert.equal(outcome.kind, 'saved');
    assert.equal(outcome.path, path.posix.join(...MEDIA_DIR, `${updateId}.${ext}`), `filePath ${filePath} should map to .${ext}`);
    updateId += 1;
  }
});

test('BL-1402 invariant 3: a redelivered update never writes a second file, and never re-fetches', async () => {
  const root = mkTmpDir('bl1402-idempotent-');
  const { deps, calls } = fakeDeps();
  const first = await persistRoutedPhoto('token', root, mkPhotoUpdate(301), deps);
  assert.equal(first.kind, 'saved');
  assert.equal(calls.getFile, 1);
  assert.equal(calls.download, 1);

  const second = await persistRoutedPhoto('token', root, mkPhotoUpdate(301), deps);
  assert.equal(second.kind, 'already-saved');
  assert.equal(second.path, first.path);
  // Redelivery costs a readdir, never a re-fetch or re-write.
  assert.equal(calls.getFile, 1, 'getFile must not be called again for a redelivered update');
  assert.equal(calls.download, 1, 'download must not be called again for a redelivered update');
  assert.deepEqual(fs.readdirSync(mediaDir(root)), ['301.jpg']);
});

test('BL-1402 invariant 1: a getFile failure never writes a file and reports the reason', async () => {
  const root = mkTmpDir('bl1402-getfile-fail-');
  const { deps } = fakeDeps({ getFile: async () => ({ success: false, error: 'boom-getfile' }) });
  const outcome = await persistRoutedPhoto('token', root, mkPhotoUpdate(401), deps);
  assert.equal(outcome.kind, 'failed');
  assert.match(outcome.reason, /boom-getfile/);
  assert.equal(fs.existsSync(mediaDir(root)), false, 'no media dir should be created on failure');
});

test('BL-1402 invariant 1: a download failure never writes a file and reports the reason', async () => {
  const root = mkTmpDir('bl1402-download-fail-');
  const { deps } = fakeDeps({ download: async () => ({ success: false, error: 'boom-download' }) });
  const outcome = await persistRoutedPhoto('token', root, mkPhotoUpdate(402), deps);
  assert.equal(outcome.kind, 'failed');
  assert.match(outcome.reason, /boom-download/);
  assert.equal(fs.existsSync(mediaDir(root)), false);
});

test('BL-1402 invariant 1: a photo exceeding the size cap never writes a file and names the cap in the reason', async () => {
  const root = mkTmpDir('bl1402-size-cap-');
  const MAX = 8 * 1024 * 1024;
  const { deps } = fakeDeps({ download: async () => ({ success: true, bytes: Buffer.alloc(MAX + 1) }) });
  const outcome = await persistRoutedPhoto('token', root, mkPhotoUpdate(403), deps);
  assert.equal(outcome.kind, 'failed');
  assert.match(outcome.reason, /exceeds/);
  assert.equal(fs.existsSync(mediaDir(root)), false);
});

test('BL-1402 invariant 2: the media store keeps its newest ROUTED_PHOTO_STORE_BOUND files, oldest out first', async () => {
  const root = mkTmpDir('bl1402-bound-');
  fs.mkdirSync(mediaDir(root), { recursive: true });
  // Seed the store already at its bound, with strictly increasing mtimes so
  // "oldest" is unambiguous.
  for (let i = 0; i < ROUTED_PHOTO_STORE_BOUND; i++) {
    const p = path.join(mediaDir(root), `${1000 + i}.jpg`);
    fs.writeFileSync(p, 'old');
    const t = new Date(Date.now() - (ROUTED_PHOTO_STORE_BOUND - i) * 1000);
    fs.utimesSync(p, t, t);
  }
  const { deps } = fakeDeps();
  const outcome = await persistRoutedPhoto('token', root, mkPhotoUpdate(9999), deps);
  assert.equal(outcome.kind, 'saved');
  const names = fs.readdirSync(mediaDir(root));
  assert.equal(names.length, ROUTED_PHOTO_STORE_BOUND, `store must hold exactly its bound of files, got ${names.length}`);
  assert.equal(names.includes('1000.jpg'), false, 'the oldest file must be gone');
  assert.equal(names.includes('9999.jpg'), true, 'the new file must be present');
});

test('BL-1402: pruning below the bound is a no-op - a store under its bound is left untouched', async () => {
  const root = mkTmpDir('bl1402-under-bound-');
  fs.mkdirSync(mediaDir(root), { recursive: true });
  fs.writeFileSync(path.join(mediaDir(root), '1.jpg'), 'existing');
  const { deps } = fakeDeps();
  await persistRoutedPhoto('token', root, mkPhotoUpdate(2), deps);
  assert.deepEqual(fs.readdirSync(mediaDir(root)).sort(), ['1.jpg', '2.jpg']);
});
