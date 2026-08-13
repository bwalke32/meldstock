// @polsia:user-owned — interactive persona toggle for the hero. Client.

'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface Persona {
  key: string;
  label: string;
  lede: string;
  ask: string;
}

const PERSONAS: readonly [Persona, Persona, Persona] = [
  {
    key: 'molder',
    label: 'Injection molder',
    lede: 'Need 12 truckloads of FDA-grade recycled-content PET for a short white-goods run.',
    ask: 'Smithton Custom Moldings · 5 days ago',
  },
  {
    key: 'broker',
    label: 'Resin broker',
    lede: 'Broker two lots of post-industrial ABS from a Tier-1 stampings plant, EU origin.',
    ask: 'Aurora Polymers · 2 hours ago',
  },
  {
    key: 'surplus',
    label: 'Surplus seller',
    lede: 'Post 38 t of off-spec PP from a Q2 production line. Tier-2 cosmetic, lots of options.',
    ask: 'Northgate Compounds · yesterday',
  },
];

export function MeldstockHeroToggle() {
  const [active, setActive] = React.useState<string>('molder');
  const idx = PERSONAS.findIndex((p) => p.key === active);
  const found = idx >= 0 ? PERSONAS[idx] : undefined;
  const current: Persona = found ?? PERSONAS[0];

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Marketplace perspective" className="flex flex-wrap gap-1">
        {PERSONAS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={p.key === active}
            onClick={() => setActive(p.key)}
            className={cn(
              'h-8 rounded-full border border-border px-3 text-xs font-semibold uppercase tracking-wider transition-all duration-200 ease-out-expo',
              p.key === active
                ? 'bg-primary text-primary-foreground shadow-brand'
                : 'bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <Card className="border-border bg-card">
        <CardContent className="flex flex-col gap-3 p-5">
          <p className="text-sm leading-relaxed text-foreground">{current.lede}</p>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">{current.ask}</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              live
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
