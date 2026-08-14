// @polsia:user-owned — /messages/[threadId] conversation view. Loads the
// thread detail on mount, composes the chronological message list + composer
// + a participant roster with an "add by email or company name" form. The
// add form posts to /api/threads/[id]/participants; the dispatched
// `messages-unread:invalidate` window event nudges the dashboard unread
// widget so a thread with new posts from the freshly-added user flips
// `unread` on the count on the very next tick. The same island mounts the
// post-deal "Mark as completed" / "Rate this transaction" surfaces when
// the underlying thread is a listing/RFQ.
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FileSpreadsheet, FileText, ImageIcon, Paperclip, UserPlus, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { DealStepper } from '@/components/custom/messages/DealStepper';
import { MarkCompletedButton } from '@/components/custom/messages/MarkCompletedButton';
import { RatingSection } from '@/components/custom/messages/RatingSection';
import { RfqLabel } from '@/components/custom/messages/rfq-label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import { conditionLabel, polymerLabel, relativeAge } from '@/lib/business/lots';
import type { LotCondition, Polymer } from '@/lib/contracts/lots';
import {
  type AttachmentUploadResponse,
  AttachmentUploadResponse as AttachmentUploadResponseSchema,
  type CreateMessage,
  CreateMessage as CreateMessageSchema,
  type MessageItem,
  MessageItem as MessageItemSchema,
  type ParticipantItem,
  ParticipantItem as ParticipantItemSchema,
  type ThreadDetail,
  ThreadDetail as ThreadDetailSchema,
} from '@/lib/contracts/messaging';

type State =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'error' }
  | {
      kind: 'ready';
      thread: ThreadDetail['thread'];
      messages: MessageItem[];
      participants: ParticipantItem[];
    };

export interface ThreadProps {
  threadId: string;
  /**
   * Fired after a participant is successfully added. The dashboard
   * `MessagesInbox` left pane listens so /api/threads can be rehydrated and
   * the freshly-added user appears in their own inbox on next refresh.
   * Optional — public `/messages/[id]` callers (and tests) omit it.
   */
  onParticipantsChanged?: () => void;
}

export function Thread({ threadId, onParticipantsChanged }: ThreadProps) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    apiFetch(`/api/threads/${encodeURIComponent(threadId)}`, { schema: ThreadDetailSchema })
      .then((data) => {
        if (!active) return;
        setState({
          kind: 'ready',
          thread: data.thread,
          messages: data.messages,
          participants: data.participants,
        });
      })
      .catch((err: unknown) => {
        const status = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined;
        if (!active) return;
        if (status === '401') {
          router.replace('/login');
          return;
        }
        if (status === '403') {
          setState({ kind: 'forbidden' });
          return;
        }
        if (status === '404') {
          setState({ kind: 'not-found' });
          return;
        }
        setState({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [router, threadId]);

  if (isPending) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-10 text-sm text-muted-foreground">Loading thread…</CardContent>
      </Card>
    );
  }

  if (!session?.user) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-10 text-sm text-muted-foreground">
          Redirecting to sign in…
        </CardContent>
      </Card>
    );
  }

  if (state.kind === 'loading') {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-10 text-sm text-muted-foreground">Loading thread…</CardContent>
      </Card>
    );
  }

  if (state.kind === 'forbidden') {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-h3 tracking-tight">Not your thread</CardTitle>
          <CardDescription>
            This conversation belongs to another account. Open it from your inbox instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/messages">Back to your inbox →</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === 'not-found') {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-h3 tracking-tight">Thread not found</CardTitle>
          <CardDescription>The thread may have been removed or the link is wrong.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/messages">Back to your inbox →</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-h3 tracking-tight">
            Couldn't open this thread
          </CardTitle>
          <CardDescription>Try again in a moment.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <ThreadReady
      threadId={threadId}
      currentUserId={session.user.id}
      thread={state.thread}
      initialMessages={state.messages}
      initialParticipants={state.participants}
      onParticipantsChanged={onParticipantsChanged}
    />
  );
}

type ThreadReadyProps = {
  threadId: string;
  currentUserId: string;
  thread: ThreadDetail['thread'];
  initialMessages: MessageItem[];
  initialParticipants: ParticipantItem[];
  onParticipantsChanged?: () => void;
};

function ThreadReady({
  threadId,
  currentUserId,
  thread,
  initialMessages,
  initialParticipants,
  onParticipantsChanged,
}: ThreadReadyProps) {
  // `thread` rehydrates from the parent's first fetch — keep it as local
  // state so we can re-fetch on `thread-status:invalidate` /
  // `ratings:submitted` without a full Thread remount. The detail endpoint
  // is cheap (single round-trip + 4 batched joins) and a status flip
  // genuinely needs a fresh read because the wire (status, completedAt)
  // changes server-side.
  const [currentThread, setCurrentThread] = useState<ThreadDetail['thread']>(thread);
  const [messages, setMessages] = useState<MessageItem[]>(initialMessages);
  const [participants, setParticipants] = useState<ParticipantItem[]>(initialParticipants);

  const refreshThread = useCallback(() => {
    apiFetch(`/api/threads/${encodeURIComponent(threadId)}`, { schema: ThreadDetailSchema })
      .then((data) => {
        setCurrentThread(data.thread);
      })
      .catch(() => undefined);
  }, [threadId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onStatus() {
      refreshThread();
    }
    window.addEventListener('thread-status:invalidate', onStatus);
    // Same listener on the deal-status strip — the seller-side PATCH in
    // <DealStepper/> dispatches both, but a buyer in another tab opens
    // this view without ever firing the strip — they still need a
    // path to fresh stepper state. The 20 s `setInterval` below is the
    // safety net for that exact case.
    window.addEventListener('deal-status:invalidate', onStatus);
    return () => {
      window.removeEventListener('thread-status:invalidate', onStatus);
      window.removeEventListener('deal-status:invalidate', onStatus);
    };
  }, [refreshThread]);

  // Cheap, focused "tick forward" for buyer viewers (whose open page is
  // NOT the one that originated the deal-status PATCH). Refreshes the
  // detail GET every 20 s while the view is mounted; a fresh
  // `detail.thread.dealStatus` flips the visible stepper pill in place
  // because the Stepper derives its initial state from
  // `currentThread.dealStatus` on each reconciliation via its parent's
  // upstream prop. Clear on unmount so an inactive tab doesn't keep
  // ledger round-trips alive.
  useEffect(() => {
    const intervalId = window.setInterval(refreshThread, 20_000);
    return () => window.clearInterval(intervalId);
  }, [refreshThread]);

  // Optimistically splice a newly-added participant into local state so the
  // roster reflect the addition before the next detail GET. Toast + unread
  // invalidation flow from this same callback so the dashboard widget +
  // inbox list both see the change.
  function handleParticipantAdded(added: ParticipantItem) {
    setParticipants((prev) =>
      prev.some((p) => p.userId === added.userId) ? prev : [...prev, added],
    );
    toast.success(`Added ${added.companyName ?? added.displayName}.`);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('messages-unread:invalidate'));
    }
    onParticipantsChanged?.();
  }

  async function handleSend(body: string, attachment?: AttachmentUploadResponse) {
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: MessageItem = {
      id: tempId,
      threadId,
      senderId: currentUserId,
      body,
      createdAt: new Date().toISOString(),
      attachmentUrl: null,
      attachmentFilename: attachment?.filename ?? null,
      attachmentMimeType: attachment?.mimeType ?? null,
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const real = await apiFetch<MessageItem>(
        `/api/threads/${encodeURIComponent(threadId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            body,
            attachmentToken: attachment?.token,
          }),
          schema: MessageItemSchema,
        },
      );
      setMessages((prev) => prev.map((m) => (m.id === tempId ? real : m)));
      toast.success('Message sent.');
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      toast.error('Could not send. Please try again.');
    }
  }

  return (
    <ThreadView
      thread={currentThread}
      currentUserId={currentUserId}
      messages={messages}
      participants={participants}
      onSend={handleSend}
      onParticipantAdded={handleParticipantAdded}
    />
  );
}

function ThreadView({
  thread,
  currentUserId,
  messages,
  participants,
  onSend,
  onParticipantAdded,
}: {
  thread: ThreadDetail['thread'];
  currentUserId: string;
  messages: MessageItem[];
  participants: ParticipantItem[];
  onSend: (body: string, attachment?: AttachmentUploadResponse) => Promise<void>;
  onParticipantAdded: (participant: ParticipantItem) => void;
}) {
  const form = useForm<CreateMessage>({
    resolver: zodResolver(CreateMessageSchema),
    defaultValues: { body: '' },
    mode: 'onBlur',
  });
  const [sending, setSending] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<AttachmentUploadResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/attachments/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Upload failed');
      setPendingAttachment(AttachmentUploadResponseSchema.parse(json));
    } catch {
      toast.error('Could not upload file. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    if (sending) return;
    setSending(true);
    try {
      await onSend(values.body, pendingAttachment ?? undefined);
      form.reset({ body: '' });
      setPendingAttachment(null);
    } finally {
      setSending(false);
    }
  });

  const polymerText = thread.lotSummary?.polymer ?? '';
  const conditionText = thread.lotSummary?.condition ?? '';
  const isRoom = thread.kind === 'BROKER_GROUP';

  return (
    <section className="flex flex-col gap-4">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="gap-2 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <span
              className={
                isRoom
                  ? 'inline-flex items-center gap-1 text-eyebrow text-primary'
                  : 'text-eyebrow text-primary'
              }
            >
              <Users aria-hidden="true" className="size-3" />
              {isRoom ? 'Room' : 'Thread'}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              updated {relativeAge(thread.lastMessageAt)}
            </span>
          </div>
          <CardTitle className="font-display text-h3 leading-tight tracking-[-0.02em]">
            {thread.subject}
          </CardTitle>
          {thread.rfq ? (
            <div className="flex flex-wrap items-center -mt-1">
              <RfqLabel rfq={thread.rfq} />
            </div>
          ) : null}
          {isRoom && thread.description !== null && thread.description !== undefined ? (
            <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-foreground/80">
              {thread.description}
            </p>
          ) : null}
          <CardDescription className="flex flex-wrap items-center gap-2 text-sm">
            {isRoom ? (
              <>
                <span>
                  Created by{' '}
                  {/* Broker-attached room creators link to the broker marketing
                      page; otherwise the legacy plain-name render. The
                      stamped `createdByIsBroker` + `createdByUserId` flags
                      drive the routing. */}
                  {thread.createdByIsBroker === true && thread.createdByUserId ? (
                    <Button asChild variant="link" size="sm" className="h-auto px-0 text-sm">
                      <Link href={`/brokers/${encodeURIComponent(thread.createdByUserId)}`}>
                        {thread.createdByDisplayName ?? '—'}
                      </Link>
                    </Button>
                  ) : thread.createdByDisplayName !== null &&
                    thread.createdByDisplayName !== undefined ? (
                    <span className="font-medium text-foreground">
                      {thread.createdByDisplayName}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">an account</span>
                  )}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                <span className="text-muted-foreground">
                  {thread.participantCount} {thread.participantCount === 1 ? 'member' : 'members'}
                </span>
              </>
            ) : (
              <>
                With{' '}
                {/* Broker-attached counterparties link to the broker marketing
                    page; non-broker counterparties keep the legacy
                    `/u/<handle>` cross-link. The stamp is `counterpartyIsBroker`
                    under `thread.otherParty`. */}
                {thread.otherParty?.counterpartyIsBroker && thread.otherParty.userId ? (
                  <Button asChild variant="link" size="sm" className="h-auto px-0 text-sm">
                    <Link href={`/brokers/${encodeURIComponent(thread.otherParty.userId)}`}>
                      {thread.otherParty.companyName ?? thread.otherParty.displayName}
                    </Link>
                  </Button>
                ) : thread.otherParty?.handle ? (
                  <Button asChild variant="link" size="sm" className="h-auto px-0 text-sm">
                    <Link href={`/u/${thread.otherParty.handle}`}>
                      {thread.otherParty.companyName ?? thread.otherParty.displayName}
                    </Link>
                  </Button>
                ) : (
                  <span className="font-medium text-foreground">
                    {thread.otherParty?.companyName ?? thread.otherParty?.displayName ?? 'User'}
                  </span>
                )}
                · re:{' '}
                {thread.lotSummary ? (
                  <Button asChild variant="link" size="sm" className="h-auto px-0 text-sm">
                    <Link href={`/lots/${thread.lotSummary.id}`}>
                      {polymerLabel(polymerText as Polymer)} ·{' '}
                      {conditionLabel(conditionText as LotCondition)}
                    </Link>
                  </Button>
                ) : (
                  <span className="text-muted-foreground">deleted lot</span>
                )}
              </>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 pt-5">
          {/* Front-of-pipeline deal stepper. Hidden on broker-group
              rooms (no buyer/seller pair) — the server still stamps a
              default OFFER on those, the same way the closeout pill
              ignores them. The buyer-side 20 s poll + the
              deal-status:invalidate listener above keeps the strip in
              lockstep with the seller. */}
          {!isRoom && thread.dealStatus ? (
            <DealStepper
              threadId={thread.id}
              dealStatus={thread.dealStatus}
              canAdvance={thread.canAdvance ?? false}
              dealStatusUpdatedAt={thread.dealStatusUpdatedAt ?? null}
            />
          ) : null}
          <ul
            aria-label="Messages"
            className="flex max-h-[480px] flex-col gap-3 overflow-y-auto rounded-md border border-border bg-muted/20 p-4"
          >
            {messages.length === 0 ? (
              <li className="rounded-md border border-dashed border-border bg-background px-4 py-6 text-sm text-muted-foreground">
                {isRoom
                  ? 'No messages yet — break the ice so the room has context.'
                  : 'No messages yet — drop the first quote to start the negotiation.'}
              </li>
            ) : (
              messages.map((message) => (
                <li key={message.id}>
                  <MessageBubble message={message} isMine={message.senderId === currentUserId} />
                </li>
              ))
            )}
          </ul>

          <ParticipantsPanel
            threadId={thread.id}
            participants={participants}
            currentUserId={currentUserId}
            onParticipantAdded={onParticipantAdded}
          />

          <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
            <Textarea
              placeholder={
                isRoom
                  ? 'Drop a thought, ask, or note for the room — anyone in the conversation can reply.'
                  : 'Quote, counter, or sample request. Keep it short — the broker calls back fast.'
              }
              className="min-h-[88px]"
              {...form.register('body')}
            />
            {form.formState.errors.body ? (
              <p className="-mt-2 text-[11px] text-destructive">
                {form.formState.errors.body.message}
              </p>
            ) : null}

            {pendingAttachment && (
              <div className="flex items-center gap-1.5 rounded border border-border bg-muted/40 px-2 py-1 text-xs">
                <span className="max-w-[200px] truncate">{pendingAttachment.filename}</span>
                <button
                  type="button"
                  onClick={() => setPendingAttachment(null)}
                  aria-label="Remove attachment"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={uploading || sending}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach file"
              >
                <Paperclip className="size-4" />
              </Button>
              <Button type="submit" disabled={sending || uploading}>
                {sending ? 'Sending…' : uploading ? 'Uploading…' : 'Send message'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Post-deal surfaces — visible only on listing/RFQ threads.
          Broker-group rooms have no buyer/seller pair, so the rateeId
          derivation in /api/ratings would resolve to `null` and the
          server returns 422; the pill is also hidden for rooms because
          the user has nothing to win from marking a multi-party room
          "complete". */}
      {!isRoom && (thread.threadStatus ?? 'PENDING') === 'PENDING' ? (
        <MarkCompletedButton threadId={thread.id} />
      ) : null}

      {!isRoom && (thread.threadStatus ?? 'PENDING') === 'COMPLETED' ? (
        <RatingSection
          threadId={thread.id}
          thread={thread}
          onRated={() => {
            // No-op: the section re-fetches its own status on the
            // `ratings:submitted` event. Kept here so a parent caller
            // could surface a "rate updated" toast in the future.
          }}
        />
      ) : null}

      <Separator />

      <div className="flex flex-wrap items-center gap-2">
        {thread.lotSummary ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/lots/${thread.lotSummary.id}`}>View lot →</Link>
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/messages">Back to inbox →</Link>
        </Button>
      </div>
    </section>
  );
}

function MessageBubble({ message, isMine }: { message: MessageItem; isMine: boolean }) {
  const stamp = new Date(message.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <article
      className={
        isMine
          ? 'flex flex-col gap-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-2'
          : 'flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2'
      }
    >
      <header className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-2">
          <Avatar className="size-5">
            <AvatarFallback className="bg-muted text-foreground/70">
              {isMine ? 'Yo' : 'Th'}
            </AvatarFallback>
          </Avatar>
          <span className="font-mono uppercase tracking-wider text-primary">
            {isMine ? 'You' : 'Counterparty'}
          </span>
        </span>
        <span className="font-mono uppercase tracking-wider text-muted-foreground">{stamp}</span>
      </header>
      <p className="whitespace-pre-wrap text-sm text-foreground">{message.body}</p>
      {message.attachmentUrl && (
        <AttachmentLink
          url={message.attachmentUrl}
          filename={message.attachmentFilename ?? 'attachment'}
          mimeType={message.attachmentMimeType ?? ''}
        />
      )}
    </article>
  );
}

function AttachmentLink({
  url,
  filename,
  mimeType,
}: {
  url: string;
  filename: string;
  mimeType: string;
}) {
  const Icon = mimeType.startsWith('image/')
    ? ImageIcon
    : mimeType === 'application/pdf'
      ? FileText
      : FileSpreadsheet;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline"
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="max-w-[220px] truncate">{filename}</span>
    </a>
  );
}

// Roster + add-by-email-or-company form. Sits above the composer so it
// stays reachable from the same scroll position the user reads/writes
// from. The form posts to /api/threads/[id]/participants and converts
// server 404/409 responses into in-form feedback rather than toasts — the
// caller is mid-task here and the radar-toast would scroll them out.
function ParticipantsPanel({
  threadId,
  participants,
  currentUserId,
  onParticipantAdded,
}: {
  threadId: string;
  participants: ParticipantItem[];
  currentUserId: string;
  onParticipantAdded: (participant: ParticipantItem) => void;
}) {
  const [identifier, setIdentifier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = identifier.trim();
    if (trimmed.length === 0) {
      setServerError('Enter an email or company name.');
      return;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      const created = await apiFetch<ParticipantItem>(
        `/api/threads/${encodeURIComponent(threadId)}/participants`,
        {
          method: 'POST',
          body: JSON.stringify({ identifier: trimmed }),
          schema: ParticipantItemSchema,
        },
      );
      onParticipantAdded(created);
      setIdentifier('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const statusMatch = /\((\d{3})\)/.exec(message);
      const status = statusMatch?.[1];
      // Surface the server's verbatim error so multi-match disambiguation
      // and self-add rejections read as the user typed them.
      const body = (err as { cause?: { error?: string } } | undefined)?.cause;
      if (status === '404') {
        setServerError(body?.error ?? 'No matching user');
      } else if (status === '409') {
        setServerError(body?.error ?? 'Already in the thread');
      } else {
        setServerError("Couldn't add that user. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-label="Participants"
      className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-4"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-eyebrow text-primary">Participants</h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {participants.length} {participants.length === 1 ? 'person' : 'people'}
        </span>
      </header>

      <ul className="flex flex-wrap gap-2">
        {participants.map((p) => {
          const isSelf = p.userId === currentUserId;
          const label = p.companyName ?? p.displayName;
          return (
            <li key={p.userId}>
              <span
                className={
                  isSelf
                    ? 'inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary'
                    : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground'
                }
              >
                {label}
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  added {relativeAge(p.addedAt)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2" noValidate>
        <label htmlFor="add-participant-identifier" className="flex flex-col gap-1.5">
          <span className="text-eyebrow text-muted-foreground">Add a participant</span>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="add-participant-identifier"
              type="text"
              placeholder="Email or company name"
              autoComplete="off"
              className="h-9 flex-1 min-w-[180px] text-sm"
              value={identifier}
              onChange={(e) => {
                setServerError(null);
                setIdentifier(e.target.value);
              }}
            />
            <Button type="submit" size="sm" disabled={submitting}>
              <UserPlus className="mr-1.5 size-3.5" aria-hidden="true" />
              {submitting ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </label>
        {serverError ? <p className="text-[11px] text-destructive">{serverError}</p> : null}
      </form>
    </section>
  );
}
