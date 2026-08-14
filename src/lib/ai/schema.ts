// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/ai@0.1.0. Drift = commit rejected.
//
// Shared schemas for Polsia-managed AI calls. Safe to import from client
// components: this file has no server-only imports and does not expose secrets
// or any LLM SDK. The public /api/ai/chat route validates request bodies with
// chatRequestSchema; the server-only client adds vision/structured helpers.

import { z } from 'zod';

export const chatMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(4000),
  })
  .strict();

export const chatRequestSchema = z
  .object({
    messages: z.array(chatMessageSchema).min(1).max(20),
    model: z.literal('gpt-4o-mini').optional(),
    task: z.literal('meldstock-assistant').optional(),
  })
  .strict()
  .refine(
    (value) => value.messages.reduce((sum, message) => sum + message.content.length, 0) <= 20_000,
    {
      message: 'Conversation is too large',
      path: ['messages'],
    },
  );

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
