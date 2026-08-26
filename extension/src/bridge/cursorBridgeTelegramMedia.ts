// BL-696: Telegram photo download for the Cursor Remote bridge.

import type { SDKImage } from '@cursor/sdk';
import { downloadTelegramFile, getFile } from '../notify/telegramClient';

export const TELEGRAM_PHOTO_DEFAULT_PROMPT =
  'The user sent a photo from Telegram. Describe what you see and respond helpfully.';

export const MAX_TELEGRAM_PHOTO_BYTES = 8 * 1024 * 1024;

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

export function largestTelegramPhotoFileId(photos: TelegramPhotoSize[] | undefined): string | undefined {
  if (!photos || photos.length === 0) {
    return undefined;
  }
  let best = photos[0];
  for (const photo of photos.slice(1)) {
    if (photo.width * photo.height > best.width * best.height) {
      best = photo;
    }
  }
  return best.file_id;
}

export function mimeTypeFromTelegramFilePath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  return 'image/jpeg';
}

export function buildPhotoPromptText(caption: string | undefined): string {
  const trimmed = caption?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : TELEGRAM_PHOTO_DEFAULT_PROMPT;
}

export interface DownloadTelegramPhotoDeps {
  getFileFn?: typeof getFile;
  downloadFn?: typeof downloadTelegramFile;
}

export async function downloadTelegramPhotoAsSdkImage(
  botToken: string,
  fileId: string,
  deps: DownloadTelegramPhotoDeps = {}
): Promise<SDKImage> {
  const getFileFn = deps.getFileFn ?? getFile;
  const downloadFn = deps.downloadFn ?? downloadTelegramFile;
  const fileResult = await getFileFn(botToken, fileId);
  if (!fileResult.success || !fileResult.filePath) {
    throw new Error(fileResult.error ?? 'getFile failed');
  }
  const download = await downloadFn(botToken, fileResult.filePath);
  if (!download.success || !download.bytes) {
    throw new Error(download.error ?? 'downloadTelegramFile failed');
  }
  if (download.bytes.length > MAX_TELEGRAM_PHOTO_BYTES) {
    throw new Error(`Photo is too large (${download.bytes.length} bytes, max ${MAX_TELEGRAM_PHOTO_BYTES}).`);
  }
  return {
    data: download.bytes.toString('base64'),
    mimeType: mimeTypeFromTelegramFilePath(fileResult.filePath),
  };
}
