// @polsia:user-owned — wire helpers for the document / thread-attachment
// download proxies. The raw R2 CDN URLs are NEVER exposed on the wire
// (those are guessable from a cuid + slug); instead every read-side shape
// stamps an opaque relative path the client uses as the href. The
// download proxy re-checks the viewer / participant gate BEFORE
// returning a 302 / streaming the bytes, so the URL can't be probed.
import { z } from 'zod';

// Wire shape returned by the lot-document download proxy when the
// caller is allowed to read the bytes. `expiresInMs` is currently
// approximate (audit logs the access regardless) — reserved for the
// future signed-R2-URL upgrade.
export const DocumentDownloadResponse = z.object({
  documentId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  bytes: z.number().int().nonnegative(),
  expiresInMs: z.number().int().nonnegative(),
});
export type DocumentDownloadResponse = z.infer<typeof DocumentDownloadResponse>;

export const AttachmentDownloadResponse = z.object({
  messageId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  bytes: z.number().int().nonnegative(),
  expiresInMs: z.number().int().nonnegative(),
});
export type AttachmentDownloadResponse = z.infer<typeof AttachmentDownloadResponse>;

/**
 * The opaque URL we stamp on `Document.url` and on
 * `Message.attachmentUrl` — relative so the wire doesn't carry a
 * third-party CDN host, and versionless so the audit log can refer to
 * it without re-shaping.
 */
export function documentDownloadUrl(lotId: string, documentId: string): string {
  return `/api/lots/${encodeURIComponent(lotId)}/documents/${encodeURIComponent(documentId)}/download`;
}

export function attachmentDownloadUrl(threadId: string, messageId: string): string {
  return `/api/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(messageId)}/download`;
}
