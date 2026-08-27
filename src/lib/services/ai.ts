import 'server-only';
import type { AiCompletionRequest, AiService } from './types';

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export class AiUnavailableError extends Error {
  constructor() {
    super('AI is not configured.');
    this.name = 'AiUnavailableError';
  }
}
export class DisabledAiService implements AiService {
  async complete(request: AiCompletionRequest): Promise<string> {
    void request;
    throw new AiUnavailableError();
  }
  async stream(request: AiCompletionRequest): Promise<Response> {
    void request;
    throw new AiUnavailableError();
  }
}
export class PolsiaAiService implements AiService {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}
  private async request(input: AiCompletionRequest, stream: boolean) {
    return fetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: input.model ?? 'gpt-4o-mini',
        messages: input.messages,
        stream,
        ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
        ...(typeof input.maxOutputTokens === 'number' ? { max_tokens: input.maxOutputTokens } : {}),
        ...(input.responseFormat && input.responseFormat !== 'text'
          ? { response_format: chatCompletionResponseFormat(input.responseFormat) }
          : {}),
        ...(input.task ? { task: input.task } : {}),
      }),
      cache: 'no-store',
      signal: input.signal,
    });
  }
  async complete(input: AiCompletionRequest) {
    const response = await this.request(input, false);
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`AI provider failed: ${response.status}`);
    return body?.choices?.[0]?.message?.content ?? '';
  }
  async stream(input: AiCompletionRequest) {
    const response = await this.request(input, true);
    if (!response.ok || !response.body) throw new Error(`AI provider failed: ${response.status}`);
    return response;
  }
}

/**
 * Optional independent OpenAI adapter. Non-streaming work uses the Responses
 * API and sets `store: false`; streaming keeps Chat Completions wire format so
 * the existing browser relay does not need a provider-specific parser.
 */
export class OpenAiService implements AiService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  async complete(input: AiCompletionRequest): Promise<string> {
    const response = await fetch(`${this.cleanBaseUrl()}/responses`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: input.model ?? DEFAULT_OPENAI_MODEL,
        input: input.messages,
        store: false,
        ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
        ...(typeof input.maxOutputTokens === 'number'
          ? { max_output_tokens: input.maxOutputTokens }
          : {}),
        ...(input.responseFormat && input.responseFormat !== 'text'
          ? { text: { format: responsesFormat(input.responseFormat) } }
          : {}),
        ...(input.task ? { metadata: { task: input.task } } : {}),
      }),
      cache: 'no-store',
      signal: input.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`AI provider failed: ${response.status}`);
    const text = extractResponseText(body);
    if (!text) throw new Error('AI provider returned no text');
    return text;
  }

  async stream(input: AiCompletionRequest): Promise<Response> {
    const response = await fetch(`${this.cleanBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: input.model ?? DEFAULT_OPENAI_MODEL,
        messages: input.messages,
        stream: true,
        ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
        ...(typeof input.maxOutputTokens === 'number' ? { max_tokens: input.maxOutputTokens } : {}),
        ...(input.responseFormat && input.responseFormat !== 'text'
          ? { response_format: chatCompletionResponseFormat(input.responseFormat) }
          : {}),
      }),
      cache: 'no-store',
      signal: input.signal,
    });
    if (!response.ok || !response.body) throw new Error(`AI provider failed: ${response.status}`);
    return response;
  }

  private cleanBaseUrl(): string {
    return this.baseUrl.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' };
  }
}

function chatCompletionResponseFormat(
  format: Exclude<AiCompletionRequest['responseFormat'], 'text' | undefined>,
) {
  if (format === 'json_object') return { type: 'json_object' };
  return {
    type: 'json_schema',
    json_schema: {
      name: format.name,
      schema: format.schema,
      strict: format.strict ?? true,
    },
  };
}

function responsesFormat(
  format: Exclude<AiCompletionRequest['responseFormat'], 'text' | undefined>,
) {
  if (format === 'json_object') return { type: 'json_object' };
  return {
    type: 'json_schema',
    name: format.name,
    schema: format.schema,
    strict: format.strict ?? true,
  };
}

function extractResponseText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;
  if (!Array.isArray(record.output)) return '';

  for (const item of record.output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string') return text;
    }
  }
  return '';
}
