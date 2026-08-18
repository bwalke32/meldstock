// @polsia:framework-owned - DO NOT EDIT. Code installed by polsia/modules/email@0.3.0. Drift = commit rejected.
// Server-only sendEmail transport — POSTs to the Polsia email proxy. Import it from your app's
// OWN server route handlers (never expose a generic /api/email route). Compose subject/html/text in
// the user-owned @/lib/email/templates, then: sendEmail({ to, ...welcomeEmail({ name }) }).

import 'server-only';
import { services } from '@/lib/services';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  // Thread a reply onto a received message (its company_emails id, from the /api/proxy/email/inbox
  // feed). Genuine replies skip the cold-send cap. Omit to start a new thread.
  replyToEmailId?: string;
}

export interface SendEmailResult {
  // company_emails id of the stored outbound message. Empty string when the recipient was
  // suppressed (unsubscribed/bounced) — the proxy accepted the call but sent nothing.
  id: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  return services.mail.send(input);
}
