'use client';

// @polsia:user-owned — step 3 of the bulk-upload wizard. Renders a
// per-row preview of the validation outcome, grouping by status
// (valid / errored). Invalid rows open an inline edit drawer so the
// seller can fix typos (e.g. "PBT" → "ABS") without re-reading the
// spreadsheet. The orchestrator owns the per-row edits; this step
// only renders and dispatches changes upstream.

import { AlertTriangle, Check, CheckCircle2, Loader2, Pencil, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CANONICAL_FIELD_LABEL,
  type CanonicalField,
} from '@/lib/business/inventory-bulk-upload/columns';
import type { PreviewResponse, PreviewRow } from '@/lib/contracts/inventory-bulk-upload';

export interface StepPreviewProps {
  preview: PreviewResponse;
  // Edits overlay keyed by row index (string per the wire contract).
  edits: Record<string, Partial<Record<CanonicalField, string>>>;
  // Rows the seller has explicitly marked to skip despite the server
  // accepting them. Maps row index (string) → bool.
  skipFlags: Record<string, boolean>;
  onEdit: (rowIndex: number, field: CanonicalField, value: string | null) => void;
  onSkip: (rowIndex: number, skipped: boolean) => void;
  onContinue: () => void;
  onBack: () => void;
  refreshing: boolean;
}

export function StepPreview({
  preview,
  edits,
  skipFlags,
  onEdit,
  onSkip,
  onContinue,
  onBack,
  refreshing,
}: StepPreviewProps) {
  const [editingRow, setEditingRow] = useState<PreviewRow | null>(null);

  const sortedRows = useMemo(
    () => [...preview.rows].sort((a, b) => a.rowIndex - b.rowIndex),
    [preview.rows],
  );

  const validCount = useMemo(
    () => preview.rows.filter((r) => r.ok && !skipFlags[String(r.rowIndex)]).length,
    [preview.rows, skipFlags],
  );
  const readyToImport = validCount > 0;

  return (
    <div className="flex flex-col gap-6">
      <SummaryStrip preview={preview} validCount={validCount} />

      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-h3 tracking-[-0.01em]">Preview rows</CardTitle>
              <CardDescription>
                Click any row to fix typos inline. Use the skip toggle to keep an otherwise-valid
                row out of the import.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                Back to mapping
              </Button>
              <Button type="button" size="sm" onClick={onContinue} disabled={!readyToImport}>
                <Check className="mr-1 h-4 w-4" />
                Continue to import ({validCount})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-24 text-center">In import?</TableHead>
                  <TableHead className="w-28 text-right">Fix</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((row) => {
                  const skip = !!skipFlags[String(row.rowIndex)];
                  const willImport = row.ok && !skip;
                  return (
                    <TableRow key={row.rowIndex}>
                      <TableCell className="font-mono text-caption">{row.rowIndex}</TableCell>
                      <TableCell>
                        {row.ok ? (
                          willImport ? (
                            <Badge variant="default">
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              Valid
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <X className="mr-1 h-3 w-3" />
                              Skipped
                            </Badge>
                          )
                        ) : (
                          <Badge variant="destructive">
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            Error
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <RowSummary row={row} />
                        {!row.ok ? (
                          <ul className="mt-1 flex flex-col gap-0.5 text-caption text-destructive">
                            {row.errors.map((e, i) => (
                              <li key={`${row.rowIndex}-${e.field}-${i}`}>
                                <span className="font-mono">{e.field}</span>: {e.message}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <ResolvedAsBadge row={row} />
                      </TableCell>
                      <TableCell className="text-center">
                        <label className="inline-flex cursor-pointer items-center gap-2 text-caption">
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={willImport}
                            disabled={!row.ok}
                            onChange={(e) => onSkip(row.rowIndex, !e.target.checked)}
                          />
                          <span
                            aria-hidden
                            className="inline-block size-4 rounded border border-border bg-background transition peer-checked:border-brand-500 peer-checked:bg-brand-500 peer-disabled:cursor-not-allowed peer-disabled:opacity-40"
                          />
                          <span className="text-muted-foreground">{willImport ? 'Yes' : 'No'}</span>
                        </label>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingRow(row)}
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {refreshing ? (
            <p className="mt-3 flex items-center gap-1 text-caption text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Re-validating…
            </p>
          ) : null}
        </CardContent>
      </Card>

      <EditRowDialog
        row={editingRow}
        edits={editingRow ? (edits[String(editingRow.rowIndex)] ?? {}) : {}}
        onClose={() => setEditingRow(null)}
        onChange={(field, value) => {
          if (!editingRow) return;
          onEdit(editingRow.rowIndex, field, value);
        }}
      />
    </div>
  );
}

function SummaryStrip({ preview, validCount }: { preview: PreviewResponse; validCount: number }) {
  const { total, errored } = preview.summary;
  const skippedCount = total - validCount - errored;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      <Tile label="Total" value={total} tone="muted" />
      <Tile
        label="Will import"
        value={validCount}
        tone="success"
        icon={<CheckCircle2 className="h-4 w-4" />}
      />
      <Tile
        label="Errored"
        value={errored}
        tone="destructive"
        icon={<AlertTriangle className="h-4 w-4" />}
      />
      <Tile label="Manually skipped" value={Math.max(0, skippedCount)} tone="muted" />
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'muted' | 'success' | 'destructive';
  icon?: React.ReactNode;
}) {
  const palette =
    tone === 'success'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
      : tone === 'destructive'
        ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200'
        : 'border-border bg-card text-foreground';
  return (
    <div className={`flex flex-col gap-1 rounded-md border px-3 py-2 ${palette}`}>
      <span className="font-mono text-[10px] uppercase tracking-wider opacity-80">
        {label}
        {icon ? <span className="ml-1 inline-flex align-middle">{icon}</span> : null}
      </span>
      <span className="font-display text-h3 leading-none">{value}</span>
    </div>
  );
}

function RowSummary({ row }: { row: PreviewRow }) {
  const head = [row.values.manufacturer, row.values.grade].filter(Boolean).join(' ');
  const title =
    head.length > 0 ? head : `${row.values.polymer ?? '—'} · ${row.values.condition ?? '—'}`;
  const bits = [row.values.polymer, row.values.quantity, row.values.unit, row.values.country]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-body font-medium text-foreground">{title}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {bits || '— no values —'}
      </span>
    </div>
  );
}

// Resolved-as badge — surfaces the canonicalisation the server would
// persist so the trader confirms the resolution BEFORE commit (the
// brief: "PCFR → PC" / "BK → Black" should be visible at preview time
// so the seller can override from the inline drawer). Only renders
// when the resolved value differs from the mapped value the seller
// typed — otherwise the mapzel sees no badge drift.
function ResolvedAsBadge({ row }: { row: PreviewRow }) {
  const { polymer: normPolymer, grade: normGrade, color: normColor } = row.normalized;
  const mappedPolymer = (row.values.polymer ?? '').toUpperCase();
  const mappedGrade = (row.values.grade ?? '').trim();
  const mappedColor = (row.values.color ?? '').trim();

  const bits: string[] = [];
  if (normPolymer && normPolymer.toUpperCase() !== mappedPolymer) {
    bits.push(`polymer → ${normPolymer}`);
  }
  if (normGrade !== null && normGrade.toUpperCase() !== mappedGrade.toUpperCase()) {
    bits.push(
      `grade → "${normGrade.length > 0 ? normGrade : '∅ (lifted into glass/color/variant)'}"`,
    );
  }
  if (normColor && normColor.toUpperCase() !== mappedColor.toUpperCase()) {
    bits.push(`color → ${normColor}`);
  }
  if (bits.length === 0) return null;
  return (
    <Badge
      variant="outline"
      className="mt-1 inline-flex items-center gap-1 border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary"
      aria-label={`Resolved as: ${bits.join(', ')}`}
    >
      Resolved: {bits.join(' · ')}
    </Badge>
  );
}

function EditRowDialog({
  row,
  edits,
  onClose,
  onChange,
}: {
  row: PreviewRow | null;
  edits: Partial<Record<CanonicalField, string>>;
  onClose: () => void;
  onChange: (field: CanonicalField, value: string | null) => void;
}) {
  if (!row) return null;
  // Editable fields: every canonical the row carries a value for OR a
  // canonical that was flagged as missing in errors. We render the
  // protected set: type, polymer, condition, grade, quantity, unit,
  // askingPricePerLb, packaging, form, color, country.
  const EDITABLE: CanonicalField[] = [
    'type',
    'polymer',
    'condition',
    'grade',
    'manufacturer',
    'quantity',
    'unit',
    'askingPricePerLb',
    'packaging',
    'form',
    'color',
    'country',
    'location',
    'notes',
    'visibility',
    'lotReference',
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit row {row.rowIndex}</DialogTitle>
          <DialogDescription>
            Changes here override the sheet values for this row only. Empty out a field to let the
            auto-mapped value stand.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {EDITABLE.map((field) => {
            const override = edits[field];
            const base = row.values[field] ?? '';
            const value = override !== undefined ? override : base;
            return (
              <div key={field} className="grid gap-1">
                <Label className="text-caption" htmlFor={`edit-${field}`}>
                  {CANONICAL_FIELD_LABEL[field]}
                </Label>
                {field === 'type' ? (
                  <Select
                    value={value || 'HAVE'}
                    onValueChange={(v) => onChange(field, v as string)}
                  >
                    <SelectTrigger id={`edit-${field}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="HAVE">HAVE</SelectItem>
                        <SelectItem value="WANTED">WANTED</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`edit-${field}`}
                    value={value ?? ''}
                    onChange={(e) => onChange(field, e.target.value || null)}
                  />
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
