// @polsia:user-owned — home page for Meldstock served at /. Single-page marketing
// landing: hero + marketplace mock + intelligence + workflow + compliance + FAQ + CTA.
// Server Component (metadata lives here, do not add 'use client' at the top —
// interactivity lives in child client components). The global SiteNav + SiteFooter
// mount around this in src/app/layout.tsx; do NOT add a second header/footer.

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Meldmark,
  MeldstockFAQ,
  Sparkline,
  StatusBadge,
} from '@/components/custom/meldstock-markup';
import { MeldstockHeroToggle } from '@/components/custom/meldstock-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { siteDescription, siteName } from '@/lib/site';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: { absolute: siteName },
  description: siteDescription,
  alternates: { canonical: '/' },
};

// --- Static data the server renders ---------------------------------
interface Lot {
  id: string;
  grade: string;
  form: string;
  origin: string;
  recycled: string;
  size: string;
  posted: string;
  reserve: string;
  status: 'available' | 'reserved' | 'gone';
}

const LOTS: Lot[] = [
  {
    id: 'L-2084',
    grade: 'r-PET',
    form: 'Pellet · food-contact',
    origin: 'EU · DE',
    recycled: '50% PCR',
    size: '38 t',
    posted: '2h ago',
    reserve: '$1.42/lb',
    status: 'available',
  },
  {
    id: 'L-2081',
    grade: 'ABS nat.',
    form: 'Post-industrial',
    origin: 'US · OH',
    recycled: '0% · cosmetically off',
    size: '12 t',
    posted: '3h ago',
    reserve: '$0.96/lb',
    status: 'reserved',
  },
  {
    id: 'L-2079',
    grade: 'PP homopol.',
    form: 'Baled regrind',
    origin: 'MX · NL',
    recycled: '30% PIR',
    size: '8 t',
    posted: '11h ago',
    reserve: '$0.71/lb',
    status: 'available',
  },
  {
    id: 'L-2076',
    grade: 'PC clar.',
    form: 'Regrind ≤3%',
    origin: 'DE · BY',
    recycled: '0%',
    size: '5 t',
    posted: '1d ago',
    reserve: '$2.10/lb',
    status: 'reserved',
  },
  {
    id: 'L-2073',
    grade: 'HDPE virgin',
    form: 'Off-spec A',
    origin: 'CA · ON',
    recycled: '0%',
    size: '24 t',
    posted: '2d ago',
    reserve: '$0.83/lb',
    status: 'gone',
  },
];

const REGIONAL_PREMIUM = [
  {
    region: 'US Gulf',
    delta: '+0.06',
    tone: 'up' as const,
    span: [102, 106, 110, 108, 113, 118, 121, 124],
    note: 'PP tightens on Q3 OEM restock.',
  },
  {
    region: 'EU North',
    delta: '-0.12',
    tone: 'down' as const,
    span: [120, 119, 117, 116, 113, 111, 109, 107],
    note: 'r-PET cools ahead of PPWR review.',
  },
  {
    region: 'MX Border',
    delta: '+0.21',
    tone: 'up' as const,
    span: [104, 107, 111, 114, 117, 120, 124, 129],
    note: 'Nearshoring pulls ABS to a premium.',
  },
  {
    region: 'APEC',
    delta: '+0.04',
    tone: 'flat' as const,
    span: [100, 101, 102, 102, 103, 103, 104, 104],
    note: 'HDPE range-bound, freight soft.',
  },
];

const COMPLIANCE_RULES = [
  {
    code: 'PPWR',
    region: 'EU',
    label: 'Packaging & Packaging Waste Regulation',
    state: 'in effect',
  },
  {
    code: 'EPR-CA',
    region: 'US-CA',
    label: 'California SB 54 — PCR thresholds',
    state: '2027 cycle',
  },
  { code: 'EPR-ME', region: 'US-ME', label: 'Maine stewardship plan', state: 'filed' },
  {
    code: 'eCFR 261.4',
    region: 'US-Fed',
    label: 'Excluded scrap — reclassification',
    state: 'audited',
  },
  {
    code: 'ISCC PLUS',
    region: 'Global',
    label: 'Mass-balance chain-of-custody',
    state: 'credentialed',
  },
  {
    code: 'FDA 21 CFR 174',
    region: 'Global',
    label: 'Food-contact migration bound',
    state: 'on request',
  },
];

const WORKFLOW = [
  {
    n: '01',
    title: 'Post the lot',
    body: 'Structured spec sheet — grade · MFR/MFI · lot size · origin · PCR/PIR · cert list. Mobile-friendly, takes about 90 seconds.',
  },
  {
    n: '02',
    title: 'Match & negotiate',
    body: 'Counterparties see comparable-lot history and live regional premium signals. Inquiry threads, sample logistics, and broker flags all live on the listing.',
  },
  {
    n: '03',
    title: 'Settle in escrow',
    body: "Funds, COA documentation, and freight cleared in one workflow. Resin only releases after the buyer's lab checks the PO lot.",
  },
  {
    n: '04',
    title: 'Reconcile & report',
    body: 'Lot provenance becomes a reusable record — recycled-content claims, country of origin, ECCN codes — exportable for EU PPWR and US EPR filings.',
  },
];

const FAQ = [
  {
    q: 'Is Meldstock a broker?',
    a: 'No. Meldstock is the exchange — molders, brokers, and surplus sellers all list directly. Brokers stay brokers; we provide the infrastructure they already wished they had: structured specs, comparable history, escrow, and a clean paper trail at settlement.',
  },
  {
    q: 'How do you handle recycled-content claims?',
    a: 'Every listing carries a separate recycled-content field with PCR vs PIR split, the chain-of-custody scheme (ISCC PLUS, SCS, mass-balance) when available, and the issuing registry. These fields flow through to settlement and the post-trade reconciliation report so the claim survives the move.',
  },
  {
    q: 'What about EU PPWR and US state EPR?',
    a: 'We associate each listing with the rules it touches — PPWR, state-by-state EPR, FDA migration, ECCN — and surface the relevant flags on both sides of the trade. The reconciliation export is shaped so it can be filed directly; you do not need to re-key the data into a parallel compliance tool.',
  },
  {
    q: 'What lot sizes does the marketplace cover?',
    a: "Anything from a single truckload to a slow-moving bulk inventory write-down. The early cohort skews short-run, specialty, recycled-content, and post-industrial surplus — the lots that exist because the relationship machinery for prime-grade offtakes doesn't reach them.",
  },
  {
    q: 'How is pricing set?',
    a: 'Listings carry a posted reserve. We do not set a clearing price — buyers and sellers transact against the reserve, with regional premium and discount signal overlays supplied as market intelligence, not a hidden watermark. Espresso-fair, not auction-house.',
  },
];

export default function MeldstockHome() {
  return (
    <main className="relative isolate">
      {/* ============== HERO ====================================================== */}
      <section
        id="top"
        className="relative overflow-hidden border-b border-border"
        aria-labelledby="hero-headline"
      >
        {/* Sharp repeating grid in the background, brand-tinted via tokens. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.18] dark:opacity-[0.22]"
          style={{
            backgroundImage:
              'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(ellipse at 70% 30%, black 0%, transparent 70%)',
          }}
        />
        <Meldmark className="pointer-events-none absolute -right-32 -top-24 hidden h-[640px] w-[640px] opacity-90 lg:block" />

        <div className="container-page relative grid grid-cols-1 gap-12 pb-section-lg pt-section md:grid-cols-12 md:gap-10">
          <div className="flex flex-col gap-6 md:col-span-7 lg:col-span-7">
            <span className="text-eyebrow">Vertical plastics exchange · est. 2026</span>
            <h1
              id="hero-headline"
              className="font-display text-h1 leading-[0.95] tracking-[-0.025em] text-foreground md:text-[3.6rem] lg:text-display"
            >
              <span className="block">Spot resin,</span>
              <span className="block">
                with the <span className="text-primary">spec sheet</span> intact.
              </span>
            </h1>
            <p className="max-w-xl text-balance text-body-lg text-muted-foreground">
              {siteName} is the structured marketplace for injection molders, resin brokers, and the
              surplus sellers who move off-spec and recycled-content lots. Every listing carries
              grade, origin, recycled content, and compliance; every trade leaves a paper trail your
              regulator already recognizes.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/trading-floor">
                  Open the trading floor
                  <span aria-hidden className="ml-1">
                    →
                  </span>
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/post-a-lot">Post a lot</Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="#lots">See what&apos;s listed right now</Link>
              </Button>
            </div>
            <ul className="mt-4 grid grid-cols-1 gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Mobile-first — push from the press cell
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Escrow, COA, freight, one workflow
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                PPWR + state EPR ready
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-4 md:col-span-5 lg:col-span-5">
            <Card className="relative border-border bg-card shadow-brand">
              <CardHeader className="border-b border-border pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Live lot feed
                  </CardTitle>
                  <StatusBadge tone="available">5 / 7 active</StatusBadge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 p-5">
                {LOTS.slice(0, 3).map((lot) => (
                  <article
                    key={lot.id}
                    className="group relative flex flex-col gap-2 rounded-md border border-border bg-background p-4 transition-all duration-200 ease-out-expo hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm"
                  >
                    <header className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                          <span>{lot.id}</span>
                          <span>·</span>
                          <span>{lot.posted}</span>
                        </div>
                        <h3 className="font-display text-base font-semibold text-foreground">
                          {lot.grade} <span className="text-muted-foreground/80">— {lot.form}</span>
                        </h3>
                      </div>
                      <StatusBadge tone={lot.status}>
                        {lot.status === 'available'
                          ? 'open'
                          : lot.status === 'reserved'
                            ? 'on hold'
                            : 'closed'}
                      </StatusBadge>
                    </header>
                    <dl className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider">Origin</dt>
                        <dd className="text-foreground">{lot.origin}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider">PCR/PIR</dt>
                        <dd className="text-foreground">{lot.recycled}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider">Lot</dt>
                        <dd className="text-foreground">{lot.size}</dd>
                      </div>
                    </dl>
                    <footer className="flex items-center justify-between border-t border-border pt-2">
                      <span className="font-mono text-sm text-primary">reserve {lot.reserve}</span>
                      <span className="text-xs text-muted-foreground">comparables: 14</span>
                    </footer>
                  </article>
                ))}
                <p className="text-center text-xs text-muted-foreground">
                  Updated every 4 min · 42 listings in 6 regions right now
                </p>
              </CardContent>
            </Card>

            <MeldstockHeroToggle />
          </div>
        </div>
      </section>

      {/* ============== VALUE PROPOSITION RAIL ================================== */}
      <section
        id="value"
        aria-labelledby="value-headline"
        className="section border-b border-border bg-muted/30"
      >
        <div className="container-page">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
            <h2
              id="value-headline"
              className="font-display text-h2 leading-tight text-foreground md:col-span-7 tracking-[-0.02em]"
            >
              The molders-broker-seller triangle, finally on infrastructure.
            </h2>
            <p className="text-body-lg leading-relaxed text-muted-foreground md:col-span-5">
              Horizontal classifieds couldn&apos;t carry a COA, a recycled-content claim, or a PPWR
              citation. Meldstock is built specifically around the three sides of the spot trade,
              with the data shape each side already needs.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              {
                eyebrow: 'For molders',
                title: 'Short-run, specialty, recycled-content — locatable today.',
                body: 'Post what your line actually needs: grade, MFR window, recycled-content minimum, food-contact requirement. We surface matching lots across primary and surplus channels.',
              },
              {
                eyebrow: 'For brokers',
                title: 'Move distressed inventory without pricing it into a year-long offtake.',
                body: 'Structured spec sheets, clear origin, cert list, and a buyer pool that already trusts the listing shape. Your team keeps the relationship; we keep the data.',
              },
              {
                eyebrow: 'For surplus sellers',
                title: 'Get the lot off the floor without a written-down fire sale.',
                body: 'Producers move excess without signing away a year of offtake. Lots are visible to buyers looking specifically for off-spec, post-industrial, and grade-flexible inventory.',
              },
            ].map((card) => (
              <Card
                key={card.eyebrow}
                className="border-border bg-card transition-all duration-200 ease-out-expo hover:-translate-y-0.5 hover:shadow-lg"
              >
                <CardHeader className="gap-2 pb-4">
                  <span className="text-eyebrow">{card.eyebrow}</span>
                  <CardTitle className="font-display text-xl leading-snug text-foreground">
                    {card.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-body leading-relaxed text-muted-foreground">
                  {card.body}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ============== MARKETPLACE / LOTS =================================== */}
      <section id="lots" aria-labelledby="lots-headline" className="section border-b border-border">
        <div className="container-page">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <span className="text-eyebrow">Marketplace</span>
              <h2
                id="lots-headline"
                className="mt-2 font-display text-h2 leading-tight tracking-[-0.02em] text-foreground"
              >
                Every lot is a spec sheet you can read in five seconds.
              </h2>
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              The fields you&apos;d put on a COA — grade, MFR, lot size, origin, recycled content,
              certifications — live on the listing, not buried in a PDF the buyer has to email
              somebody to open.
            </p>
          </div>

          {/* Lot table */}
          <div className="mt-10 overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-12 gap-3 border-b border-border bg-muted/40 px-5 py-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <div className="col-span-2">Lot</div>
              <div className="col-span-3">Grade</div>
              <div className="col-span-2">Origin</div>
              <div className="col-span-2">Recycled</div>
              <div className="col-span-2 text-right">Reserve</div>
              <div className="col-span-1 text-right">Status</div>
            </div>
            {LOTS.map((lot) => (
              <Link
                key={lot.id}
                href="mailto:contact@meldstock.example"
                className="grid grid-cols-12 items-center gap-3 border-b border-border px-5 py-4 text-sm transition-colors duration-150 last:border-b-0 hover:bg-muted/30"
              >
                <div className="col-span-2 font-mono text-xs text-muted-foreground">{lot.id}</div>
                <div className="col-span-3">
                  <div className="font-semibold text-foreground">{lot.grade}</div>
                  <div className="text-xs text-muted-foreground">{lot.form}</div>
                </div>
                <div className="col-span-2 text-foreground">{lot.origin}</div>
                <div className="col-span-2 text-foreground">{lot.recycled}</div>
                <div className="col-span-2 text-right font-mono text-primary">{lot.reserve}</div>
                <div className="col-span-1 flex justify-end">
                  <StatusBadge tone={lot.status}>
                    {lot.status === 'available'
                      ? 'open'
                      : lot.status === 'reserved'
                        ? 'hold'
                        : 'closed'}
                  </StatusBadge>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>42 active · 7 pending · 3 closed today</span>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="mailto:contact@meldstock.example">Get full feed</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/post-a-lot">Post a lot</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ============== MARKET INTELLIGENCE =================================== */}
      <section
        id="intelligence"
        aria-labelledby="intelligence-headline"
        className="section-lg border-b border-border bg-card/60"
      >
        <div className="container-page">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:items-end">
            <div className="md:col-span-7">
              <span className="text-caption font-semibold uppercase tracking-[0.12em] text-primary">
                Market intelligence
              </span>
              <h2
                id="intelligence-headline"
                className="mt-3 font-display text-h2 leading-[1.05] tracking-[-0.025em]"
              >
                Listings layered with the data the trade usually hides.
              </h2>
            </div>
            <p className="text-body-lg leading-relaxed text-muted-foreground md:col-span-5">
              Historical price trends, regional premium and discount signals, comparable-lot
              history, and compliance flags tied to PPWR and US state-level EPR laws — surfaced on
              every lot, not buried in a separate PDF.
            </p>
          </div>

          {/* Regional pulse grid */}
          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {REGIONAL_PREMIUM.map((r) => (
              <Card
                key={r.region}
                className={cn(
                  'border-border bg-card text-card-foreground transition-all duration-200 ease-out-expo hover:-translate-y-0.5 hover:shadow-lg',
                )}
              >
                <CardHeader className="gap-2 pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-caption font-mono uppercase tracking-[0.16em] text-muted-foreground">
                      {r.region}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'rounded-full border px-2 py-0.5 font-mono text-[10px]',
                        r.tone === 'up'
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : r.tone === 'down'
                            ? 'border-border bg-muted text-muted-foreground'
                            : 'border-border bg-secondary text-secondary-foreground',
                      )}
                    >
                      {r.delta}
                    </Badge>
                  </div>
                  <Sparkline
                    series={r.span}
                    uid={`reg-${r.region.replace(/\s+/g, '-')}`}
                    className="h-12 w-full"
                  />
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">{r.note}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Demand + premium versus baseline */}
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="border-border bg-card text-card-foreground">
              <CardHeader>
                <span className="text-caption font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  Spot PP demand index
                </span>
                <CardTitle className="font-display text-3xl tracking-tight text-foreground">
                  68
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline
                  series={[42, 47, 45, 50, 54, 51, 56, 60, 62, 65, 63, 68]}
                  uid="demand-pp"
                  className="mt-1 h-10 w-full"
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  +62% YoY · post-industrial recycled feed steady
                </p>
              </CardContent>
            </Card>
            <Card className="border-border bg-card text-card-foreground">
              <CardHeader>
                <span className="text-caption font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  r-PET premium vs virgin
                </span>
                <CardTitle className="font-display text-3xl tracking-tight text-foreground">
                  +1.25×
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline
                  series={[0.92, 0.96, 0.99, 1.02, 1.05, 1.08, 1.11, 1.13, 1.16, 1.19, 1.22, 1.25]}
                  uid="rpet-prem"
                  className="mt-1 h-10 w-full"
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  PPWR effect stabilizing premium through 2026
                </p>
              </CardContent>
            </Card>
            <Card className="border-border bg-card text-card-foreground">
              <CardHeader>
                <span className="text-caption font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  Buyer-side inquiries
                </span>
                <CardTitle className="font-display text-3xl tracking-tight text-foreground">
                  86
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline
                  series={[60, 62, 65, 64, 68, 72, 75, 73, 78, 82, 84, 86]}
                  uid="inq"
                  className="mt-1 h-10 w-full"
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  Recycled-content requests up 4× in 12 months
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ============== COMPLIANCE MATRIX ===================================== */}
      <section
        id="compliance"
        aria-labelledby="compliance-headline"
        className="section border-b border-border bg-muted/30"
      >
        <div className="container-page">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <span className="text-eyebrow">Compliance</span>
              <h2
                id="compliance-headline"
                className="mt-2 font-display text-h2 leading-tight tracking-[-0.02em] text-foreground"
              >
                Rules live on the listing, not in a separate spreadsheet.
              </h2>
              <p className="mt-4 text-body leading-relaxed text-muted-foreground">
                The reconciliation report you file with your regulator is the same shape as the lot
                header the seller posted at intake. PPWR, state-by-state EPR, mass- balance
                chain-of-custody — surfaced on both sides of the trade.
              </p>
            </div>

            <ul className="md:col-span-7">
              {COMPLIANCE_RULES.map((rule, idx) => (
                <li
                  key={rule.code}
                  className="grid grid-cols-12 items-center gap-3 border-b border-border py-4 first:border-t"
                >
                  <span className="col-span-1 font-mono text-xs text-muted-foreground">
                    {(idx + 1).toString().padStart(2, '0')}
                  </span>
                  <span className="col-span-2 font-mono text-sm font-semibold text-primary">
                    {rule.code}
                  </span>
                  <span className="col-span-5 text-sm font-medium text-foreground">
                    {rule.label}
                  </span>
                  <span className="col-span-2 font-mono text-xs text-muted-foreground">
                    {rule.region}
                  </span>
                  <span className="col-span-2 text-right">
                    <Badge
                      variant="outline"
                      className="rounded-full font-mono text-[10px] uppercase tracking-wider"
                    >
                      {rule.state}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ============== WORKFLOW ============================================== */}
      <section
        id="workflow"
        aria-labelledby="workflow-headline"
        className="section-lg border-b border-border"
      >
        <div className="container-page">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <span className="text-eyebrow">Workflow</span>
              <h2
                id="workflow-headline"
                className="mt-2 font-display text-h2 leading-tight tracking-[-0.02em] text-foreground"
              >
                From spec sheet to settlement — one continuous workflow.
              </h2>
              <p className="mt-5 text-body leading-relaxed text-muted-foreground">
                Inquiry, sample logistics, escrow, COA documentation, post-trade lot reconciliation
                — and mobile-first throughout, so a purchasing lead can confirm a lot from the press
                cell and a broker can push a distressed listing from a warehouse.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-6">
                <Link href="mailto:contact@meldstock.example">Walk me through it</Link>
              </Button>
            </div>

            <ol className="grid grid-cols-1 gap-4 md:col-span-7 md:grid-cols-2">
              {WORKFLOW.map((step) => (
                <li
                  key={step.n}
                  className="relative flex flex-col gap-3 rounded-lg border border-border bg-card p-6"
                >
                  <span className="font-display text-5xl font-bold leading-none text-primary/40">
                    {step.n}
                  </span>
                  <h3 className="font-display text-lg font-semibold leading-tight text-foreground">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ============== GRADES INDEX (resources group target) ================ */}
      <section
        id="grades"
        aria-labelledby="grades-headline"
        className="section border-b border-border"
      >
        <div className="container-page">
          <div className="flex flex-col gap-2">
            <span className="text-eyebrow">Grade index</span>
            <h2
              id="grades-headline"
              className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground"
            >
              Built around the thermoset winners, then the rest.
            </h2>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {[
              'r-PET',
              'r-HDPE',
              'r-PP',
              'ABS',
              'PC',
              'PMMA',
              'PA6',
              'PA66',
              'PBT',
              'TPU',
              'POM',
              'r-PS',
            ].map((grade) => (
              <div
                key={grade}
                className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-sm font-mono font-semibold text-foreground transition-all duration-200 ease-out-expo hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm"
              >
                <span>{grade}</span>
                <span className="text-[10px] text-muted-foreground">12+ / 5+</span>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>Active grades · counts are listings today / open inquiry threads</span>
            <Button asChild variant="link" size="sm" className="px-0">
              <Link href="mailto:contact@meldstock.example">Request a grade index →</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ============== FAQ ================================================== */}
      <section
        id="faq"
        aria-labelledby="faq-headline"
        className="section border-b border-border bg-muted/30"
      >
        <div className="container-page">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
            <div className="md:col-span-4">
              <span className="text-eyebrow">Frequently asked</span>
              <h2
                id="faq-headline"
                className="mt-2 font-display text-h2 leading-tight tracking-[-0.02em] text-foreground"
              >
                The questions brokers, molders, and surplus sellers ask first.
              </h2>
              <p className="mt-5 text-body leading-relaxed text-muted-foreground">
                More questions? We host a live walkthrough every Thursday — bring your own lot
                history and we&apos;ll show you what Meldstock would&apos;ve priced and routed.
              </p>
            </div>
            <div className="md:col-span-8">
              <MeldstockFAQ items={FAQ} />
            </div>
          </div>
        </div>
      </section>

      {/* ============== CTA ================================================== */}
      <section
        id="pricing"
        aria-labelledby="cta-headline"
        className="section-lg relative overflow-hidden"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 30% 20%, var(--primary) 0%, transparent 50%), radial-gradient(circle at 80% 70%, var(--primary) 0%, transparent 50%)',
          }}
        />
        <div className="container-page relative grid grid-cols-1 gap-10 md:grid-cols-12 md:items-center">
          <div className="md:col-span-7">
            <span className="text-eyebrow">Get in</span>
            <h2
              id="cta-headline"
              className="mt-2 font-display text-display leading-[0.98] tracking-[-0.025em] text-foreground md:text-[3.4rem]"
            >
              Post a lot.
              <br />
              <span className="text-primary">Or buy one.</span>
            </h2>
            <p className="mt-5 max-w-xl text-body-lg text-muted-foreground">
              The early cohort is open. We&apos;re onboarding brokers, molders, and surplus sellers
              through Q3 — lots first, then a deeper UI later.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="mailto:contact@meldstock.example">contact@meldstock.example</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="mailto:contact@meldstock.example?subject=Demo%20request">
                  Book a Thursday walkthrough
                </Link>
              </Button>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              We respond within one business day. Domain inbox is real and staffed.
            </p>
          </div>

          <div className="md:col-span-5">
            <Card className="border-border bg-card shadow-lg">
              <CardHeader>
                <CardTitle className="font-display text-lg tracking-tight text-foreground">
                  What we&apos;ll need on the first call
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-primary/15 font-mono text-[10px] font-bold text-primary">
                      1
                    </span>
                    Your volume — pounds/week, recycle mix, region of origin
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-primary/15 font-mono text-[10px] font-bold text-primary">
                      2
                    </span>
                    Which rules matter first — PPWR, state EPR, FDA, ECCN
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-primary/15 font-mono text-[10px] font-bold text-primary">
                      3
                    </span>
                    A representative lot header — we&apos;ll wire the rest
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}
