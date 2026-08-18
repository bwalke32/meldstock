import 'server-only';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyToEmailId?: string;
}

export interface MailService {
  send(message: MailMessage): Promise<{ id: string }>;
}

export interface StoredObject {
  key: string;
  filename: string;
  mimeType: string;
}

export interface ObjectStorage {
  put(input: { bytes: Buffer; filename: string; mimeType: string }): Promise<StoredObject>;
  get(key: string): Promise<{ bytes: Buffer; mimeType?: string }>;
  delete(key: string): Promise<void>;
}

export interface AiCompletionRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: unknown }>;
  model?: string;
  task?: string;
  temperature?: number;
  responseFormat?: 'text' | 'json_object';
  signal?: AbortSignal;
}

export interface AiService {
  complete(request: AiCompletionRequest): Promise<string>;
  stream(request: AiCompletionRequest): Promise<Response>;
}

export interface AnalyticsService {
  record(event: {
    name: string;
    path?: string;
    properties?: Record<string, string | number | boolean>;
  }): Promise<void>;
}
