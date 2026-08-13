// @polsia:user-owned — Server redirect. Deep links of the form `/messages/[id]`
// from the dashboard unread widget, the lot detail "Message seller" button,
// and any saved link continue to work: they land here, we read the threadId
// out of the dynamic segment, and hop straight to `/dashboard/messages` with
// the thread preselected for the right pane.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ThreadRedirectPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  redirect(`/dashboard/messages?thread=${encodeURIComponent(threadId)}`);
}
