// @polsia:user-owned — focused injection-molder sourcing request.
'use client';

import {
  ArrowRight,
  CheckCircle2,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
} from 'lucide-react';
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
import {
  type MaterialIntakeAnalysis,
  MaterialIntakeAnalysis as MaterialIntakeAnalysisSchema,
} from '@/lib/contracts/material-intake';

const DRAFT_KEY = 'meldstock:material-request-draft';

interface FormState {
  sourceText: string;
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
  sourceText: '',
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
  const [analyzing, setAnalyzing] = React.useState(false);
  const [analysis, setAnalysis] = React.useState<MaterialIntakeAnalysis | null>(null);
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
    setError(null);
  };

  async function analyzeRequirement() {
    const requestText = state.sourceText.trim();
    setError(null);
    if (requestText.length < 8) {
      setError('Paste or describe the material requirement before analyzing it.');
      return;
    }

    if (!session?.user) {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
      toast.info('Your requirement is saved. Create a free account to run the private analysis.');
      window.location.assign('/signup?role=molder&next=/request-material');
      return;
    }

    setAnalyzing(true);
    try {
      const result = await apiFetch('/api/ai/material-intake', {
        method: 'POST',
        body: JSON.stringify({ requestText }),
        schema: MaterialIntakeAnalysisSchema,
      });
      const next: FormState = {
        ...state,
        material: result.draft.material,
        condition: result.draft.condition,
        color: result.draft.color,
        quantityLb: result.draft.quantityLb?.toString() ?? '',
        destination: result.draft.destination,
        country: result.draft.country,
        neededBy: result.draft.neededBy,
        equivalentAllowed: result.draft.equivalentAllowed,
        details: result.draft.details,
      };
      setState(next);
      setAnalysis(result);
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      toast.success('Sourcing brief prepared. Review every field before sending.');
    } catch {
      setError('Meldstock could not analyze the requirement. You can still complete it manually.');
    } finally {
      setAnalyzing(false);
    }
  }

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
      <section className="overflow-hidden rounded-xl border border-primary/20 bg-primary/5">
        <div className="flex flex-col gap-4 border-b border-primary/15 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                AI request copilot
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold text-foreground">
                Turn the raw requirement into an editable sourcing brief.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Paste an email or type naturally. Meldstock extracts commercial and technical facts,
                then asks only for what is missing.
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-primary/20 bg-background px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
            Review required
          </span>
        </div>

        <div className="space-y-4 p-5">
          <div className="space-y-2">
            <Label htmlFor="source-text">Raw material request</Label>
            <Textarea
              id="source-text"
              value={state.sourceText}
              onChange={(event) => update('sourceText', event.target.value)}
              placeholder="Need 5,000 lbs of SABIC CYCOLOY C6600 Black delivered to Chicago within three weeks. Prime preferred; UL94 V-0 required; equivalents acceptable."
              className="min-h-32 resize-y bg-background leading-6"
              maxLength={4000}
            />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Nothing is published by the analysis.</span>
              <span className="font-mono tabular-nums">{state.sourceText.length}/4000</span>
            </div>
          </div>

          <Button
            type="button"
            onClick={analyzeRequirement}
            disabled={analyzing || sessionPending}
            className="w-full sm:w-auto"
          >
            {analyzing ? (
              <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="mr-2 size-4" aria-hidden />
            )}
            {analyzing
              ? 'Analyzing requirement…'
              : session?.user
                ? 'Analyze and build brief'
                : 'Continue to private analysis'}
          </Button>

          {analysis ? (
            <div className="grid gap-4 border-t border-primary/15 pt-5 lg:grid-cols-[1fr_0.9fr]">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <CheckCircle2 className="size-4 text-primary" aria-hidden />
                  {analysis.engine === 'ai' ? 'AI analysis complete' : 'Local analysis complete'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {analysis.recognized.map((item) => (
                    <span
                      key={`${item.field}-${item.value}`}
                      className="rounded-full border border-primary/20 bg-background px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary"
                    >
                      {item.label} · {item.value}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {analysis.engine === 'ai'
                    ? 'Structured AI extraction was combined with Meldstock’s resin parser.'
                    : 'AI is disabled in this environment, so Meldstock used its local resin parser.'}
                </p>
              </div>

              <div className="rounded-lg border border-border bg-background p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ListChecks className="size-4 text-primary" aria-hidden />
                  Confirm before sending
                </p>
                {analysis.questions.length ? (
                  <ul className="mt-3 space-y-2 text-sm leading-5 text-muted-foreground">
                    {analysis.questions.map((question) => (
                      <li key={question} className="flex gap-2">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                        {question}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    The main sourcing fields were found. Check the editable form below for accuracy.
                  </p>
                )}
              </div>

              {analysis.cautions.length ? (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-4 text-xs leading-5 text-muted-foreground lg:col-span-2">
                  {analysis.cautions.join(' ')}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <div className="border-t border-border pt-1">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
          Review and confirm
        </p>
      </div>

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
