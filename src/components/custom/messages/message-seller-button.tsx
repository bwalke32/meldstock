// @polsia:user-owned — listing-scoped "Message seller" button. Reads the
// session client-side (no server data fetch) and opens or resumes the signed-
// in buyer's 1:1 thread with the lot's seller. For anonymous viewers or the
// seller themselves, renders nothing — the existing anonymous-public thread
// dialog on the lot detail page covers them.
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import { type ThreadItem, ThreadItem as ThreadItemSchema } from '@/lib/contracts/messaging';

export interface MessageSellerButtonProps {
  lotId: string;
  sellerUserId: string | null;
  postedByName: string;
}

export function MessageSellerButton({
  lotId,
  sellerUserId,
  postedByName,
}: MessageSellerButtonProps) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (isPending) {
    return null;
  }

  const currentUserId = session?.user?.id;

  // No session: anonymous viewer — let the existing public thread dialog cover.
  if (!currentUserId) {
    return null;
  }

  // Viewer IS the seller: they should manage their inbox at /messages instead.
  if (currentUserId === sellerUserId) {
    return null;
  }

  async function onClick() {
    if (pending) return;
    setPending(true);
    try {
      const thread = await apiFetch<ThreadItem>('/api/threads', {
        method: 'POST',
        body: JSON.stringify({ lotId }),
        schema: ThreadItemSchema,
      });
      router.push(`/messages/${thread.id}`);
    } catch (err) {
      const status = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined;
      if (status === '422') {
        toast.error('This legacy listing cannot open a private thread.');
      } else if (status === '409') {
        toast.error('You are the seller on this lot.');
      } else {
        toast.error('Could not open a thread. Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" size="sm" onClick={onClick} disabled={pending}>
      {pending ? 'Opening thread…' : `Message ${postedByName} →`}
    </Button>
  );
}
