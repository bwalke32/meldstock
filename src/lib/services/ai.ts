import 'server-only';
import type { AiCompletionRequest, AiService } from './types';

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
        ...(input.responseFormat === 'json_object'
          ? { response_format: { type: 'json_object' } }
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
