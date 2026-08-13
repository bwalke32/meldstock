// @polsia:user-owned — structured offer form rendered inside the
// MakeOfferButton Dialog. Posts to /api/listings/[lotId]/offers.
//
// Field set mirrors the brief: quantity, price + price-unit toggle,
// freight term Select, ship-to ZIP/city/state/country (visible only
// for DELIVERED-family terms, since EXW leaves ship-to on the
// buyer's docket), requested delivery date, payment terms, comments,
// and an offer-expiration date (defaulted to 7 days out, min tomorrow).
//
// State management uses react-hook-form + the shared zodOfferTerms
// contract so a server 400 with `{ errors: { ... } }` round-trips to
// form fields via `applyServerErrors`.
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import {
  type FreightTerm,
  OfferCreate,
  type OfferCreateInput,
  PriceUnitEnum,
} from '@/lib/contracts/offers';
import { applyServerErrors } from '@/lib/forms';

// Ship-to fields are irrelevant when freightTerm === EXW (ex-works —
// buyer takes ownership at the seller's warehouse). For every other
// term the buyer owes a destination address. FOB has a buyer-supplied
// destination port; the rest need a street/zip/city for delivery.
const FREIGHT_TERM_OPTIONS: Array<{ value: FreightTerm; label: string; needsShipTo: boolean }> = [
  { value: 'EXW', label: 'EXW (Ex-Works)', needsShipTo: false },
  { value: 'FOB', label: 'FOB (Free on Board)', needsShipTo: true },
  { value: 'DELIVERED', label: 'Delivered', needsShipTo: true },
  { value: 'FREIGHT_COLLECT', label: 'Freight Collect', needsShipTo: true },
  { value: 'FREIGHT_PREPAID', label: 'Freight Prepaid', needsShipTo: true },
];

const PRICE_UNIT_OPTIONS: Array<{ value: 'PER_LB' | 'PER_KG'; label: string }> = [
  { value: 'PER_LB', label: '$ / lb' },
  { value: 'PER_KG', label: '$ / kg' },
];

export interface OfferFormProps {
  lotId: string;
  /** Invoked when the POST succeeds (used to close the parent Dialog). */
  onSuccess: () => void;
}

export function OfferForm({ lotId, onSuccess }: OfferFormProps) {
  // Default the expiration to one week from today (the plan's spec)
  // and clamp minimum to "tomorrow" so a typo can't expire immediately.
  const defaultExpires = useMemo(() => isoAfterDays(7), []);
  const minExpires = useMemo(() => isoAfterDays(1), []);

  const form = useForm<OfferCreateInput>({
    resolver: zodResolver(OfferCreate),
    defaultValues: {
      terms: {
        quantityLb: 0,
        pricePerUnit: 0,
        priceUnit: 'PER_LB',
        freightTerm: 'DELIVERED',
        shipToZipCode: '',
        shipToCity: '',
        shipToState: '',
        shipToCountry: '',
        requestedDeliveryDate: null,
        paymentTerms: 'NET 30',
        comments: '',
        offerExpiresAt: defaultExpires,
      },
    },
    mode: 'onBlur',
  });

  const freightTerm = form.watch('terms.freightTerm');
  const showShipTo = useMemo(() => {
    const cfg = FREIGHT_TERM_OPTIONS.find((t) => t.value === freightTerm);
    return cfg?.needsShipTo !== false;
  }, [freightTerm]);

  const [submitting, setSubmitting] = useState(false);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await apiFetch(`/api/listings/${encodeURIComponent(lotId)}/offers`, {
        method: 'POST',
        body: JSON.stringify(values),
        // No persistent schema here — the route returns the just-created
        // Offer but the form doesn't need to re-render it. We still throw
        // on non-2xx so the !res.ok branch engages when the route 4xxs,
        // and applyServerErrors can stamp field-level messages.
      });
      onSuccess();
    } catch (err: unknown) {
      // Route envelopes 400 as { errors: { field: msg } } — flow them onto
      // the form. Without a fieldErrors match, fall back to a generic toast.
      const applied = applyServerErrors(
        (err as { cause?: unknown } | undefined)?.cause,
        form.setError,
      );
      if (!applied) {
        toast.error('Could not submit the offer. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  });

  // Date <input> values are local-time `YYYY-MM-DD` strings — convert to
  // an ISO instant with noon UTC so the wire's `.datetime()` validator
  // accepts it without timezone edge cases.
  function dateToIso(localYmd: string): string {
    const [y, m, d] = localYmd.split('-').map((n) => Number.parseInt(n, 10));
    if (!y || !m || !d) return new Date().toISOString();
    const stamp = Date.UTC(y, m - 1, d, 12, 0, 0);
    return new Date(stamp).toISOString();
  }

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
          label="Quantity requested (lb)"
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

      {showShipTo ? (
        <fieldset className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 px-4 py-3">
          <legend className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Ship-to
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="ZIP / Postal code"
              htmlFor="shipToZipCode"
              error={form.formState.errors.terms?.shipToZipCode?.message}
            >
              <Input
                id="shipToZipCode"
                className="h-10"
                {...form.register('terms.shipToZipCode')}
              />
            </Field>
            <Field
              label="Country"
              htmlFor="shipToCountry"
              error={form.formState.errors.terms?.shipToCountry?.message}
            >
              <Input
                id="shipToCountry"
                className="h-10"
                placeholder="USA"
                {...form.register('terms.shipToCountry')}
              />
            </Field>
            <Field
              label="City"
              htmlFor="shipToCity"
              error={form.formState.errors.terms?.shipToCity?.message}
            >
              <Input id="shipToCity" className="h-10" {...form.register('terms.shipToCity')} />
            </Field>
            <Field
              label="State / Region"
              htmlFor="shipToState"
              error={form.formState.errors.terms?.shipToState?.message}
            >
              <Input id="shipToState" className="h-10" {...form.register('terms.shipToState')} />
            </Field>
          </div>
        </fieldset>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          label="Requested delivery date"
          htmlFor="requestedDeliveryDate"
          error={form.formState.errors.terms?.requestedDeliveryDate?.message}
        >
          <Input
            id="requestedDeliveryDate"
            type="date"
            className="h-10"
            value={isoToDateLocal(form.watch('terms.requestedDeliveryDate'))}
            onChange={(e) => {
              const v = e.target.value;
              form.setValue('terms.requestedDeliveryDate', v ? dateToIso(v) : null, {
                shouldValidate: true,
              });
            }}
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
        label="Comments (optional)"
        htmlFor="comments"
        error={form.formState.errors.terms?.comments?.message}
      >
        <Textarea
          id="comments"
          className="min-h-[80px]"
          placeholder="Any additional context — partial shipment, packaging preference, inspection requirements..."
          {...form.register('terms.comments')}
        />
      </Field>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit offer'}
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

// Computes an ISO string `days` away from today at noon UTC — stable
// across server/client timezones. Used for the default offerExpiresAt
// and the `min=` hydration on the date input.
function isoAfterDays(days: number): string {
  const now = new Date();
  const stamp = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 12, 0, 0),
  );
  return stamp.toISOString();
}
