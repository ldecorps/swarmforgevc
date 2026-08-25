const assert = require('node:assert/strict');
const {
  TELEGRAM_PHOTO_DEFAULT_PROMPT,
  buildPhotoPromptText,
  downloadTelegramPhotoAsSdkImage,
  largestTelegramPhotoFileId,
  mimeTypeFromTelegramFilePath,
} = require('../out/bridge/cursorBridgeTelegramMedia');

test('largestTelegramPhotoFileId picks the highest-resolution size', () => {
  const photos = [
    { file_id: 'small', width: 90, height: 90 },
    { file_id: 'large', width: 1280, height: 720 },
    { file_id: 'medium', width: 320, height: 240 },
  ];
  assert.equal(largestTelegramPhotoFileId(photos), 'large');
  assert.equal(largestTelegramPhotoFileId(undefined), undefined);
});

test('buildPhotoPromptText uses caption or default photo prompt', () => {
  assert.equal(buildPhotoPromptText(''), TELEGRAM_PHOTO_DEFAULT_PROMPT);
  assert.equal(buildPhotoPromptText('  what is this?  '), 'what is this?');
});

test('mimeTypeFromTelegramFilePath maps common Telegram file extensions', () => {
  assert.equal(mimeTypeFromTelegramFilePath('photos/file_1.jpg'), 'image/jpeg');
  assert.equal(mimeTypeFromTelegramFilePath('photos/file_2.png'), 'image/png');
  assert.equal(mimeTypeFromTelegramFilePath('photos/file_3.webp'), 'image/webp');
});

test('downloadTelegramPhotoAsSdkImage resolves file bytes into base64 SDK image', async () => {
  const image = await downloadTelegramPhotoAsSdkImage(
    'tok',
    'file-abc',
    {
      getFileFn: async () => ({ success: true, filePath: 'photos/file_1.jpg' }),
      downloadFn: async () => ({ success: true, bytes: Buffer.from('jpeg-bytes') }),
    }
  );
  assert.deepEqual(image, {
    data: Buffer.from('jpeg-bytes').toString('base64'),
    mimeType: 'image/jpeg',
  });
});

test('downloadTelegramPhotoAsSdkImage rejects oversized downloads', async () => {
  const huge = Buffer.alloc(8 * 1024 * 1024 + 1);
  await assert.rejects(
    () =>
      downloadTelegramPhotoAsSdkImage('tok', 'file-abc', {
        getFileFn: async () => ({ success: true, filePath: 'photos/file_1.jpg' }),
        downloadFn: async () => ({ success: true, bytes: huge }),
      }),
    /too large/
  );
});
