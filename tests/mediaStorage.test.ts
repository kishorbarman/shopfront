import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import { downloadMedia, storeImage } from '../src/services/mediaStorage';

async function removeDirIfExists(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

test('storeImage resizes, converts to webp, and creates thumbnail', async () => {
  const shopId = `shop-${Date.now()}`;
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', shopId);

  const input = await sharp({
    create: {
      width: 1600,
      height: 900,
      channels: 3,
      background: { r: 220, g: 130, b: 90 },
    },
  })
    .png()
    .toBuffer();

  const stored = await storeImage(shopId, input, 'hero.png');

  assert.match(stored.url, /\.webp$/);
  assert.match(stored.thumbnailUrl, /-thumb\.webp$/);

  const outputPath = path.join(process.cwd(), stored.url.replace(/^\//, ''));
  const thumbPath = path.join(process.cwd(), stored.thumbnailUrl.replace(/^\//, ''));

  const outputMeta = await sharp(outputPath).metadata();
  const thumbMeta = await sharp(thumbPath).metadata();

  assert.equal(outputMeta.format, 'webp');
  assert.equal(thumbMeta.format, 'webp');
  assert.ok((outputMeta.width ?? 0) <= 1200);
  assert.ok((thumbMeta.width ?? 0) <= 400);
  assert.equal(outputMeta.exif, undefined);
  assert.equal(thumbMeta.exif, undefined);

  await removeDirIfExists(uploadDir);
});

test('downloadMedia supports file:// and validates image format', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shopfront-media-'));
  const imagePath = path.join(tempDir, 'sample.jpg');
  const badPath = path.join(tempDir, 'sample.txt');

  await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .jpeg()
    .toFile(imagePath);

  await fs.writeFile(badPath, 'not-an-image', 'utf8');

  const ok = await downloadMedia(`file://${imagePath}`);
  assert.ok(ok.length > 0);

  await assert.rejects(downloadMedia(`file://${badPath}`), /Unsupported image format/i);

  await removeDirIfExists(tempDir);
});
