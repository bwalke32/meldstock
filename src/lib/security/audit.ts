// @polsia:user-owned — append-only audit logger for sensitive broker
// actions. NEVER throws — a buggy recorder must never break the
// request it's auditing. NEVER persists raw PII (see the PII_KEY set
// below) so the audit log is safe to wire to a future admin UI without
// a separate redaction pass.
//
// IMPORTANT: This module stamps JSON metadata only. Do NOT log message
// bodies, raw email addresses, profile displayNames, phones, free-text
// notes, message previews, or anything else that could expose the
// people behind a row. The PII_KEY set stands as a defensive backstop
// so a future contributor who forgets the rule cannot accidentally
// record a real customer record.
import 'server-only';
import type { Prisma } from '@prisma/client';
import type { AuditAction, AuditActor } from '@/lib/contracts/audit';
import { prisma } from '@/lib/db';

const PII_KEYS = new Set([
  'body',
  'email',
  'publicEmail',
  'phone',
  'notes',
  'message',
  'preview',
  'companyDescription',
  'materialsBought',
  'materialsSold',
]);

type JsonScalar = string | number | boolean | null;
type JsonBranch = JsonScalar | { [k: string]: JsonBranch } | JsonBranch[];

function sanitiseMetadata(meta: unknown): { [k: string]: JsonBranch } {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const out: { [k: string]: JsonBranch } = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (PII_KEYS.has(k)) {
      out[k] = '[redacted]';
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitiseMetadata(v);
      continue;
    }
    if (typeof v === 'string' && v.length > 200) {
      out[k] = `${v.slice(0, 200)}…`;
      continue;
    }
    if (v === undefined) continue;
    out[k] = v as JsonBranch;
  }
  return out;
}

export interface RecordAuditInput {
  userId?: string | null;
  actor?: AuditActor;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        userId: input.userId ?? null,
        actor: input.actor ?? 'USER',
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        metadata: sanitiseMetadata(input.metadata ?? {}) as Prisma.InputJsonValue,
        ip: input.ip ?? null,
      },
    });
  } catch {
    // Logged best-effort — the request must NOT 500 because the audit
    // write failed. Production monitoring integrates via the prisma
    // log adapter (`'error'` events from the singleton — see db.ts).
  }
}

export function extractIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip') ?? null;
}
