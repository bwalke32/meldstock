'use client';

// @polsia:user-owned — step 1 of the bulk-upload wizard. Lets the seller
// pick a CSV or XLSX file and (optionally) previews the size before
// they hit "Continue". The wizard orchestrator manages the actual
// state; this component only owns the picker + size label.

import { Download, FileSpreadsheet, FileText, Loader2, Upload } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SUPPORTED_EXT = ['.csv', '.xlsx', '.xls', '.xlsm', '.xlsb', '.txt'];

export interface StepUploadProps {
  file: File | null;
  onPick: (file: File | null) => void;
  onContinue: () => void;
  // True while the orchestrator is awaiting the preview POST.
  previewPending: boolean;
}

export function StepUpload({ file, onPick, onContinue, previewPending }: StepUploadProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(
    async (next: File) => {
      // 10 MB hard cap matches the server's MAX_FILE_BYTES (see
      // src/lib/business/inventory-bulk-upload/parse-file.ts).
      if (next.size > 10 * 1024 * 1024) {
        toast.error('File exceeds the 10 MB limit');
        return;
      }
      const lower = next.name.toLowerCase();
      const ok = SUPPORTED_EXT.some((s) => lower.endsWith(s));
      if (!ok) {
        toast.error(`Unsupported file type — use ${SUPPORTED_EXT.join(', ')}`);
        return;
      }
      onPick(next);
    },
    [onPick],
  );

  const ext = file?.name.toLowerCase().split('.').pop() ?? '';
  const isExcel = ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'xlsb';
  const sizeKb = file ? (file.size / 1024).toFixed(1) : null;

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-h4 tracking-tight">Choose your file</CardTitle>
          <CardDescription>
            Drop a CSV or Excel file. We auto-detect your sheet&apos;s column names in the next step
            and let you confirm before anything is imported.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-2">
            <Label htmlFor="bulk-upload-file">Spreadsheet</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                ref={fileInputRef}
                id="bulk-upload-file"
                type="file"
                accept={SUPPORTED_EXT.join(',')}
                onChange={(e) => {
                  const next = e.target.files?.[0];
                  if (next) void handleFile(next);
                }}
                className="max-w-md"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!file}
                onClick={() => {
                  onPick(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                Clear
              </Button>
            </div>
            {file ? (
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background p-3 text-caption text-muted-foreground">
                {isExcel ? (
                  <FileSpreadsheet className="h-4 w-4 text-brand-700 dark:text-brand-300" />
                ) : (
                  <FileText className="h-4 w-4 text-brand-700 dark:text-brand-300" />
                )}
                <span className="font-medium text-foreground">{file.name}</span>
                <span>·</span>
                <span>{sizeKb} KB</span>
              </div>
            ) : (
              <p className="text-caption text-muted-foreground">
                No file chosen yet. Up to 10 MB; up to ~5,000 rows.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" disabled={!file || previewPending} onClick={onContinue}>
              {previewPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1 h-4 w-4" />
              )}
              {previewPending ? 'Reading file…' : 'Continue to mapping'}
            </Button>
            <span className="text-caption text-muted-foreground">
              Or download an example with the canonical column names:
            </span>
            <Button asChild variant="outline" size="sm">
              <a href="/api/inventory/bulk-upload/template.csv" download>
                <Download className="mr-1 h-3 w-3" />
                CSV template
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/api/inventory/bulk-upload/template.xlsx" download>
                <Download className="mr-1 h-3 w-3" />
                XLSX template
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-h4 tracking-tight">What happens next</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-body text-muted-foreground">
          <p>
            1) <span className="font-medium text-foreground">Map columns</span> — auto-recognize
            picks the obvious ones (Manufacturer, Polymer, Quantity, …); you confirm or change
            anything that&apos;s ambiguous.
          </p>
          <p>
            2) <span className="font-medium text-foreground">Preview &amp; errors</span> — see every
            row before it&apos;s imported. Invalid rows list WHY (missing polymer, invalid grade,
            …). You can fix typos inline or skip the row.
          </p>
          <p>
            3) <span className="font-medium text-foreground">Import</span> — only the rows you
            approve are created. Status defaults to{' '}
            <span className="font-mono text-foreground">ACTIVE</span> and they appear on{' '}
            <span className="font-mono text-foreground">/trading-floor</span> immediately for
            verified buyers to message about.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
