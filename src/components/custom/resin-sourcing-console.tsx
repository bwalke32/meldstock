'use client';

import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  FileSearch2,
  ListChecks,
  ScanText,
  Sparkles,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { buildDeterministicMaterialIntakeBatch } from '@/lib/business/material-intake';

const DRAFT_KEY = 'meldstock:material-request-draft';

const EXAMPLES = [
  'Need 5,000/lbs. of Regrind ABS Injection-Grade Natural ASAP, FOB point is Romeoville, IL. Also looking for ~10-20k/lbs. of Regrind, PC Injection Grade 112 Blue-Tint Clear delivered to Romeoville, Illinois.',
  'Need 5,000 lbs of SABIC CYCOLOY C6600 Black delivered to Chicago, IL. Prime preferred, equivalents acceptable, UL94 V-0 required.',
  'Looking for PA66 GF33 natural, 2,204 lbs, exact grade only, delivered to Monterrey, Mexico by 2026-09-30.',
  'Need a 20 MFI black PP copolymer for injection molding. Annual usage is 250,000 lbs. First 42,000 lbs to Joliet, IL.',
];

export function ResinSourcingConsole() {
  const router = useRouter();
  const [requestText, setRequestText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const preview = React.useMemo(
    () => (requestText.trim() ? buildDeterministicMaterialIntakeBatch(requestText) : null),
    [requestText],
  );
  const recognized =
    preview?.items.flatMap((item, requestIndex) =>
      item.recognized.slice(0, 6).map((field) => ({ ...field, requestIndex })),
    ) ?? [];
  const coverage = Math.min(100, Math.round((recognized.length / 7) * 100));

  function continueRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = requestText.trim();
    if (text.length < 8) {
      setError('Describe the resin, quantity, destination, or performance requirement.');
      return;
    }

    const batch = buildDeterministicMaterialIntakeBatch(text);
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        sourceText: text,
        drafts: batch.items.map(({ draft }) => ({
          material: draft.material,
          condition: draft.condition,
          color: draft.color,
          quantityLb: draft.quantityLb?.toString() ?? '',
          destination: draft.destination,
          country: draft.country,
          neededBy: draft.neededBy,
          equivalentAllowed: draft.equivalentAllowed,
          details: draft.details,
        })),
        createdRequests: {},
      }),
    );
    router.push('/request-material');
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-border bg-foreground px-5 py-3 text-background">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em]">
            AI material request copilot
          </span>
        </div>
        <span className="hidden font-mono text-[10px] uppercase tracking-wider text-background/60 sm:block">
          Private review before sending
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.12fr_0.88fr]">
        <form onSubmit={continueRequest} className="space-y-5 p-5 sm:p-7">
          <div className="space-y-2">
            <Label htmlFor="sourcing-requirement" className="text-base font-semibold">
              Paste the material need in your own words
            </Label>
            <Textarea
              id="sourcing-requirement"
              value={requestText}
              onChange={(event) => {
                setRequestText(event.target.value);
                setError(null);
              }}
              placeholder="Example: Need 5,000 lbs of black PC/ABS equivalent to CYCOLOY C6600, delivered to Chicago within three weeks. Prime preferred; UL94 V-0 required."
              className="min-h-40 resize-y text-base leading-7"
              maxLength={4000}
              autoFocus
            />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Paste a full email—even when it contains several materials.</span>
              <span className="font-mono tabular-nums">{requestText.length}/4000</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example, index) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setRequestText(example);
                  setError(null);
                }}
                className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                Try example {index + 1}
              </button>
            ))}
          </div>

          {error ? (
            <p className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              Meldstock organizes the requirement. Nothing is published until you review and send
              it.
            </p>
            <Button type="submit" size="lg" className="h-12 px-6">
              Analyze requirement
              <ArrowRight className="ml-1 size-4" aria-hidden />
            </Button>
          </div>
        </form>

        <aside className="border-t border-border bg-muted/30 p-5 sm:p-7 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                Instant local preview
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold text-foreground">
                {requestText
                  ? preview && preview.items.length > 1
                    ? `${preview.items.length} requests taking shape`
                    : 'Requirement taking shape'
                  : 'Waiting for a requirement'}
              </h2>
            </div>
            <span className="flex size-11 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
              <ScanText className="size-5" aria-hidden />
            </span>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Fields recognized</span>
              <span className="text-foreground">{recognized.length}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${coverage}%` }}
              />
            </div>
          </div>

          <div className="mt-6 min-h-28 rounded-lg border border-border bg-background p-4">
            {recognized.length ? (
              <div className="flex flex-wrap gap-2">
                {recognized.slice(0, 12).map((item) => (
                  <span
                    key={`${item.requestIndex}-${item.field}-${item.value}`}
                    className="rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary"
                  >
                    {preview && preview.items.length > 1 ? `R${item.requestIndex + 1} · ` : ''}
                    {item.label} · {item.value}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                Meldstock first checks known resin terms and quantities locally. The protected AI
                pass then organizes ambiguous wording and identifies missing information.
              </p>
            )}
          </div>

          <ol className="mt-6 space-y-3">
            <RouteStep
              icon={<FileSearch2 />}
              label="Extract"
              value="Resin, grade and commercial facts"
            />
            <RouteStep
              icon={<ListChecks />}
              label="Check"
              value="Contradictions and missing details"
            />
            <RouteStep
              icon={<CheckCircle2 />}
              label="Confirm"
              value="Editable brief before private release"
            />
          </ol>
        </aside>
      </div>
    </div>
  );
}

function RouteStep({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary [&>svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm font-medium text-foreground">{value}</p>
      </div>
    </li>
  );
}
