// @polsia:user-owned — executable public entry for the Meldstock sourcing network.
// Server Component. The interactive sourcing console is isolated in a client component.

import {
  ArrowRight,
  Check,
  DatabaseZap,
  LockKeyhole,
  Network,
  ScanSearch,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ResinSourcingConsole } from '@/components/custom/resin-sourcing-console';
import { Button } from '@/components/ui/button';
import { siteDescription, siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: { absolute: siteName },
  description: siteDescription,
  alternates: { canonical: '/' },
};

export default function MeldstockHome() {
  return (
    <main>
      <section className="relative overflow-hidden border-b border-border bg-background">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              'radial-gradient(circle at 76% 8%, color-mix(in oklch, var(--primary) 18%, transparent) 0, transparent 31%), linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
            backgroundSize: 'auto, 56px 56px, 56px 56px',
            maskImage: 'linear-gradient(to bottom, black 0%, transparent 94%)',
          }}
        />

        <div className="container-page relative py-14 lg:py-20">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              Injection-molding resin sourcing
            </div>
            <h1 className="mt-6 max-w-4xl font-display text-[clamp(2.8rem,6vw,5.8rem)] font-semibold leading-[0.94] tracking-[-0.05em] text-foreground">
              Enter the resin need. Get it in front of the{' '}
              <span className="text-primary">right material people.</span>
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground md:text-xl">
              Meldstock turns an injection molder’s technical requirement into a structured, private
              sourcing brief and routes it to brokers and resin specialists equipped to solve it.
            </p>
          </div>

          <div className="mt-10">
            <ResinSourcingConsole />
          </div>
        </div>
      </section>

      <section id="matching" className="container-page py-section" aria-labelledby="engine-title">
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
          <div>
            <span className="text-eyebrow">The matching engine</span>
            <h2 id="engine-title" className="mt-3 font-display text-h2 text-foreground">
              Software narrows the field. Experts solve the material problem.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              No fake AI magic and no generic supplier directory. Meldstock uses structured resin
              data for reliable routing, then keeps experienced human judgment in the loop for
              equivalents, qualification, and commercial fit.
            </p>
          </div>

          <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
            <EngineStep
              icon={<ScanSearch />}
              title="1. Normalize"
              body="Recognize polymer families, manufacturer grades, color, reinforcement, flame rating, melt flow, condition, and quantity."
            />
            <EngineStep
              icon={<DatabaseZap />}
              title="2. Match"
              body="Score specialist fit using material expertise, region, volume range, condition, and exact-versus-equivalent rules."
            />
            <EngineStep
              icon={<Network />}
              title="3. Connect"
              body="Open private responses around an actual requirement—not a public contact list or a pile of cold leads."
            />
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-muted/30">
        <div className="container-page grid lg:grid-cols-2">
          <RolePanel
            eyebrow="Injection molders"
            title="Source a grade or solve a specification."
            points={[
              'Submit one structured request at no cost',
              'Allow exact grade only or qualified equivalents',
              'Keep company identity private until choosing a response',
              'Continue through private messages, documents, and offers',
            ]}
            href="/request-material"
            action="Build a sourcing brief"
            icon={<LockKeyhole />}
          />
          <RolePanel
            eyebrow="Brokers & resin specialists"
            title="Work the demand that fits your book."
            points={[
              'Search real WANTED requests by resin and region',
              'See technical requirements before spending time responding',
              'Offer exact inventory, equivalents, or a sourcing path',
              'Create alerts for the material families you cover',
            ]}
            href="/opportunities"
            action="Open the opportunity desk"
            icon={<UserRoundCheck />}
            border
          />
        </div>
      </section>

      <section className="container-page py-section">
        <div className="grid gap-8 rounded-2xl bg-foreground p-6 text-background sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex size-10 items-center justify-center rounded-full border border-background/20 bg-background/10">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <h2 className="mt-5 max-w-3xl font-display text-h3 text-background">
              The business model is just as focused as the product.
            </h2>
            <p className="mt-3 max-w-3xl leading-7 text-background/70">
              Injection molders create qualified demand, so requests remain free. Verified sourcing
              specialists join the founding pilot free; paid access begins only after Meldstock can
              prove that its matched opportunities are worth receiving. Direct deals carry no
              commission.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <Button asChild size="lg" variant="secondary">
              <Link href="/request-material">
                Request material
                <ArrowRight className="ml-1 size-4" aria-hidden />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-background/25 bg-transparent text-background hover:bg-background/10 hover:text-background"
            >
              <Link href="/signup?role=specialist">Join as a specialist</Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function EngineStep({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <article className="bg-card p-6">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary [&>svg]:size-5">
        {icon}
      </span>
      <h3 className="mt-5 font-display text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </article>
  );
}

function RolePanel({
  eyebrow,
  title,
  points,
  href,
  action,
  icon,
  border = false,
}: {
  eyebrow: string;
  title: string;
  points: string[];
  href: string;
  action: string;
  icon: React.ReactNode;
  border?: boolean;
}) {
  return (
    <article
      className={`py-10 lg:p-12 ${border ? 'border-t border-border lg:border-l lg:border-t-0' : ''}`}
    >
      <span className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/8 text-primary [&>svg]:size-5">
        {icon}
      </span>
      <p className="mt-5 text-eyebrow">{eyebrow}</p>
      <h2 className="mt-2 max-w-xl font-display text-h3 text-foreground">{title}</h2>
      <ul className="mt-6 space-y-3">
        {points.map((point) => (
          <li key={point} className="flex gap-3 text-sm leading-6 text-muted-foreground">
            <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
            {point}
          </li>
        ))}
      </ul>
      <Button asChild className="mt-7">
        <Link href={href}>
          {action}
          <ArrowRight className="ml-1 size-4" aria-hidden />
        </Link>
      </Button>
    </article>
  );
}
