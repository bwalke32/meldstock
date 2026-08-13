// @polsia:user-owned — client island for /dashboard/saved-searches.
//
// Lists every saved search the signed-in user owns. Each row exposes:
//
//   - filter chips (polymer / condition / grade / form / color / q / quantity
//     range / location) plus createdAt + lastAlertSentAt stamps,
//   - live matchCount,
//   - a Switch toggle for alerting (flips fan-out on/off),
//   - Edit (in-place, opens a Dialog with the same chip-style editor the
//     /lots sidebar uses),
//   - Delete (Popover-confirmed, optimistic),
//   - a /lots link carrying the saved filter so the user can verify the
//     search still matches what they want.
//
// Anonymous callers are redirected to /login (the dashboard shell already
// gates this, but having the belt-and-braces belt inside this island covers
// the brief transition state where useSession resolves before the shell
// effect fires). Mutations dispatch a `saved-searches:invalidate` window
// event so the dashboard overview's card re-fetches after a toggle/edit/
// delete from another surface.
'use client';

import { AlertTriangle, Bookmark, ChevronRight, Loader2, Pencil, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DashboardCard } from '@/components/custom/dashboard/dashboard-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import { CONDITION_LABELS, POLYMER_LABELS, relativeAge } from '@/lib/business/lots';
import type { LotCondition, Polymer } from '@/lib/contracts/lots';
import { type LotFilter, lotFilterToParams } from '@/lib/contracts/lots-filters';
import {
  SavedSearch,
  SavedSearchList,
  type SavedSearchUpdate,
} from '@/lib/contracts/saved-searches';

const INVALIDATE_EVENT = 'saved-searches:invalidate';
const POLYMER_KEYS = Object.keys(POLYMER_LABELS) as Polymer[];
const CONDITION_KEYS = Object.keys(CONDITION_LABELS) as LotCondition[];

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: SavedSearch[] };

export function SavedSearchesManager() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [editing, setEditing] = useState<SavedSearch | null>(null);

  // Redirect anonymous visitors — the dashboard shell already does this, but
  // having the belt here covers the brief transition state where useSession
  // resolves before the shell effect fires.
  useEffect(() => {
    if (isPending) return;
    if (!session?.user) router.replace('/login');
  }, [isPending, router, session?.user]);

  const refresh = useCallback(async () => {
    try {
      // Explicit SavedSearchList.parse() at the boundary — apiFetch's
      // `?schema` shape uses ZodType<T> and would otherwise bind T to the
      // INPUT shape (a SavedSearchList of `items: maybe-missing-fields`),
      // not the OUTPUT state shape we render.
      const raw = await apiFetch('/api/saved-searches');
      const items = SavedSearchList.parse(raw).items;
      setState({ kind: 'ready', items });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (/\(401\)/.test(message)) {
        router.replace('/login');
        return;
      }
      setState({ kind: 'error', message });
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Peer islands (the dashboard overview's SavedSearchesCard in particular)
  // shouldn't have to re-mount just because a toggle/edit/delete happened
  // here. Fire a window event identical in shape to the notifications
  // pattern so the listeners stay symmetrical.
  const fireInvalidate = useCallback(() => {
    window.dispatchEvent(new Event(INVALIDATE_EVENT));
  }, []);

  const handleToggle = useCallback(
    async (id: string, next: boolean) => {
      // Optimistic flip — revert on failure.
      setState((prev) => {
        if (prev.kind !== 'ready') return prev;
        return {
          kind: 'ready',
          items: prev.items.map((s) => (s.id === id ? { ...s, alertEnabled: next } : s)),
        };
      });
      try {
        const body: SavedSearchUpdate = { alertEnabled: next };
        await apiFetch(`/api/saved-searches/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        fireInvalidate();
      } catch (err: unknown) {
        // Roll back the optimistic flip and surface the failure.
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          return {
            kind: 'ready',
            items: prev.items.map((s) => (s.id === id ? { ...s, alertEnabled: !next } : s)),
          };
        });
        toast.error(`Couldn’t ${next ? 'enable' : 'disable'} alerts: ${errorMessage(err)}`);
      }
    },
    [fireInvalidate],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const snapshot = state.kind === 'ready' ? state.items : [];
      setState((prev) => {
        if (prev.kind !== 'ready') return prev;
        return { kind: 'ready', items: prev.items.filter((s) => s.id !== id) };
      });
      try {
        await apiFetch(`/api/saved-searches/${id}`, { method: 'DELETE' });
        toast.success('Saved search removed');
        fireInvalidate();
      } catch (err: unknown) {
        // Restore the row on failure.
        setState({ kind: 'ready', items: snapshot });
        toast.error(`Couldn’t delete: ${errorMessage(err)}`);
      }
    },
    [fireInvalidate, state],
  );

  const handleEditSaved = useCallback(
    async (id: string, update: SavedSearchUpdate) => {
      try {
        const updated = await apiFetch<SavedSearch>(`/api/saved-searches/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(update),
        });
        const next = SavedSearch.parse(updated);
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          return {
            kind: 'ready',
            items: prev.items.map((s) => (s.id === id ? next : s)),
          };
        });
        toast.success('Saved search updated');
        setEditing(null);
        fireInvalidate();
      } catch (err: unknown) {
        toast.error(`Couldn’t save: ${errorMessage(err)}`);
      }
    },
    [fireInvalidate],
  );

  if (state.kind === 'loading' || isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="flex flex-col items-start gap-4 p-6">
          <div className="flex items-center gap-2 text-foreground">
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
            <h2 className="text-h4 leading-tight">Couldn’t load your saved searches</h2>
          </div>
          <p className="text-body text-muted-foreground">{state.message}</p>
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader />
      {state.items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-4">
          {state.items.map((s) => (
            <li key={s.id}>
              <SavedSearchRow
                search={s}
                onToggle={(next) => void handleToggle(s.id, next)}
                onEdit={() => setEditing(s)}
                onDelete={() => void handleDelete(s.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <EditDialog
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={(update) => void handleEditSaved(editing.id, update)}
        />
      ) : null}
    </div>
  );
}

function PageHeader() {
  return (
    <header className="flex flex-col gap-2">
      <span className="text-eyebrow">Saved searches</span>
      <h1 className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground">
        Your watch list
      </h1>
      <p className="max-w-2xl text-body text-muted-foreground">
        Filter sets you saved on{' '}
        <Link
          href="/lots"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          /lots
        </Link>{' '}
        — toggle alerts off when one gets noisy, edit it in place, or jump straight back to{' '}
        <Link
          href="/lots"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          /lots
        </Link>{' '}
        with the saved filter re-applied.
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button asChild variant="default" size="sm">
          <Link href="/lots">
            <Bookmark className="mr-1 h-3 w-3" />
            New search on /lots
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">← Back to dashboard</Link>
        </Button>
      </div>
    </header>
  );
}

function EmptyState() {
  return (
    <DashboardCard
      title="No saved searches yet"
      description="Save a filter set on /lots and it will show up here — toggle alerts, edit, or delete without touching the rest of your watch list."
      action={
        <Button asChild variant="default" size="sm">
          <Link href="/lots">
            Open /lots → <ChevronRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      }
    >
      <p className="text-body text-muted-foreground">
        Filter by polymer, condition, quantity, or location — then hit{' '}
        <span className="font-mono text-foreground">Save this search</span>.
      </p>
    </DashboardCard>
  );
}

interface SavedSearchRowProps {
  search: SavedSearch;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function SavedSearchRow({ search, onToggle, onEdit, onDelete }: SavedSearchRowProps) {
  // Single build — three call sites need the same query string so we
  // serialise once and thread the result.
  const params = lotFilterToParams(search.filter).toString();
  const lotsHref = params.length > 0 ? `/lots?${params}` : '/lots';
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate font-display text-h4 leading-tight tracking-tight text-foreground">
            {search.name}
          </h2>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Saved <RelativeStamp iso={search.createdAt} /> ·{' '}
            <StampLabel iso={search.lastAlertSentAt} prefix="last alert" />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={lotsHref}
            className="font-mono text-[10px] uppercase tracking-wider text-primary underline-offset-4 hover:underline"
          >
            {search.matchCount} {search.matchCount === 1 ? 'match' : 'matches'}
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href={lotsHref}>
              View on /lots
              <ChevronRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      <Link
        href={lotsHref}
        className="block rounded-md border border-dashed border-border/60 bg-background p-3 transition-colors hover:bg-secondary/40"
        aria-label={`Open saved search "${search.name}" on /lots`}
      >
        <FilterChips filter={search.filter} />
      </Link>

      <Separator />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={search.alertEnabled}
            onCheckedChange={(next) => onToggle(next)}
            id={`alerts-${search.id}`}
            aria-label={`Toggle alerts for ${search.name}`}
          />
          <Label
            htmlFor={`alerts-${search.id}`}
            className="cursor-pointer text-[11px] font-mono uppercase tracking-wider text-muted-foreground"
          >
            {search.alertEnabled ? 'Alerts on' : 'Alerts muted'}
          </Label>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="mr-1 h-3 w-3" />
            Edit
          </Button>
          <DeletePopover onConfirm={onDelete} name={search.name} />
        </div>
      </div>
    </article>
  );
}

interface ChipDescriptor {
  label: string;
  title?: string;
  // Stable React key — combines the chip's source axis (so polymer "Other"
  // and condition "Other" can't collide on the same label) and the value.
  key: string;
}

function FilterChips({ filter }: { filter: LotFilter }) {
  const chips: ChipDescriptor[] = [];
  if (filter.type !== 'ALL') {
    chips.push({ label: filter.type === 'WANTED' ? 'WANTED' : 'HAVE', key: `type:${filter.type}` });
  }
  for (const key of filter.polymers) {
    chips.push({ label: POLYMER_LABELS[key] ?? key, title: 'Polymer', key: `polymer:${key}` });
  }
  for (const key of filter.conditions) {
    chips.push({
      label: CONDITION_LABELS[key] ?? key,
      title: 'Condition',
      key: `condition:${key}`,
    });
  }
  if (filter.form) chips.push({ label: `form: ${filter.form}`, key: `form:${filter.form}` });
  if (filter.grade) chips.push({ label: `grade: ${filter.grade}`, key: `grade:${filter.grade}` });
  if (filter.color) chips.push({ label: `color: ${filter.color}`, key: `color:${filter.color}` });
  if (filter.q) chips.push({ label: `q: “${filter.q}”`, key: `q:${filter.q}` });
  if (filter.quantityMin !== null || filter.quantityMax !== null) {
    const lo = filter.quantityMin ?? 0;
    const hi = filter.quantityMax ?? '∞';
    chips.push({
      label: `${formatLocNumber(lo)}–${hi} lb`,
      key: `quantity:${lo}-${hi}`,
    });
  }
  if (filter.location)
    chips.push({ label: `loc: ${filter.location}`, key: `location:${filter.location}` });
  if (chips.length === 0) {
    return (
      <p className="text-[11px] italic text-muted-foreground">Broad search (no filters set)</p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <li key={chip.key} title={chip.title} className={chipClass(true)}>
          {chip.label}
        </li>
      ))}
    </ul>
  );
}

function DeletePopover({ onConfirm, name }: { onConfirm: () => void; name: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Delete saved search ${name}`}>
          <Trash2 className="mr-1 h-3 w-3" />
          Delete
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <p className="text-body font-medium text-foreground">Delete “{name}”?</p>
          <p className="text-caption text-muted-foreground">
            The row is removed from your watch list. You can re-save it from /lots at any time.
          </p>
          <div className="flex items-center justify-end gap-2">
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </PopoverTrigger>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onConfirm}
              aria-label={`Confirm delete ${name}`}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Delete
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface EditDialogProps {
  initial: SavedSearch;
  onSave: (update: SavedSearchUpdate) => void;
  onCancel: () => void;
}

// Edit dialog — composes the same chip-style primitives the /lots sidebar
// uses (polymer multi-select chips, condition checkboxes, text inputs for
// grade/form/location), so the saved-search editor and the /lots editor
// always look like the same component family.
function EditDialog({ initial, onSave, onCancel }: EditDialogProps) {
  const [name, setName] = useState(initial.name);
  const [filter, setFilter] = useState<LotFilter>(initial.filter);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Independent local slider state — kept in lb so the user gets a real
  // numeric readout, but committed as nulls on both ends when the thumb
  // reaches the extreme so the resulting filter binds empty ("any
  // quantity") instead of narrowing to a 0–200000 lb range.
  const [quantityRange, setQuantityRange] = useState<[number, number]>(() => [
    initial.filter.quantityMin ?? 0,
    initial.filter.quantityMax ?? 200_000,
  ]);
  const quantityDirty = quantityRange[0] !== 0 || quantityRange[1] !== 200_000;

  const handleSave = async () => {
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('A name helps you recognise this search later.');
      return;
    }
    setPending(true);
    try {
      // Collapse the slider's 0…max extremes to null on both ends so a
      // brand-new filter (or one the user reset) doesn't carry a bogus
      // hard-coded range into the saved row.
      const nextFilter: LotFilter = {
        ...filter,
        quantityMin: quantityDirty ? quantityRange[0] : null,
        quantityMax: quantityDirty ? quantityRange[1] : null,
      };
      onSave({ name: trimmed, filter: nextFilter });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit saved search</DialogTitle>
          <DialogDescription>
            Rename it or shift the filter set without losing your alert history.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`name-${initial.id}`} className="text-[11px]">
              Name
            </Label>
            <Input
              id={`name-${initial.id}`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="North America PP, food-grade lots…"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-medium text-foreground">Lot type</span>
            <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
              <legend className="sr-only">Lot type</legend>
              {(['ALL', 'HAVE', 'WANTED'] as const).map((value) => {
                const active = filter.type === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter({ ...filter, type: value })}
                    aria-pressed={active}
                    className={chipClass(active)}
                  >
                    {value}
                  </button>
                );
              })}
            </fieldset>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-medium text-foreground">Polymer</span>
            <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
              <legend className="sr-only">Polymer</legend>
              {POLYMER_KEYS.map((key) => {
                const active = filter.polymers.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setFilter({
                        ...filter,
                        polymers: active
                          ? filter.polymers.filter((p) => p !== key)
                          : [...filter.polymers, key],
                      })
                    }
                    aria-pressed={active}
                    className={chipClass(active)}
                  >
                    {POLYMER_LABELS[key]}
                  </button>
                );
              })}
            </fieldset>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-medium text-foreground">Condition</span>
            <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
              <legend className="sr-only">Condition</legend>
              {CONDITION_KEYS.map((key) => {
                const active = filter.conditions.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setFilter({
                        ...filter,
                        conditions: active
                          ? filter.conditions.filter((c) => c !== key)
                          : [...filter.conditions, key],
                      })
                    }
                    aria-pressed={active}
                    className={chipClass(active)}
                  >
                    {CONDITION_LABELS[key]}
                  </button>
                );
              })}
            </fieldset>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`form-${initial.id}`} className="text-[11px]">
                Form
              </Label>
              <Input
                id={`form-${initial.id}`}
                type="text"
                value={filter.form}
                onChange={(e) => setFilter({ ...filter, form: e.target.value })}
                placeholder="pellets, regrind…"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`grade-${initial.id}`} className="text-[11px]">
                Grade
              </Label>
              <Input
                id={`grade-${initial.id}`}
                type="text"
                value={filter.grade}
                onChange={(e) => setFilter({ ...filter, grade: e.target.value })}
                placeholder="Sabic 800, MFI 12…"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`color-${initial.id}`} className="text-[11px]">
                Color
              </Label>
              <Input
                id={`color-${initial.id}`}
                type="text"
                value={filter.color}
                onChange={(e) => setFilter({ ...filter, color: e.target.value })}
                placeholder="natural, black…"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`location-${initial.id}`} className="text-[11px]">
                Location
              </Label>
              <Input
                id={`location-${initial.id}`}
                type="text"
                value={filter.location}
                onChange={(e) => setFilter({ ...filter, location: e.target.value })}
                placeholder="Houston, Rotterdam…"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-foreground">Quantity (lb)</span>
              <span className="font-mono text-[10px] text-foreground">
                {quantityDirty ? `${formatLocNumber(quantityRange[0])}–${quantityRange[1]}` : 'any'}
              </span>
            </div>
            <Slider
              min={0}
              max={200_000}
              step={1_000}
              value={quantityRange}
              onValueChange={(v) => setQuantityRange([v[0] ?? 0, v[1] ?? 200_000])}
              aria-label="Quantity range in pounds"
            />
            <p className="text-[10px] italic text-muted-foreground">
              Sliding both extremes to the ends resets the filter to "any quantity".
            </p>
          </div>

          {error ? <p className="text-caption text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant="default" onClick={handleSave} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Save className="mr-1 h-3 w-3" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RelativeStamp({ iso }: { iso: string }) {
  const age = relativeAge(iso);
  return (
    <time dateTime={iso} title={iso} className="tabular-nums">
      {age ? `${age} ago` : iso}
    </time>
  );
}

function StampLabel({ iso, prefix }: { iso: string | null; prefix: string }) {
  if (iso === null || !iso) {
    return <span className="italic">{prefix}: never</span>;
  }
  const age = relativeAge(iso);
  return (
    <time dateTime={iso} title={iso} className="tabular-nums">
      {prefix}: {age ? `${age} ago` : iso}
    </time>
  );
}

// Local chipClass — mirrors lots-filter-sidebar.tsx (intentional duplication;
// the plan says copy-paste, don't fork a shared primitive). Round chips
// intentionally chosen to read as "this filter is on" not "click me".
function chipClass(active: boolean): string {
  return [
    'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
    active
      ? 'border-primary/60 bg-primary/15 text-primary'
      : 'border-border bg-background text-muted-foreground hover:bg-muted/40',
  ].join(' ');
}

function formatLocNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Surface the (HTTP code) prefix apiFetch attaches on the message but
    // strip it — the toast already says "Couldn't …" inline.
    return err.message.replace(/\s*\(\d+\)\s*$/, '').trim() || err.message;
  }
  return String(err);
}
