'use client';

// @polsia:user-owned — bulk-upload wizard orchestrator. Drives the four
// steps (Upload → Map → Preview+Errors → Confirm/Import) and owns the
// state machine that ties the seller's choices to the two API round-
// trips (preview + commit). Multipart POSTs use raw fetch (apiFetch is
// JSON-only); the response bodies still run through the shared zod
// contract so a server-schema change surfaces as a parse error rather
// than a silent shape drift.
//
// The first preview POST fires the moment the seller picks a file —
// that's how the wizard learns the sheet's headers and the
// auto-recognized mapping without bundling xlsx into the browser.

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { CanonicalField } from '@/lib/business/inventory-bulk-upload/columns';
import {
  type CommitResponse,
  CommitResponseSchema,
  type PreviewResponse,
  PreviewResponseSchema,
} from '@/lib/contracts/inventory-bulk-upload';
import { StepConfirm } from './import-wizard/step-confirm';
import { StepMap } from './import-wizard/step-map';
import { StepPreview } from './import-wizard/step-preview';
import { StepUpload } from './import-wizard/step-upload';

type WizardStep = 'upload' | 'map' | 'preview' | 'confirm';

type WizardState =
  | { kind: 'upload' }
  | {
      kind: 'map';
      file: File;
      headers: string[];
      mapping: Record<string, CanonicalField | null>;
      ambiguous: string[];
    }
  | {
      kind: 'preview';
      file: File;
      headers: string[];
      mapping: Record<string, CanonicalField | null>;
      preview: PreviewResponse;
      edits: Record<string, Partial<Record<CanonicalField, string>>>;
      skipFlags: Record<string, boolean>;
    }
  | {
      kind: 'confirm';
      file: File;
      mapping: Record<string, CanonicalField | null>;
      preview: PreviewResponse;
      edits: Record<string, Partial<Record<CanonicalField, string>>>;
      skipFlags: Record<string, boolean>;
      result: CommitResponse | null;
    };

const STEP_LABELS: Record<WizardStep, string> = {
  upload: 'Upload',
  map: 'Map columns',
  preview: 'Preview',
  confirm: 'Import',
};

async function postPreview(
  file: File,
  mapping: Record<string, CanonicalField | null> | null,
  spinner: (on: boolean) => void,
): Promise<PreviewResponse | null> {
  spinner(true);
  try {
    const fd = new FormData();
    fd.append('file', file);
    if (mapping) fd.append('mapping', JSON.stringify(mapping));
    const res = await fetch('/api/inventory/bulk-upload/preview', { method: 'POST', body: fd });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : null) ?? `Preview failed (${res.status})`;
      toast.error(message);
      return null;
    }
    const parsed = PreviewResponseSchema.safeParse(body);
    if (!parsed.success) {
      toast.error('Preview response did not match the expected shape');
      return null;
    }
    return parsed.data;
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    spinner(false);
  }
}

export function ImportWizard() {
  const [state, setState] = useState<WizardState>({ kind: 'upload' });
  const [mappingPending, setMappingPending] = useState(false);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const currentStep: WizardStep = state.kind;

  // Upload step: pick a file, fire the FIRST preview POST so the
  // wizard learns headers + auto-recognized mapping. The map step
  // renders from the server's recognized result so we never bundle
  // xlsx into the browser.
  const handlePickFile = useCallback(async (file: File | null) => {
    if (!file) {
      setState({ kind: 'upload' });
      return;
    }
    const preview = await postPreview(file, null, setMappingPending);
    if (!preview) {
      // Stay on upload step on failure; toast already surfaced.
      return;
    }
    const headers = Object.keys(preview.mapping);
    setState({
      kind: 'map',
      file,
      headers,
      mapping: preview.mapping,
      ambiguous: preview.ambiguous,
    });
  }, []);

  // Map step: seller adjusted a dropdown → re-run preview so the
  // downstream effect lands in the screenshot before they commit.
  // This is what `Refresh preview` in step 2 triggers.
  const handleRefreshFromMap = useCallback(async () => {
    if (state.kind !== 'map') return;
    const preview = await postPreview(state.file, state.mapping, setPreviewRefreshing);
    if (!preview) return;
    setState({
      kind: 'preview',
      file: state.file,
      headers: state.headers,
      mapping: state.mapping,
      preview,
      edits: {},
      skipFlags: {},
    });
  }, [state]);

  // Map step: "Continue to preview" — same as refresh but a separate
  // entry-point so the button reads correctly.
  const handleContinueFromMap = useCallback(async () => {
    if (state.kind !== 'map') return;
    await handleRefreshFromMap();
  }, [handleRefreshFromMap, state]);

  // Preview step: "Refresh" — re-run preview with current edits
  // stubbed to a no-op (preview doesn't honour edits; only commit
  // does). Useful after the seller re-arranges the mapping then comes
  // BACK to preview.
  const _handleRefreshFromPreview = useCallback(async () => {
    if (state.kind !== 'preview') return;
    const preview = await postPreview(state.file, state.mapping, setPreviewRefreshing);
    if (!preview) return;
    setState((prev) => {
      if (prev.kind !== 'preview') return prev;
      return { ...prev, preview };
    });
  }, [state]);

  const handleEditRow = useCallback(
    (rowIndex: number, field: CanonicalField, value: string | null) => {
      setState((prev) => {
        if (prev.kind !== 'preview' && prev.kind !== 'confirm') return prev;
        const key = String(rowIndex);
        const edits = { ...prev.edits };
        const rowEdit = { ...(edits[key] ?? {}) };
        if (value === null) {
          delete rowEdit[field];
        } else {
          rowEdit[field] = value;
        }
        edits[key] = rowEdit;
        return { ...prev, edits };
      });
    },
    [],
  );

  const handleSkipRow = useCallback((rowIndex: number, skip: boolean) => {
    setState((prev) => {
      if (prev.kind !== 'preview' && prev.kind !== 'confirm') return prev;
      const key = String(rowIndex);
      const skipFlags = { ...prev.skipFlags };
      if (skip) skipFlags[key] = true;
      else delete skipFlags[key];
      return { ...prev, skipFlags };
    });
  }, []);

  const handlePreviewToConfirm = useCallback(() => {
    setState((prev) => {
      if (prev.kind !== 'preview') return prev;
      return {
        kind: 'confirm',
        file: prev.file,
        mapping: prev.mapping,
        preview: prev.preview,
        edits: prev.edits,
        skipFlags: prev.skipFlags,
        result: null,
      };
    });
  }, []);

  const handleCommit = useCallback(async () => {
    if (state.kind !== 'confirm') return;
    setCommitting(true);
    try {
      const fd = new FormData();
      fd.append('file', state.file);
      fd.append('payload', JSON.stringify({ mapping: state.mapping, edits: state.edits }));
      const res = await fetch('/api/inventory/bulk-upload/commit', { method: 'POST', body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : null) ?? `Commit failed (${res.status})`;
        toast.error(message);
        return;
      }
      const parsed = CommitResponseSchema.safeParse(body);
      if (!parsed.success) {
        toast.error('Commit response did not match the expected shape');
        return;
      }
      setState({ ...state, result: parsed.data });
      const imported = parsed.data.imported.length;
      const skipped = parsed.data.skipped.length;
      if (imported === 0) {
        toast.warning('No rows imported — fix the errors and try again');
      } else {
        toast.success(
          `${imported} lot${imported === 1 ? '' : 's'} created${skipped > 0 ? ` · ${skipped} skipped` : ''}`,
        );
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [state]);

  const handleBackToUpload = useCallback(() => {
    setState({ kind: 'upload' });
  }, []);

  const handleBackToMap = useCallback(() => {
    setState((prev) => {
      if (prev.kind !== 'preview') return prev;
      const ambiguous = Object.keys(prev.mapping).filter((h) => prev.mapping[h] === null);
      return {
        kind: 'map',
        file: prev.file,
        headers: prev.headers,
        mapping: prev.mapping,
        ambiguous,
      };
    });
  }, []);

  const handleBackToPreview = useCallback(() => {
    setState((prev) => {
      if (prev.kind !== 'confirm') return prev;
      return {
        kind: 'preview',
        file: prev.file,
        headers: Object.keys(prev.mapping),
        mapping: prev.mapping,
        preview: prev.preview,
        edits: prev.edits,
        skipFlags: prev.skipFlags,
      };
    });
  }, []);

  const stepIndex = useMemo(() => {
    if (state.kind === 'upload') return 0;
    if (state.kind === 'map') return 1;
    if (state.kind === 'preview') return 2;
    return 3;
  }, [state.kind]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-gradient-to-br from-brand-100 via-card to-card p-6 shadow-md md:p-8">
        <span className="text-eyebrow">Power user</span>
        <h1 className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground">
          Bulk import lots
        </h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          Drop a CSV or Excel sheet. Map columns, preview every row, fix typos inline, then import
          only the rows you approve — invalid rows stay on the bench with a clear reason.
        </p>
        <StepIndicator currentStep={stepIndex} />
      </header>

      {state.kind === 'upload' ? (
        <StepUpload
          file={null}
          onPick={(file) => void handlePickFile(file)}
          onContinue={() => {
            /* handled by onPick */
          }}
          previewPending={mappingPending}
        />
      ) : null}

      {state.kind === 'map' ? (
        <StepMap
          headers={state.headers}
          mapping={state.mapping}
          ambiguous={state.ambiguous}
          onChange={(header, target) => {
            setState({
              ...state,
              mapping: { ...state.mapping, [header]: target },
            });
          }}
          onRefresh={() => void handleRefreshFromMap()}
          onContinue={() => void handleContinueFromMap()}
          onBack={handleBackToUpload}
          refreshing={mappingPending || previewRefreshing}
        />
      ) : null}

      {state.kind === 'preview' ? (
        <StepPreview
          preview={state.preview}
          edits={state.edits}
          skipFlags={state.skipFlags}
          onEdit={(rowIndex, field, value) => handleEditRow(rowIndex, field, value)}
          onSkip={(rowIndex, skip) => handleSkipRow(rowIndex, skip)}
          onContinue={handlePreviewToConfirm}
          onBack={handleBackToMap}
          refreshing={previewRefreshing}
        />
      ) : null}

      {state.kind === 'confirm' ? (
        <StepConfirm
          preview={state.preview}
          skipFlags={state.skipFlags}
          onCommit={() => void handleCommit()}
          onBack={handleBackToPreview}
          result={state.result}
          committing={committing}
        />
      ) : null}

      <span className="sr-only" aria-live="polite">
        {`Current step: ${STEP_LABELS[currentStep]}`}
      </span>
    </div>
  );
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps: Array<{ label: string }> = [
    { label: 'Upload' },
    { label: 'Map columns' },
    { label: 'Preview' },
    { label: 'Import' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      {steps.map((s, i) => {
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        return (
          <div key={s.label} className="flex items-center gap-2">
            <span
              className={
                isActive
                  ? 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 font-mono text-[10px] font-semibold text-brand-50'
                  : isDone
                    ? 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-200 font-mono text-[10px] font-semibold text-brand-800 dark:bg-brand-800/50 dark:text-brand-200'
                    : 'inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card font-mono text-[10px] font-semibold text-muted-foreground'
              }
            >
              {i + 1}
            </span>
            <span
              className={
                isActive
                  ? 'text-body font-medium text-foreground'
                  : 'text-caption text-muted-foreground'
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <span className="mx-2 h-1 w-8 rounded-full bg-border" aria-hidden />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
