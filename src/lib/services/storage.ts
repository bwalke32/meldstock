import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import FormDataNode from 'form-data';
import type { ObjectStorage, StoredObject } from './types';

const LOCAL_PREFIX = 'local:v1:';

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}
  async put(input: { bytes: Buffer; filename: string; mimeType: string }): Promise<StoredObject> {
    const id = randomUUID();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(path.join(this.root, id), input.bytes, { mode: 0o600 });
    return { key: `${LOCAL_PREFIX}${id}`, filename: input.filename, mimeType: input.mimeType };
  }
  private resolve(key: string): string {
    if (!key.startsWith(LOCAL_PREFIX) || !/^[0-9a-f-]{36}$/.test(key.slice(LOCAL_PREFIX.length)))
      throw new Error('Invalid storage key');
    return path.join(this.root, key.slice(LOCAL_PREFIX.length));
  }
  async get(key: string) {
    return { bytes: await readFile(this.resolve(key)) };
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

export class PolsiaObjectStorage implements ObjectStorage {
  private readonly trustedLegacyOrigins: ReadonlySet<string>;

  constructor(
    private readonly uploadUrl: string,
    private readonly apiKey: string,
    trustedLegacyOrigins: string,
  ) {
    this.trustedLegacyOrigins = parseTrustedLegacyOrigins(trustedLegacyOrigins);
  }

  private resolveLegacyUrl(key: string): URL {
    const url = new URL(key);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      !this.trustedLegacyOrigins.has(url.origin)
    )
      throw new Error('Untrusted legacy storage reference');
    return url;
  }
  async put(input: { bytes: Buffer; filename: string; mimeType: string }): Promise<StoredObject> {
    const form = new FormDataNode();
    form.append('file', input.bytes, { filename: input.filename, contentType: input.mimeType });
    const nodeFetch = require('node-fetch') as typeof import('node-fetch').default;
    const response = await nodeFetch(this.uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, ...form.getHeaders() },
      body: form,
    });
    const json = (await response.json()) as {
      success?: boolean;
      file?: { url: string; filename: string; mime_type: string };
    };
    if (!response.ok || !json.success || !json.file) throw new Error('Object upload failed');
    this.resolveLegacyUrl(json.file.url);
    return { key: json.file.url, filename: json.file.filename, mimeType: json.file.mime_type };
  }
  async get(key: string) {
    const url = this.resolveLegacyUrl(key);
    const response = await fetch(url, { cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('Object unavailable');
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type') ?? undefined,
    };
  }
  async delete(): Promise<void> {
    throw new Error('Delete is not supported by the temporary Polsia adapter');
  }
}

export function parseTrustedLegacyOrigins(value: string): ReadonlySet<string> {
  const origins = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const url = new URL(entry);
      if (
        url.protocol !== 'https:' ||
        url.username !== '' ||
        url.password !== '' ||
        url.pathname !== '/' ||
        url.search !== '' ||
        url.hash !== ''
      )
        throw new Error('Legacy storage origins must be HTTPS origins');
      return url.origin;
    });
  if (origins.length === 0)
    throw new Error('At least one trusted legacy storage origin is required');
  return new Set(origins);
}
