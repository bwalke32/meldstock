// @polsia:user-owned — /dashboard/inventory/upload client island. Lets a
// signed-in seller paste or upload a single CSV; POSTs the raw text to
// /api/lots/bulk and renders a green/red per-row results table + a summary
// strip (created / errored / total). Two input paths: a `.csv` file picker
// for the Excel/Sheets flow, and a paste textarea for everyone else.
//
// Server column convention is imported from `@/lib/csv/lots` so the
// displayed list and the server-side validator can't drift — when the
// contract changes in one file, the page surfaces the change immediately.
'use client';

import { CheckCircle2, Download, Loader2, Upload, XCircle } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import {
  type BulkLotsResponse,
  BulkLotsResponse as BulkLotsResponseSchema,
} from '@/lib/contracts/lots-bulk';
import {
  LOT_CSV_ALL_COLUMNS,
  LOT_CSV_OPTIONAL_COLUMNS,
  LOT_CSV_REQUIRED_COLUMNS,
} from '@/lib/csv/lots';

const SAMPLE_CSV = `${LOT_CSV_ALL_COLUMNS.join(',')}
have,ABS,PRIME_VIRGIN,LG ABS-121H,1000,2.40,USA,Black,Pellets,Supersacks
wanted,PC,REGRIND_GRANULATED,Makrolon 2458,500,3.10,Mexico,Natural,Regrind,Octabins
have,PE_HDPE,POST_CONSUMER,,750,,Canada,Mixed,Flake,Bales
`;

type ViewState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; response: BulkLotsResponse };

export function CsvUploadClient() {
  const [csvText, setCsvText] = useState('');
  const [state, setState] = useState<ViewState>({ kind: 'idle' });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 1024 * 1024) {
      // Mirror the server's body cap (1 MB) so we never blow up on a 50 MB
      // accidental upload — surface as a toast and don't touch the textarea.
      toast.error('CSV exceeds the 1 MB limit');
      return;
    }
    try {
      const text = await file.text();
      setCsvText(text);
    } catch {
      toast.error('Could not read the file');
    }
  }, []);

  const submit = useCallback(async () => {
    if (csvText.trim().length === 0) {
      toast.error('Paste or upload a CSV first');
      return;
    }
    setState({ kind: 'submitting' });
    try {
      const response = await apiFetch('/api/lots/bulk', {
        method: 'POST',
        body: JSON.stringify({ csv: csvText }),
        schema: BulkLotsResponseSchema,
      });
      setState({ kind: 'ready', response });
      toast.success(`${response.summary.created} of ${response.summary.total} lots created`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
      toast.error(message);
    }
  }, [csvText]);

  const lineCount = countDataLines(csvText);
  const overCap = lineCount > 500 && csvText.trim().length > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-gradient-to-br from-brand-100 via-card to-card p-6 shadow-md md:p-8">
        <span className="text-eyebrow">Power user</span>
        <h1 className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground">
          Bulk upload lots
        </h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          Paste or drop a single CSV — up to 500 rows per batch. We validate every row against the
          listing spec sheet, persist the good ones, and hand back a green/red results table so you
          can see exactly which row tripped the parser.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`}
              download="lots-template.csv"
            >
              <Download className="mr-1 h-3 w-3" />
              Download template
            </a>
          </Button>
        </div>
      </header>

      <ColumnConventionCard />

      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-h4 tracking-tight">Your CSV</CardTitle>
          <CardDescription>
            File upload or paste — both paths send the same bytes to{' '}
            <span className="font-mono text-foreground">/api/lots/bulk</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-2">
            <Label htmlFor="csv-file">Upload a .csv file</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                ref={fileInputRef}
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
                className="max-w-md"
              />
              <span className="text-caption text-muted-foreground">
                {lineCount > 0
                  ? `${lineCount} data row${lineCount === 1 ? '' : 's'} loaded`
                  : 'No rows loaded yet'}
                {overCap ? ' — over the 500-row cap' : ''}
              </span>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="csv-paste">…or paste rows directly</Label>
            <Textarea
              id="csv-paste"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={`${LOT_CSV_REQUIRED_COLUMNS.join(',')}\nhave,PET,PRIME_VIRGIN,Resin X,1000,1.85,USA,Clear,Pellets,Supersacks`}
              rows={10}
              spellCheck={false}
              className="font-mono text-[12px]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={state.kind === 'submitting' || csvText.trim().length === 0 || overCap}
            >
              {state.kind === 'submitting' ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1 h-4 w-4" />
              )}
              Upload {lineCount > 0 ? `${lineCount} row${lineCount === 1 ? '' : 's'}` : 'CSV'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCsvText('');
                setState({ kind: 'idle' });
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              disabled={state.kind === 'submitting'}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <ResultsPanel state={state} />
    </div>
  );
}

function ColumnConventionCard() {
  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader>
        <CardTitle className="text-h4 tracking-tight">Column convention</CardTitle>
        <CardDescription>
          Required columns must be the header row. Optional columns default sensibly when omitted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <ConventionList title="Required" tone="brand" columns={LOT_CSV_REQUIRED_COLUMNS} />
          <ConventionList title="Optional" tone="muted" columns={LOT_CSV_OPTIONAL_COLUMNS} />
        </div>
        <Separator />
        <details className="text-caption text-muted-foreground">
          <summary className="cursor-pointer text-body font-medium text-foreground">
            Unit + format notes
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            <p>
              <span className="font-mono text-foreground">qty_kg</span> — kilograms; converted to lb
              on import (× 2.20462).
            </p>
            <p>
              <span className="font-mono text-foreground">price_usd_per_kg</span> — USD per
              kilogram; moved to USD per lb. Leave blank to post without a price.
            </p>
            <p>
              <span className="font-mono text-foreground">visibility</span> — defaults to{' '}
              <span className="font-mono text-foreground">verified_companies</span>. Accepts{' '}
              <span className="font-mono text-foreground">public</span>,{' '}
              <span className="font-mono text-foreground">my_network</span>,{' '}
              <span className="font-mono text-foreground">anonymous</span>.
            </p>
            <p>
              <span className="font-mono text-foreground">posted_by_name</span> — falls back to your
              account name when omitted.
            </p>
            <p>
              <span className="font-mono text-foreground">selected_companies</span> — cannot be
              expressed per bulk row (needs a recipient list); create that listing via the
              single-listing form.
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function ConventionList({
  title,
  columns,
  tone,
}: {
  title: string;
  columns: readonly string[];
  tone: 'brand' | 'muted';
}) {
  return (
    <div className="flex flex-col gap-2">
      <span
        className={
          tone === 'brand'
            ? 'font-mono text-[10px] uppercase tracking-wider text-brand-700 dark:text-brand-300'
            : 'font-mono text-[10px] uppercase tracking-wider text-muted-foreground'
        }
      >
        {title}
      </span>
      <ul className="flex flex-col gap-1 rounded-md border border-border/60 bg-background p-3 font-mono text-[12px] text-foreground">
        {columns.map((col) => (
          <li key={col} className="flex items-center justify-between gap-2">
            <span>{col}</span>
            {col === 'posted_by_name' ? (
              <span className="text-caption text-muted-foreground">optional fallback</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultsPanel({ state }: { state: ViewState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'submitting') {
    return (
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="flex items-center gap-3 p-6 text-body text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Validating rows and persisting valid lots…
        </CardContent>
      </Card>
    );
  }
  if (state.kind === 'error') {
    return (
      <Card className="border-destructive/40 bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-h4 tracking-tight text-destructive">Upload failed</CardTitle>
        </CardHeader>
        <CardContent className="text-body text-foreground">
          <p className="break-all">{state.message}</p>
        </CardContent>
      </Card>
    );
  }
  const { response } = state;
  const { summary, results } = response;
  const createdRows = results.filter((r) => r.status === 'created');
  const erroredRows = results.filter((r) => r.status === 'error');
  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader>
        <CardTitle className="text-h4 tracking-tight">Result</CardTitle>
        <CardDescription>Valid rows were persisted; errored rows were skipped.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <SummaryStrip summary={summary} />
        <div className="rounded-lg border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Row</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((row) => (
                <TableRow key={row.rowIndex}>
                  <TableCell className="font-mono text-caption">{row.rowIndex}</TableCell>
                  <TableCell>
                    {row.status === 'created' ? (
                      <Badge className="border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        created
                      </Badge>
                    ) : (
                      <Badge className="border-red-300 bg-red-100 text-red-900 dark:border-red-700 dark:bg-red-950/70 dark:text-red-200">
                        <XCircle className="mr-1 h-3 w-3" />
                        error
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-body text-foreground">{row.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {createdRows.length > 0 ? (
          <p className="text-caption text-muted-foreground">
            {createdRows.length} lot{createdRows.length === 1 ? '' : 's'} added under your account ·
            default visibility <span className="font-mono text-foreground">verified_companies</span>
            {erroredRows.length > 0
              ? ` · ${erroredRows.length} row${erroredRows.length === 1 ? '' : 's'} skipped — fix and re-paste to retry`
              : ''}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryStrip({ summary }: { summary: BulkLotsResponse['summary'] }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <SummaryTile label="Total" value={summary.total} tone="muted" />
      <SummaryTile
        label="Created"
        value={summary.created}
        tone="success"
        icon={<CheckCircle2 className="h-4 w-4" />}
      />
      <SummaryTile
        label="Errored"
        value={summary.errored}
        tone="destructive"
        icon={<XCircle className="h-4 w-4" />}
      />
    </div>
  );
}

function SummaryTile({
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

function countDataLines(text: string): number {
  if (!text.trim()) return 0;
  // Strip any leading BOM + CRLF -> LF.
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const normalised = stripped.replace(/\r\n?/g, '\n');
  const lines = normalised.split('\n').filter((l) => l.trim().length > 0);
  // First non-blank line is treated as the header.
  return Math.max(lines.length - 1, 0);
}
