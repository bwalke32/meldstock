// @polsia:user-owned — structured seller-response form rendered inside
// the RespondToWantedButton Dialog. Posts to /api/listings/[lotId]/responses.
//
// Field set mirrors the HAVE Offer form plus the brief's new fields:
//   * Available quantity (lb)
//   * Price + price-unit toggle ($/lb or $/kg)
//   * Material location (REQUIRED — distinct from ship-to)
//   * Freight term (Select — same five options)
//   * Lead time in days (optional)
//   * Packaging (optional text)
//   * Lot info (optional textarea)
//   * COA available (checkbox)
//   * Payment terms (optional text, default "NET 30")
//   * Comments (optional textarea)
//   * Offer expires on (date, default 7 days; min tomorrow)
//
// State management uses react-hook-form + the shared `WantedResponseCreate`
// contract so a server 400 with `{ errors: { ... } }` round-trips to form
// fields via `applyServerErrors`.
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { type FreightTerm, PriceUnitEnum } from '@/lib/contracts/offers';
import {
  WantedResponseCreate,
  type WantedResponseCreateInput,
} from '@/lib/contracts/wanted-responses';
import { applyServerErrors } from '@/lib/forms';

const FREIGHT_TERM_OPTIONS: Array<{ value: FreightTerm; label: string }> = [
  { value: 'EXW', label: 'EXW (Ex-Works)' },
  { value: 'FOB', label: 'FOB (Free on Board)' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'FREIGHT_COLLECT', label: 'Freight Collect' },
  { value: 'FREIGHT_PREPAID', label: 'Freight Prepaid' },
];

const PRICE_UNIT_OPTIONS: Array<{ value: 'PER_LB' | 'PER_KG'; label: string }> = [
  { value: 'PER_LB', label: '$ / lb' },
  { value: 'PER_KG', label: '$ / kg' },
];

export interface ResponseFormProps {
  lotId: string;
  /** Invoked when the POST succeeds (used to close the parent Dialog). */
  onSuccess: () => void;
}

export function ResponseForm({ lotId, onSuccess }: ResponseFormProps) {
  // Default the expiration to one week from today (the plan's spec)
  // and clamp minimum to "tomorrow" so a typo can't expire immediately.
  const defaultExpires = useMemo(() => isoAfterDays(7), []);
  const minExpires = useMemo(() => isoAfterDays(1), []);

  const form = useForm<WantedResponseCreateInput>({
    resolver: zodResolver(WantedResponseCreate),
    defaultValues: {
      terms: {
        quantityLb: 0,
        pricePerUnit: 0,
        priceUnit: 'PER_LB',
        freightTerm: 'DELIVERED',
        materialLocation: '',
        leadTimeDays: null,
        packaging: '',
        lotInfo: '',
        coaAvailable: false,
        paymentTerms: 'NET 30',
        comments: '',
        offerExpiresAt: defaultExpires,
      },
    },
    mode: 'onBlur',
  });

  const [submitting, setSubmitting] = useState(false);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await apiFetch(`/api/listings/${encodeURIComponent(lotId)}/responses`, {
        method: 'POST',
        body: JSON.stringify(values),
        // No persistent schema here — the route returns the just-created
        // WantedResponse but the form doesn't need to re-render it. We
        // still throw on non-2xx so the !res.ok branch engages when the
        // route 4xxs, and applyServerErrors can stamp field-level
        // messages.
      });
      onSuccess();
    } catch (err: unknown) {
      const applied = applyServerErrors(
        (err as { cause?: unknown } | undefined)?.cause,
        form.setError,
      );
      if (!applied) {
        toast.error('Could not submit the response. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  });

  function isoToDateLocal(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          label="Available quantity (lb)"
          htmlFor="quantityLb"
          error={form.formState.errors.terms?.quantityLb?.message}
        >
          <Input
            id="quantityLb"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            className="h-10"
            {...form.register('terms.quantityLb', { valueAsNumber: true })}
          />
        </Field>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field
            label="Price per unit ($)"
            htmlFor="pricePerUnit"
            error={form.formState.errors.terms?.pricePerUnit?.message}
          >
            <Input
              id="pricePerUnit"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="h-10"
              {...form.register('terms.pricePerUnit', { valueAsNumber: true })}
            />
          </Field>
          <Field label="Unit" htmlFor="priceUnit">
            <Select
              value={form.watch('terms.priceUnit')}
              onValueChange={(value) => {
                const parsed = PriceUnitEnum.parse(value);
                form.setValue('terms.priceUnit', parsed, { shouldValidate: true });
              }}
            >
              <SelectTrigger id="priceUnit" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_UNIT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      <Field
        label="Material location (city, state, country)"
        htmlFor="materialLocation"
        error={form.formState.errors.terms?.materialLocation?.message}
      >
        <Input
          id="materialLocation"
          className="h-10"
          placeholder="Houston, TX, USA"
          {...form.register('terms.materialLocation')}
        />
      </Field>

      <Field
        label="Freight term"
        htmlFor="freightTerm"
        error={form.formState.errors.terms?.freightTerm?.message}
      >
        <Select
          value={form.watch('terms.freightTerm')}
          onValueChange={(value) => {
            const parsed = FREIGHT_TERM_OPTIONS.find((o) => o.value === value);
            if (!parsed) return;
            form.setValue('terms.freightTerm', parsed.value, { shouldValidate: true });
          }}
        >
          <SelectTrigger id="freightTerm" className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREIGHT_TERM_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          label="Lead time (days, optional)"
          htmlFor="leadTimeDays"
          error={form.formState.errors.terms?.leadTimeDays?.message}
        >
          <Input
            id="leadTimeDays"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            className="h-10"
            value={form.watch('terms.leadTimeDays') ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                form.setValue('terms.leadTimeDays', null, { shouldValidate: true });
                return;
              }
              const n = Number.parseInt(raw, 10);
              form.setValue('terms.leadTimeDays', Number.isFinite(n) && n >= 0 ? n : null, {
                shouldValidate: true,
              });
            }}
          />
        </Field>
        <Field
          label="Packaging (optional)"
          htmlFor="packaging"
          error={form.formState.errors.terms?.packaging?.message}
        >
          <Input
            id="packaging"
            className="h-10"
            placeholder="Gaylord boxes, 1,000 lb each"
            {...form.register('terms.packaging')}
          />
        </Field>
      </div>

      <Field
        label="Lot info / traceability (optional)"
        htmlFor="lotInfo"
        error={form.formState.errors.terms?.lotInfo?.message}
      >
        <Textarea
          id="lotInfo"
          className="min-h-[80px]"
          placeholder="Lot number, origin, melt index, prior history..."
          {...form.register('terms.lotInfo')}
        />
      </Field>

      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-4 py-3">
        <Checkbox
          id="coaAvailable"
          checked={form.watch('terms.coaAvailable')}
          onCheckedChange={(checked) => {
            form.setValue('terms.coaAvailable', checked === true, {
              shouldValidate: true,
            });
          }}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="coaAvailable">COA available</Label>
          <p className="text-[11px] text-muted-foreground">
            A certificate of analysis is on hand for this lot.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          label="Payment terms"
          htmlFor="paymentTerms"
          error={form.formState.errors.terms?.paymentTerms?.message}
        >
          <Input
            id="paymentTerms"
            placeholder="NET 30"
            className="h-10"
            {...form.register('terms.paymentTerms')}
          />
        </Field>
        <Field
          label="Offer expires on"
          htmlFor="offerExpiresAt"
          error={form.formState.errors.terms?.offerExpiresAt?.message}
        >
          <Input
            id="offerExpiresAt"
            type="date"
            className="h-10"
            min={isoToDateLocal(minExpires)}
            value={isoToDateLocal(form.watch('terms.offerExpiresAt'))}
            onChange={(e) => {
              const v = e.target.value;
              form.setValue('terms.offerExpiresAt', v ? dateToIso(v) : defaultExpires, {
                shouldValidate: true,
                shouldDirty: true,
              });
            }}
          />
        </Field>
      </div>

      <Field
        label="Comments (optional)"
        htmlFor="comments"
        error={form.formState.errors.terms?.comments?.message}
      >
        <Textarea
          id="comments"
          className="min-h-[80px]"
          placeholder="Inspection welcome, partial shipment negotiable, …"
          {...form.register('terms.comments')}
        />
      </Field>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit response'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

// Date <input> values are local-time `YYYY-MM-DD` strings — convert to
// an ISO instant with noon UTC so the wire's `.datetime()` validator
// accepts it without timezone edge cases.
function dateToIso(localYmd: string): string {
  const [y, m, d] = localYmd.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return new Date().toISOString();
  const stamp = Date.UTC(y, m - 1, d, 12, 0, 0);
  return new Date(stamp).toISOString();
}

function isoAfterDays(days: number): string {
  const now = new Date();
  const stamp = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 12, 0, 0),
  );
  return stamp.toISOString();
}
