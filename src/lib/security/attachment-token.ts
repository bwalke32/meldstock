import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

const PREFIX = 'msa1';
const VERSION = 1;

export class AttachmentTokenError extends Error {
  constructor() {
    super('Invalid attachment reference');
    this.name = 'AttachmentTokenError';
  }
}

export class AttachmentConfigurationError extends Error {
  constructor() {
    super('Attachment storage is not configured');
    this.name = 'AttachmentConfigurationError';
  }
}

export interface AttachmentTokenPayload {
  upstreamUrl: string;
  uploadedBy: string;
  filename: string;
  mimeType: string;
  issuedAt: number;
}

function keyFor(secret?: string): Buffer {
  const value = secret ?? process.env.BETTER_AUTH_SECRET;
  if (!value) throw new AttachmentConfigurationError();
  return createHash('sha256').update(`meldstock:attachment:v1:${value}`).digest();
}

function assertControlledUrl(raw: string): void {
  if (/^local:v1:[0-9a-f-]{36}$/.test(raw)) return;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AttachmentTokenError();
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isIP(host) !== 0
  ) {
    throw new AttachmentTokenError();
  }
}

export function issueAttachmentToken(
  input: Omit<AttachmentTokenPayload, 'issuedAt'> & { issuedAt?: number },
  secret?: string,
): string {
  assertControlledUrl(input.upstreamUrl);
  const payload = JSON.stringify({
    v: VERSION,
    upstreamUrl: input.upstreamUrl,
    uploadedBy: input.uploadedBy,
    filename: input.filename,
    mimeType: input.mimeType,
    issuedAt: input.issuedAt ?? Date.now(),
  });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return [
    PREFIX,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}

export function resolveAttachmentToken(
  token: string,
  options: { secret?: string; expectedUploadedBy?: string; maxAgeMs?: number } = {},
): AttachmentTokenPayload {
  try {
    const [prefix, ivPart, ciphertextPart, tagPart, extra] = token.split('.');
    if (prefix !== PREFIX || !ivPart || !ciphertextPart || !tagPart || extra) {
      throw new AttachmentTokenError();
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFor(options.secret),
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const raw = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const value = JSON.parse(raw) as Partial<AttachmentTokenPayload> & { v?: number };
    if (
      value.v !== VERSION ||
      typeof value.upstreamUrl !== 'string' ||
      typeof value.uploadedBy !== 'string' ||
      typeof value.filename !== 'string' ||
      typeof value.mimeType !== 'string' ||
      typeof value.issuedAt !== 'number'
    ) {
      throw new AttachmentTokenError();
    }
    assertControlledUrl(value.upstreamUrl);
    if (options.expectedUploadedBy && value.uploadedBy !== options.expectedUploadedBy) {
      throw new AttachmentTokenError();
    }
    if (options.maxAgeMs && Date.now() - value.issuedAt > options.maxAgeMs) {
      throw new AttachmentTokenError();
    }
    return value as AttachmentTokenPayload;
  } catch (error) {
    if (error instanceof AttachmentConfigurationError) throw error;
    throw new AttachmentTokenError();
  }
}
