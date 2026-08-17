// @polsia:user-owned — zod contracts for the `/api/connections` resource
// (My network). The wire shape only ever describes the caller's view: the
// counterparty is resolved server-side into a denormalised record so the
// client island doesn't have to fan out additional fetches.
//
// Identifier rule: the POST accepts an EITHER a profile handle (`@` prefix
// stripped) OR an account email (case-insensitive). The route handler
// resolves once and stores the canonical user pair; the wire only ever sees
// what the caller typed so they can show "you added acme-polymers".

import { z } from 'zod';

export const IdentifierKind = z.enum(['HANDLE', 'EMAIL']);
export type IdentifierKind = z.infer<typeof IdentifierKind>;

export const ConnectionItem = z.object({
  id: z.string(),
  connectionUserId: z.string(),
  identifier: z.string(),
  identifierKind: IdentifierKind,
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  companyName: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(['PENDING', 'ACCEPTED']),
  direction: z.enum(['INCOMING', 'OUTGOING', 'ACCEPTED', 'RECONFIRMATION_REQUIRED']),
  createdAt: z.string(),
  acceptedAt: z.string().nullable(),
});
export type ConnectionItem = z.infer<typeof ConnectionItem>;

export const ConnectionList = z.object({ items: z.array(ConnectionItem) });
export type ConnectionList = z.infer<typeof ConnectionList>;

export const CreateConnectionInput = z
  .object({
    // Either a bare handle (e.g. "acme-polymers") OR an email address. The
    // route handler tries handle first, falls back to email lookup.
    identifier: z
      .string()
      .trim()
      .min(1, 'Enter a handle or email')
      .max(120, 'Identifier is too long'),
  })
  .strict();
export type CreateConnectionInput = z.infer<typeof CreateConnectionInput>;

export const ConnectionDecisionInput = z
  .object({
    connectionId: z.string().min(1),
    action: z.enum(['ACCEPT', 'REJECT']),
  })
  .strict();
export type ConnectionDecisionInput = z.infer<typeof ConnectionDecisionInput>;

export const RemoveConnectionInput = z.object({ connectionId: z.string().min(1) }).strict();
export type RemoveConnectionInput = z.infer<typeof RemoveConnectionInput>;

export const ConnectionActionResponse = z.object({
  ok: z.boolean(),
  count: z.number().int().nonnegative().optional(),
});
export type ConnectionActionResponse = z.infer<typeof ConnectionActionResponse>;
