// @polsia:user-owned — focused injection-molder sourcing request.
'use client';

import { ArrowRight, LockKeyhole } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
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
import { useSession } from '@/lib/auth-client';
import { CONDITION_LABELS } from '@/lib/business/lots';
import { type MaterialRequestDraft, materialRequestToLot } from '@/lib/business/material-request';
import { type LotCondition, type LotItem, LotItem as LotItemSchema } from '@/lib/contracts/lots';

const DRAFT_KEY = 'meldstock:material-request-draft';

interface FormState {
  material: string;
  condition: LotCondition;
  color: string;
  quantityLb: string;
  destination: string;
  country: string;
  neededBy: string;
  equivalentAllowed: boolean;
  details: string;
}

const DEFAULT_STATE: FormState = {
  material: '',
  condition: 'PRIME_VIRGIN',
  color: '',
  quantityLb: '',
  destination: '',
  country: 'USA',
  neededBy: '',
  equivalentAllowed: true,
  details: '',
};

const CONDITION_KEYS: LotCondition[] = [
  'PRIME_VIRGIN',
  'OFF_GRADE_WIDE_SPEC',
  'REPROCESSED',
  'RECYCLED_CONTENT',
  'REGRIND_GRANULATED',
  'MASTERBATCH_COMPOUND',
  'OTHER',
];

export function MaterialRequestForm() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  const [state, setState] = React.useState<FormState>(DEFAULT_STATE);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<FormState>;
      setState((current) => ({ ...current, ...parsed }));
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((current) => ({ ...current, [key]: value }));
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const quantity = Number.parseFloat(state.quantityLb);
    if (!state.material.trim()) {
      setError('Tell us the material, grade, or performance you need.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Enter the approximate quantity in pounds.');
      return;
    }
    if (!state.destination.trim() || !state.country.trim()) {
      setError('Enter the delivery city/region and country.');
      return;
    }

    if (!session?.user) {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
      toast.info('Your request is saved. Create a free account to send it privately.');
      window.location.assign('/signup?role=molder&next=/request-material');
      return;
    }

    const draft: MaterialRequestDraft = {
      material: state.material,
      condition: state.condition,
      color: state.color,
      quantityLb: quantity,
      destination: state.destination,
      country: state.country,
      neededBy: state.neededBy || undefined,
      equivalentAllowed: state.equivalentAllowed,
      details: state.details || undefined,
    };

    setPending(true);
    try {
      const created = await apiFetch<LotItem>('/api/lots', {
        method: 'POST',
        body: JSON.stringify(materialRequestToLot(draft)),
        schema: LotItemSchema,
      });
      window.localStorage.removeItem(DRAFT_KEY);
      toast.success('Your material request is ready for specialist responses.');
      router.push(`/lots/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the request. Try again.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-7" noValidate>
      <div className="space-y-2">
        <Label htmlFor="material" className="text-base font-semibold">
          What material do you need?
        </Label>
        <Input
          id="material"
          value={state.material}
          onChange={(event) => update('material', event.target.value)}
          placeholder="e.g. SABIC CYCOLOY C6600, or PC/ABS V-0 equivalent"
          className="h-12 text-base"
          autoComplete="off"
          required
        />
        <p className="text-sm text-muted-foreground">
          Use an exact manufacturer and grade, or describe a qualified equivalent.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="condition">Material condition</Label>
          <Select
            value={state.condition}
            onValueChange={(value) => update('condition', value as LotCondition)}
          >
            <SelectTrigger id="condition" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONDITION_KEYS.map((condition) => (
                <SelectItem key={condition} value={condition}>
                  {CONDITION_LABELS[condition]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="color">Color</Label>
          <Input
            id="color"
            value={state.color}
            onChange={(event) => update('color', event.target.value)}
            placeholder="Black, natural, any…"
            className="h-11"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="quantity">Approximate quantity (lb)</Label>
          <Input
            id="quantity"
            type="number"
            inputMode="decimal"
            min="1"
            step="any"
            value={state.quantityLb}
            onChange={(event) => update('quantityLb', event.target.value)}
            placeholder="5,000"
            className="h-11"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="needed-by">Needed by</Label>
          <Input
            id="needed-by"
            type="date"
            value={state.neededBy}
            onChange={(event) => update('neededBy', event.target.value)}
            className="h-11"
          />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-2">
          <Label htmlFor="destination">Deliver to</Label>
          <Input
            id="destination"
            value={state.destination}
            onChange={(event) => update('destination', event.target.value)}
            placeholder="Chicago, IL"
            className="h-11"
            autoComplete="address-level2"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="country">Country</Label>
          <Input
            id="country"
            value={state.country}
            onChange={(event) => update('country', event.target.value)}
            placeholder="USA"
            className="h-11"
            autoComplete="country-name"
            required
          />
        </div>
      </div>

      <label className="flex cursor-pointer gap-3 rounded-lg border border-border bg-muted/35 p-4">
        <input
          type="checkbox"
          checked={state.equivalentAllowed}
          onChange={(event) => update('equivalentAllowed', event.target.checked)}
          className="mt-1 size-4 accent-[var(--primary)]"
        />
        <span>
          <span className="block font-medium text-foreground">
            Qualified equivalents are welcome
          </span>
          <span className="mt-1 block text-sm leading-6 text-muted-foreground">
            Specialists may suggest another grade that meets the requirement. Uncheck this if the
            exact grade is mandatory.
          </span>
        </span>
      </label>

      <div className="space-y-2">
        <Label htmlFor="details">Anything else a specialist should know?</Label>
        <Textarea
          id="details"
          value={state.details}
          onChange={(event) => update('details', event.target.value)}
          placeholder="Annual usage, UL/FDA requirements, reinforcement, MFR, packaging, incumbent grade, or the problem you are solving…"
          className="min-h-28 resize-y"
          maxLength={1000}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/25 bg-destructive/8 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex max-w-sm gap-2 text-xs leading-5 text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          Your identity is hidden on the request. Specialists respond through a private Meldstock
          conversation.
        </p>
        <Button type="submit" size="lg" className="h-12 px-6" disabled={pending || sessionPending}>
          {pending
            ? 'Sending request…'
            : session?.user
              ? 'Send private request'
              : 'Continue to send'}
          {!pending ? <ArrowRight className="ml-1 size-4" aria-hidden /> : null}
        </Button>
      </div>
    </form>
  );
}
