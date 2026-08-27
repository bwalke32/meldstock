// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/ai@0.1.0. Drift = commit rejected.
//
// Server-only helpers for Polsia-managed LLM calls. Customer app code talks to
// the platform AI proxy (an OpenAI-compatible endpoint) using the platform-
// injected company proxy key. NO OpenAI/Anthropic SDK and NO provider secret
// keys live in the customer repo; the platform proxy meters
// per-app token budget and routes by the `task` field.

import 'server-only';
import type { ChatMessage } from '@/lib/ai/schema';
import { services } from '@/lib/services';
import { AiUnavailableError } from '@/lib/services/ai';

export class AiConfigurationError extends Error {
  constructor(message = 'AI is not configured for this app.') {
    super(message);
    this.name = 'AiConfigurationError';
  }
}

const DEFAULT_VISION_MODEL = 'gpt-4o';

// Vision messages carry an array content part; the public chat contract
// (ChatMessage) is text-only. This broader type is used internally only.
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };
export type LlmMessage =
  | ChatMessage
  | { role: 'system'; content: string | ContentPart[] }
  | { role: ChatMessage['role']; content: ContentPart[] };

export interface ChatOptions {
  messages: LlmMessage[];
  model?: string;
  task?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?:
    | 'text'
    | 'json_object'
    | {
        type: 'json_schema';
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
  signal?: AbortSignal;
}

/** Non-streaming chat completion. Returns the assistant message text. */
export async function chat(opts: ChatOptions): Promise<string> {
  try {
    return await services.ai.complete(opts);
  } catch (error) {
    if (error instanceof AiUnavailableError) throw new AiConfigurationError();
    throw error;
  }
}

/**
 * Streaming chat completion. Returns the upstream Response so a route handler
 * can relay the OpenAI-compatible SSE stream to the browser unchanged.
 */
export async function streamChat(opts: ChatOptions): Promise<Response> {
  try {
    return await services.ai.stream(opts);
  } catch (error) {
    if (error instanceof AiUnavailableError) throw new AiConfigurationError();
    throw error;
  }
}

/**
 * Structured JSON output. Forces `response_format: json_object`, parses the
 * result, and retries once with a stricter instruction on a parse failure
 * (the resilience pattern customer apps converged on).
 */
export async function generateObject<T = unknown>(opts: ChatOptions): Promise<T> {
  const raw = await chat({ ...opts, responseFormat: 'json_object' });
  try {
    return JSON.parse(raw) as T;
  } catch {
    const retry = await chat({
      ...opts,
      responseFormat: 'json_object',
      messages: [
        ...opts.messages,
        { role: 'system', content: 'Respond with valid JSON only. No prose, no markdown fences.' },
      ],
    });
    return JSON.parse(retry) as T;
  }
}

export async function generateStructuredObject<T>(
  opts: Omit<ChatOptions, 'responseFormat'> & {
    schemaName: string;
    jsonSchema: Record<string, unknown>;
    parse: (value: unknown) => T;
  },
): Promise<T> {
  const { schemaName, jsonSchema, parse, ...chatOptions } = opts;
  const raw = await chat({
    ...chatOptions,
    responseFormat: {
      type: 'json_schema',
      name: schemaName,
      schema: jsonSchema,
      strict: true,
    },
  });
  return parse(JSON.parse(raw));
}

export interface AnalyzeImageOptions {
  imageUrl: string;
  prompt: string;
  model?: string;
  task?: string;
  json?: boolean;
}

/** Vision: analyze an image URL against a prompt. */
export async function analyzeImage(opts: AnalyzeImageOptions): Promise<string> {
  return chat({
    model: opts.model ?? DEFAULT_VISION_MODEL,
    task: opts.task,
    responseFormat: opts.json ? 'json_object' : 'text',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: opts.prompt },
          { type: 'image_url', image_url: { url: opts.imageUrl, detail: 'high' } },
        ],
      },
    ],
  });
}
