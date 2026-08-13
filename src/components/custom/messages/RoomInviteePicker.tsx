// @polsia:user-owned — invitee picker for the create-room modal. Pulls
// /api/rooms/invitees ONCE on mount — the API returns both the caller's
// accepted network (Connection rows) AND every verified-companies
// profile, each tagged with `source` so a person in BOTH pools surfaces
// twice with their own source label. The picker then merges by userId
// (deduping) so a single user only appears once, while preserving the
// source union so the chip says "@handle · networked and verified" when
// both pools contain them. Multi-select chips above the input show what's
// already been picked; the input filters the merged list.
//
// Search-as-you-type keys off name + handle + company — case-insensitive.
'use client';

import { Check, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { type InviteeItem, InviteeList as InviteeListSchema } from '@/lib/contracts/messaging';

type Source = 'NETWORK' | 'VERIFIED_COMPANY';
type MergedInvitee = InviteeItem & { sources: Source[] };

export interface RoomInviteePickerProps {
  /** Selected invitee userIds — controlled by the parent (CreateRoomModal). */
  value: string[];
  onChange: (next: string[]) => void;
  /** Maximum allowed selections (mirrors the zod cap of 50). */
  max?: number;
}

export function RoomInviteePicker({ value, onChange, max = 50 }: RoomInviteePickerProps) {
  const [pool, setPool] = useState<MergedInvitee[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Lazy single-shot fetch — the parent mounts this component only inside an
  // open modal, so the request fires once when the picker first mounts.
  // Stays cached in component state for cheap re-renders when the parent
  // reopens the modal without unmounting.
  function ensureLoaded() {
    if (pool !== null) return;
    apiFetch('/api/rooms/invitees', { schema: InviteeListSchema })
      .then((data) => {
        setPool(mergeByUserId(data.items));
      })
      .catch((err: unknown) => {
        const status = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined;
        setError(status === '401' ? 'Sign in to invite people.' : 'Could not load invitees.');
      });
  }

  const filtered = useMemo(() => {
    if (pool === null) return [];
    const q = query.trim().toLowerCase();
    if (q.length === 0) return pool;
    return pool.filter((p) => {
      if (p.displayName.toLowerCase().includes(q)) return true;
      if (p.handle?.toLowerCase().includes(q)) return true;
      if (p.companyName?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [pool, query]);

  // Mount-fetch: trigger the load as soon as the picker mounts (parent
  // only mounts inside the modal so this is "first render with the modal
  // open"). Doing it in `ensureLoaded()` instead keeps SSR + first-mount
  // states safe — the function is idempotent.
  if (pool === null && error === null) {
    ensureLoaded();
  }

  const selected = pool?.filter((p) => value.includes(p.userId)) ?? [];

  function toggle(userId: string) {
    if (value.includes(userId)) {
      onChange(value.filter((id) => id !== userId));
      return;
    }
    if (value.length >= max) {
      return;
    }
    onChange([...value, userId]);
  }

  function remove(userId: string) {
    onChange(value.filter((id) => id !== userId));
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="room-invitee-search" className="flex flex-col gap-2">
        <span className="text-eyebrow text-muted-foreground">
          From your network · Verified companies
        </span>
        <Input
          id="room-invitee-search"
          type="text"
          placeholder="Search by name, handle, or company"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {selected.map((p) => (
            <li key={p.userId}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => remove(p.userId)}
                className="h-7 gap-1.5 px-2 text-[11px]"
                aria-label={`Remove ${p.displayName}`}
              >
                <span className="font-medium">{p.displayName}</span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {sourceLabel(p.sources)}
                </span>
                <Trash2 aria-hidden="true" className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-background p-1">
        {pool === null ? (
          <li className="px-3 py-3 text-caption text-muted-foreground">
            {error ?? 'Loading invitees…'}
          </li>
        ) : filtered.length === 0 ? (
          <li className="px-3 py-3 text-caption text-muted-foreground">
            {query.length > 0 ? 'No matches.' : 'No one to invite yet.'}
          </li>
        ) : (
          filtered.map((p) => {
            const isSelected = value.includes(p.userId);
            return (
              <li key={p.userId}>
                <button
                  type="button"
                  onClick={() => toggle(p.userId)}
                  aria-pressed={isSelected}
                  disabled={!isSelected && value.length >= max}
                  className={
                    isSelected
                      ? 'flex w-full items-center gap-3 rounded-md border border-primary/40 bg-primary/[0.06] px-3 py-2 text-left text-sm transition-colors hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                      : 'flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50'
                  }
                >
                  <Avatar className="size-8 shrink-0">
                    <AvatarFallback className="bg-muted text-caption text-foreground/70">
                      {initials(p.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-foreground">{p.displayName}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {p.companyName ?? (p.handle !== null ? `@${p.handle}` : 'No company')}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-wider">
                    <SourceBadge sources={p.sources} />
                  </span>
                  {isSelected ? (
                    <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>

      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {value.length} of {max} picked
      </span>
    </div>
  );
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

function sourceLabel(sources: Source[]): string {
  if (sources.includes('NETWORK') && sources.includes('VERIFIED_COMPANY'))
    return 'Network · Verified';
  if (sources.includes('NETWORK')) return 'Network';
  return 'Verified';
}

function SourceBadge({ sources }: { sources: Source[] }) {
  if (sources.includes('NETWORK') && sources.includes('VERIFIED_COMPANY')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/[0.08] px-1.5 text-primary">
        <Users aria-hidden="true" className="size-3" />
        <span>Net+Verify</span>
      </span>
    );
  }
  if (sources.includes('NETWORK')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 text-muted-foreground">
        <Users aria-hidden="true" className="size-3" />
        <span>Network</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/[0.08] px-1.5 text-primary">
      <ShieldCheck aria-hidden="true" className="size-3" />
      <span>Verified</span>
    </span>
  );
}

function mergeByUserId(items: InviteeItem[]): MergedInvitee[] {
  const byUser = new Map<string, MergedInvitee>();
  for (const item of items) {
    const existing = byUser.get(item.userId);
    if (existing) {
      const sources = Array.from(new Set<Source>([...existing.sources, item.source]));
      byUser.set(item.userId, { ...existing, sources });
    } else {
      byUser.set(item.userId, { ...item, sources: [item.source] });
    }
  }
  return Array.from(byUser.values()).sort((a, b) => {
    // Network first (existing relationships), then verified, alpha within.
    const aRank = a.sources[0] === 'NETWORK' ? 0 : 1;
    const bRank = b.sources[0] === 'NETWORK' ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return a.displayName.localeCompare(b.displayName);
  });
}
