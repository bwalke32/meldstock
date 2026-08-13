// @polsia:user-owned — /lots/[id] private message thread. Polls every 5 s while
// mounted, throttles when the tab is hidden. Anonymous sender (free-text
// field) per the brief — no auth required at this stage.
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useLotMessages } from '@/hooks/use-lot-messages';
import { apiFetch } from '@/lib/api-client';
import {
  type CreateLotMessage,
  CreateLotMessage as CreateLotMessageSchema,
  type LotMessage,
  LotMessage as LotMessageSchema,
} from '@/lib/contracts/lots';

interface LotMessageThreadProps {
  lotId: string;
  postedByName: string;
}

export function LotMessageThread({ lotId, postedByName }: LotMessageThreadProps) {
  const { messages, isLoading } = useLotMessages(lotId);
  const [sending, setSending] = useState(false);
  const pendingIdsRef = useRef<Set<string>>(new Set());

  const form = useForm<CreateLotMessage>({
    resolver: zodResolver(CreateLotMessageSchema),
    defaultValues: { lotId, senderName: '', body: '' },
    mode: 'onBlur',
  });

  // Re-sync lotId when the URL changes (route to a different lot).
  useEffect(() => {
    form.setValue('lotId', lotId);
  }, [form, lotId]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSending(true);
    try {
      const created = await apiFetch<LotMessage>(
        `/api/lots/${encodeURIComponent(lotId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            lotId,
            senderName: values.senderName.trim(),
            body: values.body.trim(),
          }),
          schema: LotMessageSchema,
        },
      );
      // Stash the id we just persisted; when the next poll lands, the row
      // exists in the DB so we skip it from the optimistic merge.
      pendingIdsRef.current.add(created.id);
      form.reset({ lotId, senderName: values.senderName, body: '' });
      toast.success('Message sent to the lot poster.');
    } catch {
      toast.error('Could not send. Please try again.');
    } finally {
      setSending(false);
    }
  });

  const visibleMessages = useMemo(() => {
    return messages.filter((m) => !pendingIdsRef.current.has(m.id));
  }, [messages]);

  return (
    <section
      aria-label="Private thread"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card shadow-sm"
    >
      <header className="flex flex-col gap-1 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-eyebrow text-primary">Private thread</span>
          <ThreadStatus count={visibleMessages.length} isLoading={isLoading} />
        </div>
        <h2 className="font-display text-lg tracking-tight text-foreground">
          Counter-offers go to {postedByName}
        </h2>
        <p className="text-[11px] text-muted-foreground">
          No public identity exposure at this stage. Messages are visible only to viewers on this
          listing page.
        </p>
      </header>

      <div className="flex flex-col gap-3 px-5 pb-4">
        {visibleMessages.length === 0 ? (
          <EmptyState isLoading={isLoading} />
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleMessages.map((message) => (
              <li key={message.id}>
                <MessageBubble message={message} />
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={onSubmit}
          className="mt-3 flex flex-col gap-3 border-t border-border pt-4"
          noValidate
        >
          <Input
            placeholder="Your name / desk · e.g. Bay Polymers"
            autoComplete="off"
            className="h-10"
            {...form.register('senderName')}
          />
          {form.formState.errors.senderName ? (
            <p className="-mt-2 text-[11px] text-destructive">
              {form.formState.errors.senderName.message}
            </p>
          ) : null}
          <Textarea
            placeholder="Quote, counter, or sample request. Keep it short — the broker calls back fast."
            className="min-h-[88px]"
            {...form.register('body')}
          />
          {form.formState.errors.body ? (
            <p className="-mt-2 text-[11px] text-destructive">
              {form.formState.errors.body.message}
            </p>
          ) : null}
          <Button type="submit" disabled={sending}>
            {sending ? 'Sending…' : 'Send message'}
          </Button>
        </form>
      </div>
    </section>
  );
}

function EmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      {isLoading ? (
        <span>Loading thread…</span>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">No messages yet.</span>
          <span>Drop the first quote to start the negotiation.</span>
        </div>
      )}
    </div>
  );
}

function ThreadStatus({ count, isLoading }: { count: number; isLoading: boolean }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inset-0 inline-flex h-2 w-2 live-dot-ping rounded-full bg-primary/50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary/70" />
      </span>
      {isLoading ? 'syncing' : `${count} msg`}
    </span>
  );
}

function MessageBubble({ message }: { message: LotMessage }) {
  const stamp = new Date(message.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <article className="flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2">
      <header className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-mono uppercase tracking-wider text-primary">
          {message.senderName}
        </span>
        <span className="font-mono uppercase tracking-wider text-muted-foreground">{stamp}</span>
      </header>
      <p className="whitespace-pre-wrap text-sm text-foreground">{message.body}</p>
    </article>
  );
}
