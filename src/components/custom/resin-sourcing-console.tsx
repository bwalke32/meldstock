'use client';

import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Crosshair,
  MapPin,
  PackageSearch,
  Route,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normalizeResinInput } from '@/lib/business/resin-normalize';

const DRAFT_KEY = 'meldstock:material-request-draft';

const EXAMPLES = [
  'SABIC CYCOLOY C6600 Black',
  'PA66 GF33 V-0 Natural',
  'PP copolymer 20 MFI Black',
];

interface QuickBrief {
  material: string;
  quantityLb: string;
  destination: string;
  country: string;
  neededBy: string;
}

const EMPTY_BRIEF: QuickBrief = {
  material: '',
  quantityLb: '',
  destination: '',
  country: 'USA',
  neededBy: '',
};

export function ResinSourcingConsole() {
  const router = useRouter();
  const [brief, setBrief] = React.useState<QuickBrief>(EMPTY_BRIEF);
  const [error, setError] = React.useState<string | null>(null);

  const parsed = React.useMemo(
    () =>
      normalizeResinInput(brief.material, {
        mode: 'write',
        polymerCandidate: 'OTHER',
      }),
    [brief.material],
  );

  const checks = [
    Boolean(brief.material.trim()),
    Number.isFinite(Number(brief.quantityLb)) && Number(brief.quantityLb) > 0,
    Boolean(brief.destination.trim()),
    Boolean(brief.neededBy),
  ];
  const readiness = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  const recognized = parsed.chips.length > 0;

  const update = <K extends keyof QuickBrief>(key: K, value: QuickBrief[K]) => {
    setBrief((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  function continueRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = Number(brief.quantityLb);

    if (!brief.material.trim()) {
      setError('Enter a resin, manufacturer grade, or performance requirement.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Enter the approximate quantity in pounds.');
      return;
    }
    if (!brief.destination.trim() || !brief.country.trim()) {
      setError('Enter the delivery location and country.');
      return;
    }

    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        material: brief.material,
        condition: 'PRIME_VIRGIN',
        color: parsed.color ?? '',
        quantityLb: brief.quantityLb,
        destination: brief.destination,
        country: brief.country,
        neededBy: brief.neededBy,
        equivalentAllowed: true,
        details: '',
      }),
    );
    router.push('/request-material');
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-border bg-foreground px-5 py-3 text-background">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em]">
            Resin sourcing console
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-background/60">
          Deterministic spec parser
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={continueRequest} className="space-y-5 p-5 sm:p-7">
          <div className="space-y-2">
            <Label htmlFor="quick-material" className="text-base font-semibold">
              What resin do you need?
            </Label>
            <Input
              id="quick-material"
              value={brief.material}
              onChange={(event) => update('material', event.target.value)}
              placeholder="Manufacturer + grade, or technical requirement"
              className="h-12 text-base"
              autoComplete="off"
              autoFocus
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => update('material', example)}
                  className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-left font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quick-quantity">Quantity (lb)</Label>
              <Input
                id="quick-quantity"
                type="number"
                inputMode="decimal"
                min="1"
                value={brief.quantityLb}
                onChange={(event) => update('quantityLb', event.target.value)}
                placeholder="5,000"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-needed">Needed by</Label>
              <Input
                id="quick-needed"
                type="date"
                value={brief.neededBy}
                onChange={(event) => update('neededBy', event.target.value)}
                className="h-11"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1.35fr_0.65fr]">
            <div className="space-y-2">
              <Label htmlFor="quick-destination">Deliver to</Label>
              <Input
                id="quick-destination"
                value={brief.destination}
                onChange={(event) => update('destination', event.target.value)}
                placeholder="Chicago, IL"
                className="h-11"
                autoComplete="address-level2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-country">Country</Label>
              <Input
                id="quick-country"
                value={brief.country}
                onChange={(event) => update('country', event.target.value)}
                placeholder="USA"
                className="h-11"
                autoComplete="country-name"
              />
            </div>
          </div>

          {error ? (
            <p className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">
              Draft stays in this browser until you send it.
            </p>
            <Button type="submit" size="lg" className="h-12 px-6">
              Build sourcing brief
              <ArrowRight className="ml-1 size-4" aria-hidden />
            </Button>
          </div>
        </form>

        <aside className="border-t border-border bg-muted/30 p-5 sm:p-7 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                Live spec intelligence
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold text-foreground">
                {brief.material
                  ? recognized
                    ? 'Requirement recognized'
                    : 'Exact text preserved'
                  : 'Waiting for input'}
              </h2>
            </div>
            <div className="relative flex size-11 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
              <Crosshair className="size-5" aria-hidden />
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Brief strength</span>
              <span className="text-foreground">{readiness}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${readiness}%` }}
              />
            </div>
          </div>

          <div className="mt-6 min-h-20 rounded-lg border border-border bg-background p-4">
            {parsed.chips.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {parsed.chips.map((chip, index) => (
                  <span
                    key={`${chip.tone}-${chip.label}-${index}`}
                    className="rounded-full border border-primary/20 bg-primary/8 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary"
                  >
                    {chip.label}
                  </span>
                ))}
                {parsed.gradeCanonical ? (
                  <span className="rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-foreground">
                    Grade · {parsed.gradeCanonical}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                Enter resin shorthand or a full manufacturer grade. Unrecognized wording is kept
                intact for human review.
              </p>
            )}
          </div>

          <ol className="mt-6 space-y-3">
            <RouteStep
              icon={<PackageSearch />}
              label="Parse"
              value="Polymer, grade and modifiers"
              active={Boolean(checks[0])}
            />
            <RouteStep
              icon={<MapPin />}
              label="Route"
              value="Search and alerts by material + region"
              active={Boolean(checks[2])}
            />
            <RouteStep
              icon={<Route />}
              label="Connect"
              value="Private specialist responses"
              active={readiness >= 75}
            />
          </ol>

          <p className="mt-6 flex gap-2 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            Structured search and alerts first. Human material judgment handles equivalents and edge
              cases.
          </p>
        </aside>
      </div>
    </div>
  );
}

function RouteStep({
  icon,
  label,
  value,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-md border [&>svg]:size-4 ${
          active
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-border bg-background text-muted-foreground'
        }`}
      >
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
