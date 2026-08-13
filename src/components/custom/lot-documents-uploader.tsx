// @polsia:user-owned — client island for attaching PDFs (COA, TDS, SDS,
// certifications, test reports) to a lot. Lives inside the post-a-lot form.
//
// Each queued row carries its own DocumentType; on submit, the parent calls
// `submitFor(lotId)` and the uploader POSTs each row (one Blob per
// multipart request) to `/api/lots/[id]/documents`. Browser-side native
// `fetch` + `FormData` handles the multipart shape — the r2-proxy warning is
// specifically server-to-R2 (breaks with native fetch there), not browser
// to OUR route.
//
// Per-file status (`pending | uploading | uploaded | error`) drives the row
// spinner and the per-file retry behaviour. The lot is created FIRST, then
// the uploader runs; if a row fails the lot is still on the floor and the
// user can re-queue from the failed row — we don't tear the lot down.
'use client';

import { AlertCircle, FileText, Loader2, Upload, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type DocumentTypeValue = 'COA' | 'TDS' | 'SDS' | 'CERTIFICATION' | 'TEST_REPORT' | 'OTHER';

const DOCUMENT_TYPES: Array<{ value: DocumentTypeValue; label: string }> = [
  { value: 'COA', label: 'COA — Certificate of Analysis' },
  { value: 'TDS', label: 'TDS — Technical Data Sheet' },
  { value: 'SDS', label: 'SDS — Safety Data Sheet' },
  { value: 'CERTIFICATION', label: 'Certification (ISO, FDA, UL…)' },
  { value: 'TEST_REPORT', label: 'Test Report' },
  { value: 'OTHER', label: 'Other PDF' },
];

const MAX_DOCUMENTS_PER_LOT = 5;
const MAX_BYTES_PER_FILE = 50 * 1024 * 1024; // 50 MB

export type RowStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

interface QueuedFile {
  /** Stable per-row id so React keys stay stable across status changes. */
  rowId: string;
  file: File;
  type: DocumentTypeValue;
  status: RowStatus;
  errorMessage?: string;
}

export interface LotDocumentsUploaderHandle {
  /** POST every queued file in turn. Returns when the batch settles. */
  submitFor: (lotId: string) => Promise<void>;
  /** True when at least one file is still pending or uploading. */
  isBusy: () => boolean;
}

export const LotDocumentsUploader = React.forwardRef<LotDocumentsUploaderHandle>(
  function LotDocumentsUploader(_props, ref) {
    const [rows, setRows] = React.useState<QueuedFile[]>([]);
    // Mirror of `rows` exposed synchronously for the imperative handle
    // (the latest state isn't always visible to ref consumers without a
    // setState-rendered re-read).
    const rowsRef = React.useRef<QueuedFile[]>([]);
    rowsRef.current = rows;

    const fileInputRef = React.useRef<HTMLInputElement>(null);

    function makeId() {
      return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function queueFiles(picked: FileList | null) {
      if (!picked || picked.length === 0) return;
      const next: QueuedFile[] = [];
      let rejected = false;
      for (const file of Array.from(picked)) {
        if (rowsRef.current.length + next.length >= MAX_DOCUMENTS_PER_LOT) {
          toast.error(`Up to ${MAX_DOCUMENTS_PER_LOT} documents per lot.`);
          rejected = true;
          break;
        }
        if (file.type !== 'application/pdf') {
          toast.error(`${file.name}: only PDF files are allowed.`);
          rejected = true;
          continue;
        }
        if (file.size > MAX_BYTES_PER_FILE) {
          toast.error(`${file.name}: exceeds the 50 MB limit.`);
          rejected = true;
          continue;
        }
        next.push({ rowId: makeId(), file, type: 'COA', status: 'pending' });
      }
      if (next.length > 0) {
        setRows((prev) => [...prev, ...next]);
      }
      // Reset the input so re-picking the same file re-fires `onChange`.
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (rejected) return;
    }

    function removeRow(rowId: string) {
      setRows((prev) => prev.filter((r) => r.rowId !== rowId));
    }

    function updateRowType(rowId: string, type: DocumentTypeValue) {
      setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, type } : r)));
    }

    const setRowStatus = React.useCallback(
      (rowId: string, status: RowStatus, errorMessage?: string) => {
        setRows((prev) =>
          prev.map((r) => (r.rowId === rowId ? { ...r, status, errorMessage } : r)),
        );
      },
      [],
    );

    const submitFor = React.useCallback(
      async (lotId: string): Promise<void> => {
        // Snapshot the pending rows so concurrent state mutations during
        // upload don't retry already-uploaded rows.
        const targets = rowsRef.current.filter((r) => r.status === 'pending');
        if (targets.length === 0) return;

        let anyFailed = false;
        for (const t of targets) {
          setRowStatus(t.rowId, 'uploading');
          try {
            const fd = new FormData();
            fd.append('type', t.type);
            fd.append('file', t.file, t.file.name);
            const res = await fetch(`/api/lots/${encodeURIComponent(lotId)}/documents`, {
              method: 'POST',
              body: fd,
            });
            if (!res.ok) {
              const body: unknown = await res.json().catch(() => null);
              const msg =
                (body &&
                typeof body === 'object' &&
                'error' in body &&
                typeof body.error === 'string'
                  ? body.error
                  : null) ?? `Upload failed (${res.status})`;
              setRowStatus(t.rowId, 'error', msg);
              toast.error(`${t.file.name}: ${msg}`);
              anyFailed = true;
              continue;
            }
            setRowStatus(t.rowId, 'uploaded');
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Upload failed';
            setRowStatus(t.rowId, 'error', msg);
            toast.error(`${t.file.name}: ${msg}`);
            anyFailed = true;
          }
        }
        if (!anyFailed && targets.length > 0) {
          toast.success(`${targets.length} document${targets.length === 1 ? '' : 's'} attached.`);
        }
      },
      [setRowStatus],
    );

    React.useImperativeHandle(
      ref,
      () => ({
        submitFor,
        isBusy: () => rowsRef.current.some((r) => r.status === 'uploading'),
      }),
      [submitFor],
    );

    const atCap = rows.length >= MAX_DOCUMENTS_PER_LOT;
    const count = rows.length;

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Spec documents (optional)</span>
            <span className="text-[0.8rem] text-muted-foreground">
              Attach COA, TDS, SDS, certifications, test reports. PDFs only, up to{' '}
              {MAX_DOCUMENTS_PER_LOT}.
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={atCap}
            className="gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Add PDF{atCap ? ` (${MAX_DOCUMENTS_PER_LOT}/${MAX_DOCUMENTS_PER_LOT})` : ''}
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(e) => queueFiles(e.target.files)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />

        {rows.length > 0 ? (
          <ul className="flex flex-col gap-1.5 rounded-md border border-border bg-input/30 p-2">
            {rows.map((row) => (
              <li
                key={row.rowId}
                className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground"
                  title={row.file.name}
                >
                  {row.file.name}
                </span>
                <Select
                  value={row.type}
                  onValueChange={(v) => updateRowType(row.rowId, v as DocumentTypeValue)}
                  disabled={row.status === 'uploading' || row.status === 'uploaded'}
                >
                  <SelectTrigger className="h-7 w-[180px] px-2 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <RowStatusBadge status={row.status} message={row.errorMessage} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(row.rowId)}
                  className="h-7 w-7"
                  aria-label={`Remove ${row.file.name}`}
                  disabled={row.status === 'uploading'}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.75rem] text-muted-foreground">No documents queued.</p>
        )}

        <p className="text-[0.75rem] text-muted-foreground">
          {count} / {MAX_DOCUMENTS_PER_LOT} documents · PDFs up to 50 MB.
        </p>
      </div>
    );
  },
);

function RowStatusBadge({ status, message }: { status: RowStatus; message?: string }) {
  if (status === 'uploading') {
    return (
      <span className="inline-flex items-center gap-1 text-[0.7rem] uppercase tracking-wider text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        uploading
      </span>
    );
  }
  if (status === 'uploaded') {
    return (
      <span className="inline-flex items-center rounded-sm border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-primary">
        uploaded
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className={cn(
          'inline-flex max-w-[160px] items-center gap-1 truncate rounded-sm border border-destructive/50 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-destructive',
        )}
        title={message}
      >
        <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
        error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
      queued
    </span>
  );
}
