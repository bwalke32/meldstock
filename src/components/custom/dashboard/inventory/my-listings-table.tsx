// @polsia:user-owned — /dashboard/inventory client island. Lists the
// signed-in user's lots across every status, with per-row actions
// (refresh / edit qty / mark sold / deactivate) and a multi-select row +
// bulk-action bar above the table. Power-user texture: status badges,
// "last updated X ago" timestamp, and a deep link to the bulk uploader
// for >500-row inventory owners.
//
// Auth is enforced client-side via apiFetch — a 401 from any of the
// lifecycle endpoints surfaces as a toast and redirects to /login through
// the dashboard shell's `useEffect`. No direct mutations outside /api.
'use client';

import {
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api-client';
import { formatTimestamp, relativeAge } from '@/lib/business/lots';
import { type LotItem, type LotLifecycleStatus, LotList } from '@/lib/contracts/lots';
import { BulkLotsActionResponse } from '@/lib/contracts/lots-lifecycle';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: LotItem[] };

type BulkAction = 'refresh' | 'deactivate' | 'markSold';

const STATUS_BADGE: Record<
  LotLifecycleStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  ACTIVE: { label: 'Active', variant: 'default' },
  SOLD: { label: 'Sold', variant: 'secondary' },
  EXPIRED: { label: 'Expired', variant: 'destructive' },
  DEACTIVATED: { label: 'Deactivated', variant: 'outline' },
};

export function MyListingsTable({ focusId = null }: { focusId?: string | null }) {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [pendingBulk, setPendingBulk] = useState<BulkAction | null>(null);
  const [editing, setEditing] = useState<{ lot: LotItem } | null>(null);

  const refresh = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const rows = await apiFetch('/api/lots/mine', { schema: LotList });
      setState({ kind: 'ready', rows: rows.items });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = state.kind === 'ready' ? state.rows : [];
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && selected.size < rows.length;

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === rows.length) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  }, [rows]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handlePerRow = useCallback(
    async (id: string, route: string, label: string) => {
      setPendingRow(id);
      try {
        await apiFetch(route, { method: 'POST', body: JSON.stringify({}) });
        toast.success(`${label} done`);
        await refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setPendingRow(null);
      }
    },
    [refresh],
  );

  const handleEditQty = useCallback(
    async (remaining: number) => {
      if (!editing) return;
      const id = editing.lot.id;
      setPendingRow(id);
      try {
        await apiFetch(`/api/lots/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantityRemaining: remaining }),
        });
        toast.success('Quantity updated');
        setEditing(null);
        await refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setPendingRow(null);
      }
    },
    [editing, refresh],
  );

  const handleBulk = useCallback(
    async (action: BulkAction) => {
      if (selected.size === 0) return;
      setPendingBulk(action);
      try {
        const response = await apiFetch('/api/lots/bulk-lifecycle', {
          method: 'POST',
          body: JSON.stringify({
            ids: [...selected],
            action,
          }),
          schema: BulkLotsActionResponse,
        });
        toast.success(
          `${actionLabel(action)} done for ${response.updated} lot${response.updated === 1 ? '' : 's'}`,
        );
        if (response.skipped.length > 0) {
          toast.warning(
            `${response.skipped.length} row${response.skipped.length === 1 ? '' : 's'} skipped`,
          );
        }
        setSelected(new Set());
        await refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setPendingBulk(null);
      }
    },
    [refresh, selected],
  );

  // Surface the deep-link from a stale-nudge email — a `?focus=<lotId>`
  // query on /dashboard/inventory highlights that row so the recipient
  // doesn't have to scan the table.
  const focusedRowId = useMemo(() => {
    if (state.kind !== 'ready' || !focusId) return null;
    return rows.find((r) => r.id === focusId)?.id ?? null;
  }, [state, rows, focusId]);

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-h3 tracking-[-0.01em]">My listings</CardTitle>
            <CardDescription>
              Refresh to bump, mark sold, or deactivate. Select rows to bulk-edit.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/inventory/upload">
                <Download className="mr-1 h-4 w-4" />
                Bulk upload CSV
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
              disabled={state.kind === 'loading'}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              Reload
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.kind === 'loading' ? (
          <div className="flex items-center gap-2 p-6 text-body text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your listings…
          </div>
        ) : state.kind === 'error' ? (
          <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-6 text-body">
            <p className="font-medium text-destructive">Could not load your listings</p>
            <p className="break-all text-sm text-muted-foreground">{state.message}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <BulkActionBar
            selectedCount={selected.size}
            pending={pendingBulk}
            onRefresh={() => void handleBulk('refresh')}
            onDeactivate={() => void handleBulk('deactivate')}
            onMarkSold={() => void handleBulk('markSold')}
            onClear={() => setSelected(new Set())}
          />
        )}
        {state.kind === 'ready' && rows.length > 0 ? (
          <LotTable
            rows={rows}
            selected={selected}
            pendingRow={pendingRow}
            focusedRowId={focusedRowId}
            allSelected={allSelected}
            someSelected={someSelected}
            onToggleAll={toggleAll}
            onToggleOne={toggleOne}
            onRefresh={(id) => void handlePerRow(id, `/api/lots/${id}/refresh`, 'Refresh')}
            onMarkSold={(id) => void handlePerRow(id, `/api/lots/${id}/mark-sold`, 'Marked sold')}
            onDeactivate={(id) =>
              void handlePerRow(id, `/api/lots/${id}/deactivate`, 'Deactivated')
            }
            onConfirm={(id) =>
              void handlePerRow(
                id,
                `/api/lots/${id}/confirm-available`,
                'Marked as still available',
              )
            }
            onEdit={(lot) => setEditing({ lot })}
          />
        ) : null}
      </CardContent>
      <EditQuantityDialog
        editing={editing}
        pendingRow={pendingRow}
        onCancel={() => setEditing(null)}
        onSubmit={(remaining) => void handleEditQty(remaining)}
      />
    </Card>
  );
}

function BulkActionBar({
  selectedCount,
  pending,
  onRefresh,
  onDeactivate,
  onMarkSold,
  onClear,
  disabled,
}: {
  selectedCount: number;
  pending: BulkAction | null;
  onRefresh: () => void;
  onDeactivate: () => void;
  onMarkSold: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  if (selectedCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-300 bg-brand-50 p-3 text-body shadow-sm dark:border-brand-700 dark:bg-brand-950/40">
      <div className="flex items-center gap-2">
        <Badge variant="default">{selectedCount}</Badge>
        <span className="text-sm font-medium text-foreground">
          {selectedCount === 1 ? 'lot selected' : 'lots selected'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={disabled || pending !== null}
        >
          <RefreshCw className="mr-1 h-4 w-4" />
          Bulk refresh
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onMarkSold}
          disabled={disabled || pending !== null}
        >
          <CheckCircle2 className="mr-1 h-4 w-4" />
          Mark sold
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDeactivate}
          disabled={disabled || pending !== null}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Deactivate
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
        {pending ? (
          <span className="flex items-center gap-1 text-caption text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {actionLabel(pending)}…
          </span>
        ) : null}
      </div>
    </div>
  );
}

function LotTable({
  rows,
  selected,
  pendingRow,
  focusedRowId,
  allSelected,
  someSelected,
  onToggleAll,
  onToggleOne,
  onRefresh,
  onMarkSold,
  onDeactivate,
  onConfirm,
  onEdit,
}: {
  rows: LotItem[];
  selected: Set<string>;
  pendingRow: string | null;
  focusedRowId: string | null;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
  onToggleOne: (id: string) => void;
  onRefresh: (id: string) => void;
  onMarkSold: (id: string) => void;
  onDeactivate: (id: string) => void;
  onConfirm: (id: string) => void;
  onEdit: (lot: LotItem) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                // `indeterminate` is a DOM prop — Radix forwards it. We
                // can't read the prop back without a ref, so we rely on
                // the visual mid-state the browser applies.
                data-state={someSelected ? 'indeterminate' : allSelected ? 'checked' : 'unchecked'}
                onCheckedChange={onToggleAll}
                aria-label="Select all rows"
              />
            </TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="w-32">Status</TableHead>
            <TableHead className="w-28">Remaining</TableHead>
            <TableHead className="w-32">Last update</TableHead>
            <TableHead className="w-32 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((lot) => (
            <RowItem
              key={lot.id}
              lot={lot}
              isSelected={selected.has(lot.id)}
              isFocused={lot.id === focusedRowId}
              isPending={pendingRow === lot.id}
              onToggle={() => onToggleOne(lot.id)}
              onRefresh={() => onRefresh(lot.id)}
              onMarkSold={() => onMarkSold(lot.id)}
              onDeactivate={() => onDeactivate(lot.id)}
              onConfirm={() => onConfirm(lot.id)}
              onEdit={() => onEdit(lot)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RowItem({
  lot,
  isSelected,
  isFocused,
  isPending,
  onToggle,
  onRefresh,
  onMarkSold,
  onDeactivate,
  onConfirm,
  onEdit,
}: {
  lot: LotItem;
  isSelected: boolean;
  isFocused: boolean;
  isPending: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onMarkSold: () => void;
  onDeactivate: () => void;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  const badge = STATUS_BADGE[lot.status];
  return (
    <TableRow
      data-focused={isFocused ? 'true' : undefined}
      className={isFocused ? 'bg-brand-50 dark:bg-brand-950/30' : undefined}
    >
      <TableCell>
        <Checkbox checked={isSelected} onCheckedChange={onToggle} aria-label={`Select ${lot.id}`} />
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <Link
            href={`/lots/${lot.id}`}
            className="line-clamp-1 text-body font-medium text-foreground hover:underline"
          >
            {lotTitle(lot)}
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            L-{lot.id.slice(-6)} · {lot.type === 'HAVE' ? 'HAVE' : 'WANTED'} · {lot.polymer}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge label={badge.label} variant={badge.variant} lot={lot} />
      </TableCell>
      <TableCell className="font-mono text-sm text-foreground">
        {lot.quantityRemaining === '0' ? '—' : `${formatLbNumber(lot.quantityRemaining)} lb`}
      </TableCell>
      <TableCell className="text-caption text-muted-foreground">
        <div className="flex flex-col gap-0.5">
          <span>{relativeAge(lot.lastUpdatedAt)} ago</span>
          <span className="font-mono text-[10px]">{formatTimestamp(lot.lastUpdatedAt)}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <RowMenu
          lot={lot}
          isPending={isPending}
          onRefresh={onRefresh}
          onMarkSold={onMarkSold}
          onDeactivate={onDeactivate}
          onConfirm={onConfirm}
          onEdit={onEdit}
        />
      </TableCell>
    </TableRow>
  );
}

function RowMenu({
  lot,
  isPending,
  onRefresh,
  onMarkSold,
  onDeactivate,
  onConfirm,
  onEdit,
}: {
  lot: LotItem;
  isPending: boolean;
  onRefresh: () => void;
  onMarkSold: () => void;
  onDeactivate: () => void;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  const isFinal = lot.status === 'SOLD' || lot.status === 'DEACTIVATED';
  const isStale = lot.status === 'EXPIRED';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          aria-label={`Actions for ${lot.id}`}
        >
          <MoreHorizontal className="h-4 w-4" />
          <ChevronDown className="ml-1 h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!isFinal && !isStale ? (
          <DropdownMenuItem onSelect={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh (bump timestamp)
          </DropdownMenuItem>
        ) : null}
        {!isFinal ? (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="mr-2 h-4 w-4" /> Edit remaining quantity
          </DropdownMenuItem>
        ) : null}
        {isStale ? (
          <DropdownMenuItem onSelect={onConfirm}>
            <Eye className="mr-2 h-4 w-4" /> Mark as still available
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onMarkSold} disabled={lot.status === 'SOLD'}>
          <CheckCircle2 className="mr-2 h-4 w-4" /> Mark sold
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDeactivate} disabled={lot.status === 'DEACTIVATED'}>
          <Pause className="mr-2 h-4 w-4" /> Deactivate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/lots/${lot.id}`}>
            <EyeOff className="mr-2 h-4 w-4" /> View lot page
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusBadge({
  label,
  variant,
  lot,
}: {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  lot: LotItem;
}) {
  // Staleness tooltips on hover so a hovered badge hints at "refresh this
  // row" without cluttering the row.
  return (
    <div className="flex items-center gap-1">
      <Badge variant={variant}>{label}</Badge>
      {lot.status === 'EXPIRED' ? (
        <span className="font-mono text-[10px] uppercase tracking-wider text-destructive">
          idle 30+d
        </span>
      ) : null}
    </div>
  );
}

function EditQuantityDialog({
  editing,
  pendingRow,
  onCancel,
  onSubmit,
}: {
  editing: { lot: LotItem } | null;
  pendingRow: string | null;
  onCancel: () => void;
  onSubmit: (remaining: number) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (editing) {
      setValue(editing.lot.quantityRemaining);
      setError(null);
    }
  }, [editing]);
  const totalLb = useMemo(() => Number.parseFloat(editing?.lot.quantityLb ?? '0'), [editing]);
  const remaining = Number.parseFloat(value);
  const valid = Number.isFinite(remaining) && remaining >= 0 && (!editing || remaining <= totalLb);
  if (!editing) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit remaining quantity</DialogTitle>
          <DialogDescription>
            Total lot size: <span className="font-mono">{totalLb} lb</span>. Set the amount still
            offered — partial deals close by lowering this number.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="qty-remaining">Remaining (lb)</Label>
          <Input
            id="qty-remaining"
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          {error ? <p className="text-caption text-destructive">{error}</p> : null}
          {!valid && Number.isFinite(remaining) ? (
            <p className="text-caption text-destructive">
              Must be a non-negative number ≤ total lot size.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!valid || pendingRow !== null}
            onClick={() => {
              if (!valid) {
                setError('Enter a valid remaining quantity');
                return;
              }
              onSubmit(remaining);
            }}
          >
            {pendingRow !== null ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-border/60 bg-background p-6">
      <p className="text-body font-medium text-foreground">No listings yet</p>
      <p className="text-caption text-muted-foreground">
        Post a single lot from the trading floor or paste a CSV for bulk import.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/post-a-lot">Post a lot</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href="/dashboard/inventory/upload">Bulk upload CSV</Link>
        </Button>
      </div>
    </div>
  );
}

// Tiny helper — format a Decimal string into a thousands-separated lb label
// without dragging in a heavier formatter. The schema only stores fixed-
// precision numbers so this is safe.
function formatLbNumber(s: string): string {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function actionLabel(action: BulkAction): string {
  if (action === 'refresh') return 'Bulk refresh';
  if (action === 'markSold') return 'Mark sold';
  return 'Deactivate';
}

// Compact lot title: manufacturer · grade OR polymer · condition.
function lotTitle(lot: LotItem): string {
  const head = [lot.manufacturer, lot.grade].filter(Boolean).join(' ');
  if (head.length > 0) return head;
  return `${lot.polymer} · ${lot.condition}`;
}
