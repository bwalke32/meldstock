// @polsia:user-owned — CTA card on /dashboard/inventory routing to the
// new bulk-import wizard. Shown above the listings table so a power-
// user with >5 inventory rows discovers the wizard without making a
// new top-bar slot. Server-render-safe (default to server; no data).
import { ChevronRight, FileSpreadsheet, Upload } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function ImportCtaCard() {
  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-eyebrow">Power user</span>
            <h2 className="font-display text-h3 tracking-[-0.01em] text-foreground">
              Import lots from a spreadsheet
            </h2>
          </div>
          <Badge variant="outline">CSV · XLSX</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-6">
        <p className="text-body text-muted-foreground">
          Drop a CSV or Excel sheet, map columns, preview every row, fix typos inline, then import
          only the rows you approve. Invalid rows stay on the bench with a clear reason.
        </p>
        <ul className="flex flex-col gap-2 text-body text-muted-foreground">
          <li className="flex items-start gap-2">
            <FileSpreadsheet className="mt-0.5 h-4 w-4 text-brand-700 dark:text-brand-300" />
            <span>
              Auto-recognizes 13 common column names (Manufacturer, Polymer, Condition, Form, Color,
              Quantity, Unit, Packaging, Location, Price, Lot, Description, Country).
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Upload className="mt-0.5 h-4 w-4 text-brand-700 dark:text-brand-300" />
            <span>
              Row-level validation — only the rows you approve are created. Capped at 5,000 rows per
              import, 10 MB file size.
            </span>
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/inventory/upload"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-body font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <Upload className="h-4 w-4" />
            Open the importer
            <ChevronRight className="h-4 w-4" />
          </Link>
          <Link
            href="/api/inventory/bulk-upload/template.csv"
            className="text-body text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            prefetch={false}
          >
            Download a CSV template
          </Link>
          <Link
            href="/api/inventory/bulk-upload/template.xlsx"
            className="text-body text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            prefetch={false}
          >
            Download an XLSX template
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
