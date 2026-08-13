// @polsia:user-owned — client island for /dashboard/messages. Two-pane inbox
// inside the dashboard shell: left column is the signed-in user's thread list
// (re-using the inbox row card semantics — counterparty + lot title + last
// message preview + unread badge + timestamp), right column reuses the
// existing <Thread/> composer when `?thread=<id>` is present; otherwise an
// empty-state surface.
//
// Broker-group room rows render distinctly: a "Broker room" badge + top-3
// member avatars + the room name as the line-1 subject, instead of the
// polymer/condition pill + counterparty line. The right pane's <Thread/>
// also branches on `kind === 'BROKER_GROUP'` to hide lot + otherParty UI
// and surface room description + creator + member count instead.
//
// "Create room" button in the inbox header opens the modal — the form
// picks a name + invitees + (optional) description, posts to /api/rooms,
// and on 201 we navigate to the new room. The whole flow is gated by the
// existing `useSession()` belt + braces.
//
// Selection is URL-driven (`?thread=<id>`) so deep-links from the unread-messages
// widget, the dashboard nav, and open in new-tab all "just work" — and so the
// thread fetch on the right pane is keyed by a stable id that survives a
// refresh, matching the convention used by the /lots filter URL.
'use client';

import { Inbox as InboxIcon, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CreateRoomModal } from '@/components/custom/messages/CreateRoomModal';
import { RfqLabel } from '@/components/custom/messages/rfq-label';
import { Thread } from '@/components/custom/messages/thread';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import { conditionLabel, polymerLabel, relativeAge } from '@/lib/business/lots';
import type { LotCondition, Polymer } from '@/lib/contracts/lots';
import { type ThreadItem, ThreadList as ThreadListSchema } from '@/lib/contracts/messaging';

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error' }
  | { kind: 'ready'; threads: ThreadItem[] };

export function MessagesInbox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, isPending } = useSession();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [createOpen, setCreateOpen] = useState(false);

  // The dashboard shell already redirects unauth users to /login; this
  // second belt is only here for the brief transition state where a stale
  // page mounts before the shell effect fires.
  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      router.replace('/login');
    }
  }, [isPending, router, session?.user]);

  const refreshInbox = useCallback(() => {
    void apiFetch('/api/threads', { schema: ThreadListSchema })
      .then((data) => {
        if (data.items.length === 0) {
          setState({ kind: 'empty' });
        } else {
          setState({ kind: 'ready', threads: data.items });
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (isPending || !session?.user) return;
    let active = true;
    apiFetch('/api/threads', { schema: ThreadListSchema })
      .then((data) => {
        if (!active) return;
        if (data.items.length === 0) {
          setState({ kind: 'empty' });
        } else {
          setState({ kind: 'ready', threads: data.items });
        }
      })
      .catch((err: unknown) => {
        const status = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined;
        if (!active) return;
        if (status === '401') {
          router.replace('/login');
          return;
        }
        setState({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [isPending, router, session?.user]);

  // URL-driven selection. `?thread=<id>` picks the right pane; replacing the
  // search string keeps the back/forward stack clean (no full nav). Empty/
  // missing param ⇒ empty-state pane on the right.
  const selectedId = searchParams.get('thread');
  const selectThread = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (id === null) {
        next.delete('thread');
      } else {
        next.set('thread', id);
      }
      const qs = next.toString();
      router.replace(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  // Fresh pull after the user adds another participant — picks up the
  // updated `participantCount` so the left pane's "Group" badge appears.
  // Fire-and-forget; the right pane's own roster is already updated
  // optimistically by the `<Thread/>` island and the unread widget listens
  // for a separate invalidation event.
  const handleParticipantsChanged = useCallback(() => {
    refreshInbox();
  }, [refreshInbox]);

  const handleRoomCreated = useCallback(() => {
    refreshInbox();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('messages-unread:invalidate'));
    }
  }, [refreshInbox]);

  if (isPending || state.kind === 'loading') {
    return <InboxSkeleton />;
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

  if (state.kind === 'error') {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-h3 tracking-tight">
            Couldn’t load your messages
          </CardTitle>
          <CardDescription>Try again in a moment.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      {state.kind === 'empty' ? (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="font-display text-h3 tracking-tight">No messages yet</CardTitle>
            <CardDescription>
              Open a thread from a lot detail page to start a private conversation with the seller,
              or create a broker-group room to gather multiple people at once.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/trading-floor">Browse the trading floor →</Link>
            </Button>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" className="mr-1 size-3.5" />
              Create room
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <ThreadListPane
            threads={state.threads}
            selectedId={selectedId}
            onSelect={selectThread}
            onCreateRoom={() => setCreateOpen(true)}
          />
          <ThreadDetailPane
            selectedId={selectedId}
            onClose={() => selectThread(null)}
            onParticipantsChanged={handleParticipantsChanged}
          />
        </div>
      )}
      <CreateRoomModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleRoomCreated}
      />
    </>
  );
}

function ThreadListPane({
  threads,
  selectedId,
  onSelect,
  onCreateRoom,
}: {
  threads: ThreadItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateRoom: () => void;
}) {
  return (
    <aside aria-label="Threads" className="flex min-w-0 flex-col gap-3">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-h4 tracking-[-0.02em]">Threads</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCreateRoom}
          aria-label="Create a broker-group room"
        >
          <Plus aria-hidden="true" className="mr-1 size-3.5" />
          Create room
        </Button>
      </header>
      <span className="-mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {threads.length} {threads.length === 1 ? 'conversation' : 'conversations'}
      </span>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {threads.map((thread) => {
          const isSelected = thread.id === selectedId;
          const isRoom = thread.kind === 'BROKER_GROUP';
          const isGroup = thread.participantCount > 2;
          return (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => onSelect(thread.id)}
                aria-current={isSelected ? 'true' : undefined}
                className={
                  isSelected
                    ? 'flex w-full flex-col gap-2 border-l-2 border-primary bg-primary/[0.06] px-5 py-4 text-left transition-colors hover:bg-primary/[0.08] focus-visible:bg-primary/[0.08] focus-visible:outline-none'
                    : thread.unread
                      ? 'flex w-full flex-col gap-2 border-l-2 border-transparent bg-primary/[0.04] px-5 py-4 text-left transition-colors hover:bg-primary/[0.08] focus-visible:bg-primary/[0.08] focus-visible:outline-none'
                      : 'flex w-full flex-col gap-2 border-l-2 border-transparent px-5 py-4 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none'
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                        {thread.rfq ? (
                          // Row is a <button>; nesting the inner back-link
                          // ("no interactive content descendant" in <button>).
                          // Pill shows the same text without the anchor; the
                          // thread header still carries the back-link.
                          <RfqLabel rfq={thread.rfq} withLink={false} />
                        ) : isRoom ? (
                          <span className="inline-flex items-center gap-1">
                            <Users aria-hidden="true" className="size-3" />
                            Broker room
                          </span>
                        ) : thread.lotSummary ? (
                          `${polymerLabel(thread.lotSummary.polymer as Polymer)} · ${conditionLabel(thread.lotSummary.condition as LotCondition)}`
                        ) : (
                          'Thread'
                        )}
                      </span>
                      <span className="truncate font-display text-sm font-semibold text-foreground">
                        {/* Rooms: the room name doubles as the headline
                            subject (no counterparty to lead with). Listing
                            threads: counterparty company name (fallback to
                            display name). */}
                        {isRoom
                          ? thread.subject
                          : (thread.otherParty?.companyName ??
                            thread.otherParty?.displayName ??
                            'User')}
                      </span>
                    </span>
                    {isRoom ? (
                      <Badge
                        variant="default"
                        className="shrink-0 gap-1 px-1.5 py-0 text-[10px] uppercase tracking-wider"
                        title={`Broker room · ${thread.participantCount} members`}
                      >
                        <Users aria-hidden="true" className="size-3" />
                        <span className="sr-only">Broker room</span>
                        <span aria-hidden="true">Room</span>
                      </Badge>
                    ) : isGroup ? (
                      <Badge
                        variant="secondary"
                        className="shrink-0 gap-1 px-1.5 py-0 text-[10px] uppercase tracking-wider"
                        title={`Group thread · ${thread.participantCount} participants`}
                      >
                        <Users aria-hidden="true" className="size-3" />
                        <span className="sr-only">Group thread</span>
                        <span aria-hidden="true">Group</span>
                      </Badge>
                    ) : null}
                    {thread.unread ? (
                      <Badge
                        variant="default"
                        className="shrink-0 px-1.5 py-0 text-[10px] uppercase tracking-wider"
                      >
                        <span className="sr-only">Unread</span>
                        <span aria-hidden="true">New</span>
                      </Badge>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {relativeAge(thread.lastMessageAt)}
                  </span>
                </div>

                {/* For rooms render the top-3 member avatar stack so the
                    inbox row reads as a multi-person conversation at a
                    glance. Listing threads skip this — otherParty already
                    covers the headline. */}
                {(() => {
                  const members = thread.members ?? [];
                  if (!isRoom || members.length === 0) return null;
                  return (
                    <div className="flex items-center gap-1.5">
                      <div className="flex -space-x-2">
                        {members.slice(0, 3).map((m) => (
                          <Avatar
                            key={m.userId}
                            className="size-5 border-2 border-card"
                            title={m.companyName ?? m.displayName}
                          >
                            <AvatarFallback className="bg-muted text-[9px] text-foreground/70">
                              {initials(m.displayName)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                      </div>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {memberNames(members, thread.participantCount)}
                      </span>
                    </div>
                  );
                })()}

                <span className="line-clamp-1 text-sm font-medium text-foreground">
                  {isRoom ? thread.subject : thread.subject}
                </span>

                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {thread.lastMessage
                    ? truncate(thread.lastMessage.body, 120)
                    : isRoom
                      ? 'No messages yet — open the room to break the ice.'
                      : 'No messages yet — drop the first line to open the thread.'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function ThreadDetailPane({
  selectedId,
  onClose,
  onParticipantsChanged,
}: {
  selectedId: string | null;
  onClose: () => void;
  onParticipantsChanged?: () => void;
}) {
  if (selectedId === null) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-2 py-12 text-center">
          <span className="flex size-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
            <InboxIcon aria-hidden="true" className="size-4" />
          </span>
          <p className="font-display text-sm font-semibold text-foreground">
            Pick a thread to open it
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Conversations open on the right while you keep the inbox on the left — unread threads
            are flagged so you can spot what needs a reply.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <h2 className="font-display text-h4 tracking-[-0.02em]">Conversation</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Back to inbox
        </Button>
      </header>
      <Thread threadId={selectedId} onParticipantsChanged={onParticipantsChanged} />
    </section>
  );
}

function InboxSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <aside className="flex flex-col gap-3">
        <Skeleton className="h-6 w-32" />
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {[0, 1, 2].map((i) => (
            <li key={`row-${i}`} className="flex flex-col gap-2 px-5 py-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
            </li>
          ))}
        </ul>
      </aside>
      <Card className="border-border bg-card">
        <CardContent className="py-10 text-sm text-muted-foreground">Loading thread…</CardContent>
      </Card>
    </div>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]?.charAt(0).toUpperCase() ?? '?';
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts[parts.length - 1]?.charAt(0) ?? '';
  return `${first}${last}`.toUpperCase();
}

function memberNames(
  members: { displayName: string; companyName: string | null }[],
  total: number,
): string {
  const names = members.map((m) => m.companyName ?? m.displayName).filter(Boolean);
  if (total > names.length) {
    return `${names.slice(0, 2).join(', ')} +${total - Math.min(names.length, 2)} more`;
  }
  return names.join(', ');
}
