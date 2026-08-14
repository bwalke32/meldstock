// @polsia:user-owned — /post-a-lot (and trading-floor) listing form. Industry
// spec-sheet fields: type toggle (HAVE/WANTED), polymer, condition, color,
// form, manufacturer, grade, quantity (lb), packaging, location, country,
// asking price ($/lb), PDF documents (COA / TDS / SDS / certifications /
// test reports), notes. RHF + zodResolver against the shared `CreateLot`
// contract.
//
// The COA-available toggle is gone — it now derives from the documents
// collection (`hasCoa = documents.length > 0`). The uploader sits in the
// same row as `askingPricePerLb`.
//
// Visibility selector (5 tiers):
//   Public / Verified only / My network / Selected companies / Anonymous.
// When `liveVisibility === 'SELECTED_COMPANIES'` a chip-list input appears
// below — text input + Enter/Comma adds a chip, Backspace on empty removes
// the last entry. Trim + lowercase + dedupe at submit; cap 50.
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import * as React from 'react';
import type { Resolver } from 'react-hook-form';
import { type FieldValues, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  LotDocumentsUploader,
  type LotDocumentsUploaderHandle,
} from '@/components/custom/lot-documents-uploader';
import { ResinChips } from '@/components/custom/resin-chips';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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
import { CONDITION_LABELS, POLYMER_LABELS } from '@/lib/business/lots';
import { normalizeResinInput } from '@/lib/business/resin-normalize';
import {
  CreateLot as CreateLotSchema,
  type LotItem,
  LotItem as LotItemSchema,
  type LotVisibility,
  type Polymer,
} from '@/lib/contracts/lots';
import { applyServerErrors } from '@/lib/forms';
import { cn } from '@/lib/utils';

interface PostALotFormProps {
  onCreated: (lot: LotItem) => void;
  /** Compact rendering used inside the trading-floor sidebar. */
  compact?: boolean;
}

type LotFormValues = {
  type: 'HAVE' | 'WANTED';
  polymer:
    | 'ABS'
    | 'PC'
    | 'PP'
    | 'PE_HDPE'
    | 'PE_LDPE'
    | 'PE_LLDPE'
    | 'PA6'
    | 'PA66'
    | 'PA612'
    | 'PBT'
    | 'PET'
    | 'POM'
    | 'PPS'
    | 'TPU'
    | 'TPV'
    | 'TPE'
    | 'HIPS'
    | 'GPPS'
    | 'OTHER';
  condition:
    | 'PRIME_VIRGIN'
    | 'OFF_GRADE_WIDE_SPEC'
    | 'REPROCESSED'
    | 'RECYCLED_CONTENT'
    | 'REGRIND_GRANULATED'
    | 'SCRAP'
    | 'PARTS_SPRUES_RUNNERS'
    | 'PURGE'
    | 'POST_INDUSTRIAL'
    | 'POST_CONSUMER'
    | 'MASTERBATCH_COMPOUND'
    | 'OTHER';
  color: string;
  form: string;
  manufacturer: string;
  grade: string;
  quantityLb: number;
  packaging: string;
  location: string;
  country: string;
  askingPricePerLb: number | undefined;
  // `hasCoa` is removed from the form — it's now derived from the
  // documents collection. The schema still has `hasCoa: default(false)` and
  // we send the (server-derived) result of the upload sequence below.
  notes: string;
  visibility: LotVisibility;
  selectedCompanyIdentifiers: string[];
} & FieldValues;

const DEFAULT_VALUES: LotFormValues = {
  type: 'HAVE',
  polymer: 'ABS',
  condition: 'PRIME_VIRGIN',
  color: '',
  form: 'Pellets',
  manufacturer: '',
  grade: '',
  quantityLb: 0,
  packaging: 'Octabin',
  location: '',
  country: '',
  askingPricePerLb: undefined,
  notes: '',
  visibility: 'PUBLIC',
  selectedCompanyIdentifiers: [],
};

// Display order and labels — intentionally NOT alphabetical so the most
// open tier appears first. The wire and DB enum are stable: this is just the
// button order.
const VISIBILITY_OPTIONS: Array<{
  value: LotVisibility;
  label: string;
  shortDescription: string;
}> = [
  { value: 'PUBLIC', label: 'Public', shortDescription: 'Open to every visitor.' },
  {
    value: 'VERIFIED_COMPANIES_ONLY',
    label: 'Verified only',
    shortDescription: 'Only verified companies see the listing.',
  },
  {
    value: 'MY_NETWORK',
    label: 'My network',
    shortDescription: 'Only people you’ve added as connections.',
  },
  {
    value: 'SELECTED_COMPANIES',
    label: 'Selected companies',
    shortDescription: 'Only the handles or emails you add below.',
  },
  {
    value: 'ANONYMOUS',
    label: 'Anonymous',
    shortDescription:
      'Seller identity hidden behind a "Meldstock-verified seller" label; contact via thread only.',
  },
];

const POLYMER_KEYS = Object.keys(POLYMER_LABELS) as Array<keyof typeof POLYMER_LABELS>;
const CONDITION_KEYS = Object.keys(CONDITION_LABELS) as Array<keyof typeof CONDITION_LABELS>;
const PACKAGING_OPTIONS = [
  'Bags',
  'Octabin',
  'Supersack',
  'Gaylord',
  'Railcar',
  'Truckload',
  'Loose',
] as const;
const FORM_OPTIONS = ['Pellets', 'Powder', 'Flake', 'Regrind', 'Granulated', 'Liquid', 'Parts'];

// Cap the chip list so an unruly poster can't push 1000 entries into the
// DB column — the contract enforces this too, but client feedback helps.
const SELECTED_COMPANY_MAX = 50;

export function PostALotForm({ onCreated, compact = false }: PostALotFormProps) {
  const form = useForm<LotFormValues>({
    resolver: zodResolver(CreateLotSchema) as Resolver<LotFormValues>,
    defaultValues: DEFAULT_VALUES,
    mode: 'onBlur',
  });
  const documentsUploaderRef = React.useRef<LotDocumentsUploaderHandle>(null);
  const liveType = form.watch('type');
  const liveVisibility = form.watch('visibility');
  const liveSelected = form.watch('selectedCompanyIdentifiers');
  const liveGrade = form.watch('grade');
  const livePolymer = form.watch('polymer');

  // Resin-parser feedback side-channel — runs on every grade keystroke
  // so the seller sees the parsed chips the server will use. Pure
  // client-side (no round-trip); the server re-runs the same helper
  // on POST. Writes happen to local state, NOT to form fields, so the
  // canonical grade string doesn't auto-stomp the seller's literal
  // input while they keep typing.
  const gradeNormalized = React.useMemo(
    () => normalizeResinInput(liveGrade ?? '', { mode: 'write' }),
    [liveGrade],
  );
  // One-click resolve affordance — surfaced when the grade input
  // carries a single unambiguous polymer AND the dropdown is still
  // set to `OTHER`. Click promotes the dropdown to the detected
  // canonical; the server re-runs the same resolver on POST so the
  // form's local value matches what would be persisted.
  const canResolvePolymer =
    livePolymer === 'OTHER' && (gradeNormalized.polymerOverride ?? null) !== null;

  const setType = (next: 'HAVE' | 'WANTED') => {
    form.setValue('type', next, { shouldDirty: true });
  };
  const setVisibility = (next: LotVisibility) => {
    form.setValue('visibility', next, { shouldDirty: true });
  };
  const setPolymer = (next: Polymer) => {
    form.setValue('polymer', next, { shouldDirty: true, shouldValidate: false });
  };

  // Chip-list handlers — trim+lowercase at submit, dedupe by lowercase so the
  // chip display stays as-typed even if the server treats them case-insensitive.
  function addIdentifier(rawInput: string) {
    const trimmed = rawInput.trim();
    if (!trimmed) return;
    if (liveSelected.length >= SELECTED_COMPANY_MAX) {
      toast.error(`No more than ${SELECTED_COMPANY_MAX} entries.`);
      return;
    }
    const lower = trimmed.toLowerCase();
    const dup = liveSelected.some((e) => e.toLowerCase() === lower);
    if (dup) return;
    form.setValue('selectedCompanyIdentifiers', [...liveSelected, trimmed], {
      shouldDirty: true,
    });
  }
  function removeIdentifier(idx: number) {
    form.setValue(
      'selectedCompanyIdentifiers',
      liveSelected.filter((_, i) => i !== idx),
      { shouldDirty: true },
    );
  }

  const onSubmit = form.handleSubmit(async (values: LotFormValues) => {
    try {
      const submitted = {
        type: values.type,
        polymer: values.polymer,
        condition: values.condition,
        color: values.color,
        form: values.form,
        manufacturer: values.manufacturer.trim() ? values.manufacturer : undefined,
        grade: values.grade.trim() ? values.grade : undefined,
        quantityLb: values.quantityLb,
        packaging: values.packaging,
        location: values.location.trim() ? values.location : undefined,
        country: values.country,
        askingPricePerLb: values.askingPricePerLb,
        // hasCoa is no longer toggled here — the API derives it from
        // attached documents. The schema still accepts `hasCoa` (legacy
        // callers), but this client always lets it default to false and
        // the upload sequence flips it server-side on first success.
        notes: values.notes.trim() ? values.notes : undefined,
        visibility: values.visibility,
        // Send the chips ONLY when the tier is SELECTED_COMPANIES so the
        // server can stamp null otherwise — keeps the wire stable across
        // every tier and avoids stale chips leaking onto a PUBLIC reset.
        selectedCompanyIdentifiers:
          values.visibility === 'SELECTED_COMPANIES' ? values.selectedCompanyIdentifiers : null,
      };
      const created = await apiFetch<LotItem>('/api/lots', {
        method: 'POST',
        body: JSON.stringify(submitted),
        schema: LotItemSchema,
      });
      onCreated(created);
      // Documents second — if uploads fail the lot is still saved. The
      // uploader runs serial through its queue and surfaces per-file errors
      // via toast so the user can retry the failed ones from the same form.
      await documentsUploaderRef.current?.submitFor(created.id);
      // Preserve the visibility + identifier choice so the same poster can
      // blast a few PRIVATE-WHITELIST lots in a row without re-typing.
      form.reset({
        ...DEFAULT_VALUES,
        type: values.type,
        visibility: values.visibility,
        selectedCompanyIdentifiers: values.selectedCompanyIdentifiers,
      });
      toast.success(`${created.type === 'HAVE' ? 'HAVE' : 'WANTED'} lot posted to the floor.`);
    } catch (err) {
      const applied = err instanceof Error && applyServerErrors(err.cause, form.setError);
      if (!applied) {
        toast.error('Something went wrong. Please try again.');
      }
    }
  });

  return (
    <Form {...form}>
      <form
        onSubmit={onSubmit}
        className={cn('flex flex-col gap-5', compact ? 'gap-4' : 'gap-6')}
        noValidate
      >
        <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
          <legend className="contents">
            <Label className="text-sm font-medium">Type</Label>
          </legend>
          <div className="flex gap-2">
            {(['HAVE', 'WANTED'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                aria-pressed={liveType === value}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors',
                  liveType === value
                    ? value === 'HAVE'
                      ? 'border-primary/60 bg-primary/15 text-primary'
                      : 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted/40',
                )}
              >
                {value === 'HAVE' ? 'Have / for sale' : 'Wanted / RFQ'}
              </button>
            ))}
          </div>
          <p className="text-[0.8rem] text-muted-foreground">
            {liveType === 'HAVE'
              ? 'Listing material you have available right now.'
              : 'Make a buy request — counter-offers will arrive via the thread.'}
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
          <legend className="contents">
            <Label className="text-sm font-medium">Visibility</Label>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {VISIBILITY_OPTIONS.map((opt) => {
              const selected = liveVisibility === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVisibility(opt.value)}
                  aria-pressed={selected}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-[11px] font-mono uppercase tracking-wider transition-colors',
                    selected
                      ? opt.value === 'SELECTED_COMPANIES' || opt.value === 'MY_NETWORK'
                        ? 'border-amber-500/60 bg-amber-500/10 text-foreground'
                        : 'border-primary/60 bg-primary/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  <span className="font-medium">{opt.label}</span>
                  <span className="font-sans text-[10px] normal-case tracking-normal text-muted-foreground">
                    {opt.shortDescription}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[0.8rem] text-muted-foreground">
            {liveVisibility === 'PUBLIC'
              ? 'Anyone browsing /lots sees this — your name and contact details stay visible.'
              : liveVisibility === 'VERIFIED_COMPANIES_ONLY'
                ? 'Listing is shown only to buyers whose profile is verified — keeps it inside the trading-floor membership.'
                : liveVisibility === 'MY_NETWORK'
                  ? 'Only people you’ve added as connections on /dashboard/network see this lot.'
                  : liveVisibility === 'SELECTED_COMPANIES'
                    ? 'Only the handles or emails in the chips below see this lot. Lowercase + trim on save.'
                    : 'Your name is replaced by "Meldstock-verified seller" on the listing. Buyers only reach you through the thread.'}
          </p>
        </fieldset>

        {liveVisibility === 'SELECTED_COMPANIES' ? (
          <fieldset className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <legend className="contents">
              <Label className="text-sm font-medium">Invite by handle or email</Label>
            </legend>
            <p className="text-[0.8rem] text-muted-foreground">
              Type a handle (with or without @) or an email, then press <kbd>Enter</kbd> or
              <kbd>,</kbd> to add. <kbd>Backspace</kbd> on an empty input chips the last entry. Case
              is ignored at match time. Add your own handle/email to test.
            </p>
            <SelectedCompanyChips
              values={liveSelected}
              max={SELECTED_COMPANY_MAX}
              onAdd={addIdentifier}
              onRemove={removeIdentifier}
            />
          </fieldset>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="polymer"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Polymer</FormLabel>
                <Select value={field.value} onValueChange={(value) => field.onChange(value)}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select polymer" />
                  </SelectTrigger>
                  <SelectContent>
                    {POLYMER_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {POLYMER_LABELS[key]} · {key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="condition"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Condition</FormLabel>
                <Select value={field.value} onValueChange={(value) => field.onChange(value)}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select condition" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {CONDITION_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Color</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    placeholder="Natural · Black · Custom Code #7A1F4D"
                    autoComplete="off"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="form"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Form</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select form" />
                  </SelectTrigger>
                  <SelectContent>
                    {FORM_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="manufacturer"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Manufacturer (optional)</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    placeholder="SABIC · BASF · Covestro"
                    autoComplete="off"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="grade"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Grade code (optional)</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    placeholder="Lexan 141R · Lustran 433 · PA66 GF33 BK"
                    autoComplete="off"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                {gradeNormalized.chips.length > 0 ? (
                  <ResinChips chips={gradeNormalized.chips} />
                ) : null}
                {canResolvePolymer && gradeNormalized.polymerOverride ? (
                  <FormDescription className="flex flex-wrap items-center gap-2">
                    <span>
                      We&apos;ll save this as a
                      <span className="ml-1 font-mono uppercase tracking-wider">
                        {gradeNormalized.polymerOverride}
                      </span>
                      lot — your dropdown is still on &quot;Other&quot;.
                    </span>
                    <button
                      type="button"
                      onClick={() => setPolymer(gradeNormalized.polymerOverride as Polymer)}
                      className="inline-flex items-center rounded-md border border-primary/60 bg-primary/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                      aria-label={`Set polymer to ${gradeNormalized.polymerOverride}`}
                    >
                      Resolve as {gradeNormalized.polymerOverride}
                    </button>
                  </FormDescription>
                ) : null}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="quantityLb"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Quantity (lb)</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="0"
                    autoComplete="off"
                    value={Number.isFinite(field.value) ? field.value : 0}
                    onChange={(e) => {
                      const raw = e.target.value;
                      field.onChange(raw === '' ? 0 : Number.parseFloat(raw));
                    }}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="packaging"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Packaging</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select packaging" />
                  </SelectTrigger>
                  <SelectContent>
                    {PACKAGING_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    placeholder="USA · Germany · Mexico"
                    autoComplete="off"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Location (optional)</FormLabel>
              <FormControl>
                <Input
                  className="h-11"
                  placeholder="City, State — e.g. Houston, TX"
                  autoComplete="off"
                  {...field}
                  value={field.value ?? ''}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="askingPricePerLb"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Asking price ($/lb)</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="0.85 · or leave blank"
                    autoComplete="off"
                    value={
                      field.value === null || field.value === undefined || Number.isNaN(field.value)
                        ? ''
                        : field.value
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        field.onChange(undefined);
                      } else {
                        field.onChange(Number.parseFloat(raw));
                      }
                    }}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                </FormControl>
                <FormDescription>
                  Reserve price in USD per lb. Leave empty for &quot;price on request&quot;.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex flex-col gap-1">
            <LotDocumentsUploader ref={documentsUploaderRef} />
          </div>
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="MFR/MFI window, recycled content %, food-contact, cosmetic spec…"
                  className="min-h-[80px]"
                  autoComplete="off"
                  {...field}
                  value={field.value ?? ''}
                />
              </FormControl>
              <FormDescription>Up to 1500 characters.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="selectedCompanyIdentifiers"
          render={() => (
            <FormItem className="sr-only">
              <FormControl>
                {/* Mirrors the chip-list state into RHF so `form.handleSubmit`
                    can type-check — there's no visible control because the
                    chip-list above is the real surface. */}
                <input
                  type="hidden"
                  value={JSON.stringify(form.watch('selectedCompanyIdentifiers') ?? [])}
                  readOnly
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting
            ? 'Posting…'
            : liveType === 'HAVE'
              ? 'Post HAVE lot to the floor'
              : 'Post WANTED lot to the floor'}
        </Button>
      </form>
    </Form>
  );
}

// Chip-list component — owns the input state and passes parsed entries
// upstream via `onAdd`. Empty input + Backspace pops the last chip.
function SelectedCompanyChips({
  values,
  max,
  onAdd,
  onRemove,
}: {
  values: string[];
  max: number;
  onAdd: (raw: string) => void;
  onRemove: (idx: number) => void;
}) {
  const [draft, setDraft] = React.useState('');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-amber-500/40 bg-input/30 p-1.5">
        {values.map((value, idx) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] tracking-normal text-foreground"
          >
            <span className="max-w-[180px] truncate lowercase" title={value}>
              {value}
            </span>
            <button
              type="button"
              onClick={() => onRemove(idx)}
              aria-label={`Remove ${value}`}
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-sm text-foreground/70 transition-colors hover:bg-amber-500/30 hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              if (draft.trim().length === 0) return;
              onAdd(draft);
              setDraft('');
              return;
            }
            if (e.key === 'Backspace' && draft === '' && values.length > 0) {
              e.preventDefault();
              onRemove(values.length - 1);
            }
          }}
          onPaste={(e) => {
            // Allow pasting a comma/Newline-separated list so a poster can
            // dump emails from their CRM in one shot.
            const pasted = e.clipboardData.getData('text');
            if (!/[,\n]/.test(pasted)) return;
            e.preventDefault();
            for (const piece of pasted.split(/[,\n]/)) {
              const trimmed = piece.trim();
              if (trimmed) onAdd(trimmed);
            }
            setDraft('');
          }}
          placeholder={
            values.length === 0
              ? '@acme-polymers — Enter to add'
              : values.length >= max
                ? `Reached the ${max}-entry cap`
                : 'Add another'
          }
          aria-label="Selected company identifier"
          className="min-w-[140px] flex-1 bg-transparent px-1 py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          disabled={values.length >= max}
        />
      </div>
      <p className="text-[0.75rem] text-muted-foreground">
        {values.length} / {max} entries · handles AND emails allowed.
      </p>
    </div>
  );
}
