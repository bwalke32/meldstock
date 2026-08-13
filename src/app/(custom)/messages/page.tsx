// @polsia:user-owned — Server redirect. The full /messages experience now
// lives at /dashboard/messages (inside the dashboard shell, two-pane inbox
// with right-side conversation view); this route is preserved as a
// server-side redirect so existing entry points (legacy links, the top-bar
// "Messages" nav target, the public "/messages" landing bleed-through) keep
// working without a stale page.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function MessagesRedirectPage() {
  redirect('/dashboard/messages');
}
