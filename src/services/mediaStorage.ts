import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp']);

type StoredImage = {
  url: string;
  thumbnailUrl: string;
};

type GalleryEntry = StoredImage & {
  createdAt: string;
};

function sanitizeBaseName(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  const cleaned = withoutExt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return cleaned || 'image';
}

function publicRootDir(): string {
  return path.join(process.cwd(), 'public');
}

function toPublicUrl(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) {
    return `/${normalized}`;
  }

  return `${base.replace(/\/$/, '')}/${normalized}`;
}

function isAllowedImageFormat(format?: string): boolean {
  if (!format) return false;
  return ALLOWED_FORMATS.has(format.toLowerCase());
}

async function validateImageBuffer(imageBuffer: Buffer): Promise<void> {
  if (imageBuffer.length === 0) {
    throw new Error('Image payload was empty.');
  }

  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds maximum size of 10MB.');
  }

  const metadata = await sharp(imageBuffer).metadata();
  if (!isAllowedImageFormat(metadata.format)) {
    throw new Error('Unsupported image format. Please send JPEG, PNG, or WebP.');
  }
}

function ensureTwilioCredentials(): { accountSid: string; authToken: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required to download Twilio media.');
  }

  return { accountSid, authToken };
}

function contentLengthHeaderToBytes(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

export async function downloadMedia(mediaUrl: string): Promise<Buffer> {
  if (!mediaUrl) {
    throw new Error('Media URL is required.');
  }

  if (mediaUrl.startsWith('file://')) {
    const localPath = decodeURIComponent(mediaUrl.replace('file://', ''));
    const data = await fs.readFile(localPath);
    await validateImageBuffer(data);
    return data;
  }

  const { accountSid, authToken } = ensureTwilioCredentials();
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download media from Twilio: ${response.status}`);
  }

  const contentLength = contentLengthHeaderToBytes(response.headers.get('content-length'));
  if (contentLength !== null && contentLength > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds maximum size of 10MB.');
  }

  const arrayBuffer = await response.arrayBuffer();
  const imageBuffer = Buffer.from(arrayBuffer);
  await validateImageBuffer(imageBuffer);
  return imageBuffer;
}

export async function storeImage(
  shopId: string,
  imageBuffer: Buffer,
  filename: string,
): Promise<StoredImage> {
  if (!shopId.trim()) {
    throw new Error('shopId is required.');
  }

  await validateImageBuffer(imageBuffer);

  const baseName = sanitizeBaseName(filename);
  const suffix = randomUUID().slice(0, 8);
  const uploadDir = path.join(publicRootDir(), 'uploads', shopId);

  await fs.mkdir(uploadDir, { recursive: true });

  const outputFile = `${baseName}-${suffix}.webp`;
  const thumbFile = `${baseName}-${suffix}-thumb.webp`;

  const outputPath = path.join(uploadDir, outputFile);
  const thumbPath = path.join(uploadDir, thumbFile);

  await sharp(imageBuffer)
    .rotate()
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outputPath);

  await sharp(imageBuffer)
    .rotate()
    .resize({ width: 400, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(thumbPath);

  return {
    url: toPublicUrl(path.join('public', 'uploads', shopId, outputFile)),
    thumbnailUrl: toPublicUrl(path.join('public', 'uploads', shopId, thumbFile)),
  };
}

function inferFilenameFromUrl(mediaUrl: string, index: number): string {
  try {
    const parsed = new URL(mediaUrl);
    const candidate = path.basename(parsed.pathname);
    return candidate || `media-${index + 1}`;
  } catch {
    return `media-${index + 1}`;
  }
}

export async function downloadAndStoreImages(shopId: string, mediaUrls: string[]): Promise<StoredImage[]> {
  const stored: StoredImage[] = [];

  for (const [index, mediaUrl] of mediaUrls.entries()) {
    const buffer = await downloadMedia(mediaUrl);
    const filename = inferFilenameFromUrl(mediaUrl, index);
    const result = await storeImage(shopId, buffer, filename);
    stored.push(result);
  }

  return stored;
}

export async function addImagesToGallery(shopId: string, images: StoredImage[]): Promise<void> {
  if (images.length === 0) {
    return;
  }

  const galleryPath = path.join(publicRootDir(), 'uploads', shopId, 'gallery.json');
  await fs.mkdir(path.dirname(galleryPath), { recursive: true });

  let existing: GalleryEntry[] = [];
  try {
    const current = await fs.readFile(galleryPath, 'utf8');
    const parsed = JSON.parse(current) as GalleryEntry[];
    if (Array.isArray(parsed)) {
      existing = parsed;
    }
  } catch {
    existing = [];
  }

  const now = new Date().toISOString();
  const nextEntries: GalleryEntry[] = images.map((image) => ({ ...image, createdAt: now }));
  await fs.writeFile(galleryPath, JSON.stringify([...existing, ...nextEntries], null, 2), 'utf8');
}

export type { StoredImage };
