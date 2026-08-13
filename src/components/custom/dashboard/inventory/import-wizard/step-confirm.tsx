'use client';

// @polsia:user-owned — step 4 of the bulk-upload wizard. Confirmation
// card summarising the seller's choices and triggering the commit
// POST. Renders the importable row count, a "skip-list" summary, and
// affordances to export any skipped rows as CSV (so the seller can
// re-fix them in Excel).

import { CheckCircle2, Download, ExternalLink, FileDown, Loader2, X } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { CommitResponse, PreviewResponse } from '@/lib/contracts/inventory-bulk-upload';

export interface StepConfirmProps {
  preview: PreviewResponse;
  skipFlags: Record<string, boolean>;
  onCommit: () => void;
  onBack: () => void;
  // Result from a previous commit; null when the user is starting fresh.
  result: CommitResponse | null;
  committing: boolean;
}

export function StepConfirm({
  preview,
  skipFlags,
  onCommit,
  onBack,
  result,
  committing,
}: StepConfirmProps) {
  const validCount = useMemo(
    () => preview.rows.filter((r) => r.ok && !skipFlags[String(r.rowIndex)]).length,
    [preview.rows, skipFlags],
  );
  const errored = preview.rows.filter((r) => !r.ok);
  const skipped = preview.rows.filter((r) => r.ok && skipFlags[String(r.rowIndex)]);

  const exportSkippedCsv = useCallback(() => {
    const skippedAndErrored = preview.rows.filter((r) => !r.ok || skipFlags[String(r.rowIndex)]);
    if (skippedAndErrored.length === 0) return;
    // Build a CSV from the SOURCE columns the wizard knows about
    // (so the seller can paste it back into Excel for offline editing).
    const allHeaders = new Set<string>();
    for (const row of preview.rows) {
      for (const k of Object.keys(row.source)) allHeaders.add(k);
    }
    const headers = [...allHeaders];
    const escCsv = (v: string): string => {
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const lines = [
      headers.join(','),
      ...skippedAndErrored.map((row) => headers.map((h) => escCsv(row.source[h] ?? '')).join(',')),
    ];
    const csv = `${lines.join('\n')}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'skipped-rows.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [preview.rows, skipFlags]);

  if (result) {
    return <ResultPanel result={result} onBack={onBack} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-h3 tracking-[-0.01em]">Ready to import</CardTitle>
          <CardDescription>
            One final look before any rows are created. You can always reverse by deactivating or
            deleting rows from{' '}
            <a
              className="text-brand-700 dark:text-brand-300"
              href="/dashboard/inventory"
              target="_self"
            >
              My listings
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Tile label="Will create" value={validCount} tone="success" />
            <Tile label="Will skip (errors)" value={errored.length} tone="destructive" />
            <Tile label="Will skip (manual)" value={skipped.length} tone="muted" />
          </div>

          <Separator />

          <ul className="flex flex-col gap-2 text-body text-muted-foreground">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>
                New lots are stamped{' '}
                <span className="font-mono text-foreground">status=ACTIVE</span> so they appear on
                <span className="font-mono text-foreground">/trading-floor</span> immediately.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>
                The <span className="font-mono text-foreground">postedByUserId</span> is set to your
                account so the dashboard + lifecycle cron recognise ownership.
              </span>
            </li>
            {errored.length > 0 ? (
              <li className="flex items-start gap-2">
                <X className="mt-0.5 h-4 w-4 text-red-600 dark:text-red-400" />
                <span>
                  {errored.length} row(s) carry validation errors and will be skipped. Export them
                  below so you can fix in Excel and re-import.
                </span>
              </li>
            ) : null}
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={onCommit} disabled={committing || validCount === 0}>
              {committing ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 h-4 w-4" />
              )}
              {committing ? 'Importing…' : `Import ${validCount} row${validCount === 1 ? '' : 's'}`}
            </Button>
            <Button type="button" variant="outline" onClick={onBack} disabled={committing}>
              Back to preview
            </Button>
            {errored.length + skipped.length > 0 ? (
              <Button type="button" variant="ghost" onClick={exportSkippedCsv}>
                <FileDown className="mr-1 h-4 w-4" />
                Export skipped rows as CSV
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ResultPanel({ result, onBack }: { result: CommitResponse; onBack: () => void }) {
  const importedCount = result.imported.length;
  const skippedCount = result.skipped.length;
  return (
    <div className="flex flex-col gap-6">
      <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 shadow-sm">
        <CardHeader>
          <CardTitle className="text-h3 tracking-[-0.01em] text-emerald-900 dark:text-emerald-200">
            Import complete
          </CardTitle>
          <CardDescription>
            {importedCount} lot{importedCount === 1 ? '' : 's'} created
            {skippedCount > 0 ? ` · ${skippedCount} skipped` : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <Tile label="Created" value={importedCount} tone="success" />
            <Tile
              label="Skipped"
              value={skippedCount}
              tone={skippedCount > 0 ? 'destructive' : 'muted'}
            />
          </div>
          {result.imported.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-body">
              <p className="font-medium text-foreground">Where they show up</p>
              <p className="text-caption text-muted-foreground">
                New listings are live on the trading floor now. Open My listings to review or
                deactivate any one of them.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild variant="default" size="sm">
                  <a href="/dashboard/inventory" target="_self">
                    View my listings
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href="/trading-floor" target="_self">
                    Browse the floor
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>
          ) : null}
          {result.skipped.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-body">
              <p className="font-medium text-destructive">Skipped rows</p>
              <ul className="flex flex-col gap-1 text-caption text-foreground">
                {result.skipped.slice(0, 8).map((s) => (
                  <li key={s.rowIndex}>
                    Row {s.rowIndex}: <span className="text-muted-foreground">{s.message}</span>
                  </li>
                ))}
                {result.skipped.length > 8 ? (
                  <li className="text-muted-foreground">
                    +{result.skipped.length - 8} more (re-run the wizard to see them)
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href="/trading-floor" target="_self">
                <Download className="mr-1 h-3 w-3" />
                Back to trading floor
              </a>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>
              Import another file
            </Button>
          </div>
        </CardContent>
      </Card>
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
