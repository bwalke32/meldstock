import 'server-only';
import type { MailMessage, MailService } from './types';

export class LocalMailService implements MailService {
  async send(message: MailMessage): Promise<{ id: string }> {
    // Deliberately discard content: local mode never sends or logs sensitive mail data.
    void message;
    return { id: `local-${crypto.randomUUID()}` };
  }
}

export class PolsiaMailService implements MailService {
  constructor(
    private readonly proxyUrl: string,
    private readonly apiKey: string,
  ) {}

  async send(message: MailMessage): Promise<{ id: string }> {
    const url = `${this.proxyUrl.replace(/\/+$/, '').replace(/\/send$/, '')}/send`;
    const body =
      message.text ??
      message.html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        to: message.to,
        subject: message.subject,
        body,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
        ...(message.replyToEmailId ? { reply_to_email_id: message.replyToEmailId } : {}),
      }),
    });
    if (!response.ok) throw new Error(`mail provider failed: ${response.status}`);
    const json = (await response.json()) as { email_id?: string };
    return { id: json.email_id ?? '' };
  }
}
