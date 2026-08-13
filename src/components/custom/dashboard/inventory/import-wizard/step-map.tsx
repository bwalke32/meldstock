'use client';

// @polsia:user-owned — step 2 of the bulk-upload wizard. Renders the
// auto-recognised column mapping as a table of source-header →
// dropdown of canonical fields. Manual overrides always win over
// auto-detect; the orchestrator re-runs the preview when the seller
// hits "Refresh preview" so they see the downstream effect of their
// change.

import { Check, HelpCircle, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  BULK_UPLOAD_CANONICAL_FIELDS,
  CANONICAL_FIELD_LABEL,
  CANONICAL_FIELDS_OPTIONAL,
  CANONICAL_FIELDS_REQUIRED,
  type CanonicalField,
  type HeaderMapping,
} from '@/lib/business/inventory-bulk-upload/columns';

export interface StepMapProps {
  headers: string[];
  mapping: HeaderMapping;
  // Headers the auto-recognizer couldn't match OR that the seller has
  // not yet reviewed. Rendered with a soft "unmapped" pill.
  ambiguous: string[];
  onChange: (sourceHeader: string, target: CanonicalField | null) => void;
  onRefresh: () => void;
  onContinue: () => void;
  onBack: () => void;
  refreshing: boolean;
}

export function StepMap({
  headers,
  mapping,
  ambiguous,
  onChange,
  onRefresh,
  onContinue,
  onBack,
  refreshing,
}: StepMapProps) {
  const requiredCanonical = useMemo(
    () =>
      new Set<string>(
        headers
          .map((h) => mapping[h])
          .filter(
            (h): h is CanonicalField =>
              h != null && CANONICAL_FIELDS_REQUIRED.has(h as CanonicalField),
          ),
      ),
    [headers, mapping],
  );
  const missingRequired = useMemo(
    () => [...CANONICAL_FIELDS_REQUIRED].filter((c) => !requiredCanonical.has(c)),
    [requiredCanonical],
  );
  const canContinue = missingRequired.length === 0;

  const renderSelectValue = useCallback(
    (sourceHeader: string) => {
      const target = mapping[sourceHeader];
      if (!target) return 'ignore';
      return target;
    },
    [mapping],
  );

  const onSelectChange = useCallback(
    (sourceHeader: string, value: string) => {
      if (value === 'ignore') {
        onChange(sourceHeader, null);
        return;
      }
      if ((BULK_UPLOAD_CANONICAL_FIELDS as readonly string[]).includes(value)) {
        onChange(sourceHeader, value as CanonicalField);
      }
    },
    [onChange],
  );

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-h3 tracking-[-0.01em]">Map columns</CardTitle>
              <CardDescription>
                We auto-recognized most of the obvious ones. Confirm or change anything that&apos;s
                ambiguous. Anything mapped to &quot;ignore&quot; is dropped without warning.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                Back to upload
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={refreshing}
              >
                {refreshing ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" />
                )}
                Refresh preview
              </Button>
              <Button type="button" size="sm" onClick={onContinue} disabled={!canContinue}>
                <Check className="mr-1 h-4 w-4" />
                Continue to preview
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Your column</TableHead>
                  <TableHead>Maps to</TableHead>
                  <TableHead className="w-28">Required?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {headers.map((header) => {
                  const target = mapping[header] ?? null;
                  const isUnmapped = ambiguous.includes(header);
                  return (
                    <TableRow key={header}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-body text-foreground">{header}</span>
                          {isUnmapped ? (
                            <span className="text-caption text-muted-foreground">
                              Auto-recognizer couldn&apos;t map this column.
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={renderSelectValue(header)}
                          onValueChange={(v) => onSelectChange(header, v)}
                        >
                          <SelectTrigger className="w-64">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Required</SelectLabel>
                              {[...CANONICAL_FIELDS_REQUIRED].map((c) => (
                                <SelectItem key={c} value={c}>
                                  {CANONICAL_FIELD_LABEL[c]}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectLabel>Optional</SelectLabel>
                              {[...CANONICAL_FIELDS_OPTIONAL].map((c) => (
                                <SelectItem key={c} value={c}>
                                  {CANONICAL_FIELD_LABEL[c]}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectItem value="ignore">— Ignore this column</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {target && CANONICAL_FIELDS_REQUIRED.has(target as CanonicalField) ? (
                          <Badge variant="default">Required</Badge>
                        ) : target ? (
                          <Badge variant="outline">Optional</Badge>
                        ) : (
                          <Badge variant="secondary">Ignored</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {missingRequired.length > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-body">
              <HelpCircle className="mt-0.5 h-4 w-4 text-destructive" />
              <div className="flex flex-col gap-1">
                <p className="font-medium text-destructive">Missing required fields</p>
                <p className="text-caption text-muted-foreground">
                  Map at least one column to each of:{' '}
                  {missingRequired.map((c) => CANONICAL_FIELD_LABEL[c]).join(', ')}.
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
