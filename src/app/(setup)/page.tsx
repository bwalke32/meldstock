// @polsia:user-owned — demand-first public home for the Meldstock sourcing network.
// Server Component. The global SiteNav + SiteFooter mount in src/app/layout.tsx.

import {
  ArrowRight,
  Check,
  CircleCheck,
  Clock3,
  Globe2,
  MapPin,
  MessageSquareText,
  Route,
  ShieldCheck,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { siteDescription, siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: { absolute: siteName },
  description: siteDescription,
  alternates: { canonical: '/' },
};

const MATERIALS = ['ABS', 'PC/ABS', 'Nylon 6/66', 'PP', 'PBT', 'POM', 'TPE/TPU', 'PEI', 'PPO/PPE'];

const MOLDER_BENEFITS = [
  'One request instead of a dozen calls and emails',
  'Exact-grade, equivalent-grade, and backup-source options',
  'Your company identity stays private on the request',
  'Free to submit requests and connect with specialists',
];

const SPECIALIST_BENEFITS = [
  'Requests matched to the materials and regions you cover',
  'Enough technical detail to decide before you respond',
  'Direct conversations with injection-molding buyers',
  'No commission on deals you close directly',
];

const FAQ = [
  {
    question: 'Is Meldstock a distributor or broker?',
    answer:
      'No. Meldstock is a private introduction network. Injection molders describe what they need, and independent brokers, distributors, and resin sales specialists respond with sourcing options.',
  },
  {
    question: 'Who can see a material request?',
    answer:
      'The request is posted without the molder’s public identity. The network is designed to route it to relevant specialists; the molder decides which conversations to continue.',
  },
  {
    question: 'Does a molder have to know the exact grade?',
    answer:
      'No. A request can name an exact manufacturer and grade, allow an equivalent, or describe the performance, certification, color, quantity, and timing required.',
  },
  {
    question: 'How does Meldstock make money?',
    answer:
      'Submitting requests is free for injection molders. After the founding pilot, sourcing specialists can join through a simple paid membership for matched opportunities. Direct deals carry no Meldstock commission.',
  },
];

export default function MeldstockHome() {
  return (
    <main className="overflow-hidden">
      <section
        className="relative border-b border-border bg-background"
        aria-labelledby="hero-title"
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              'radial-gradient(circle at 84% 18%, color-mix(in oklch, var(--primary) 16%, transparent) 0, transparent 32%), linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
            backgroundSize: 'auto, 56px 56px, 56px 56px',
            maskImage: 'linear-gradient(to bottom, black 0%, transparent 88%)',
          }}
        />

        <div className="container-page relative grid gap-12 pb-20 pt-16 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-16 lg:pb-28 lg:pt-24">
          <div className="max-w-3xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              Private resin sourcing network
            </div>
            <h1
              id="hero-title"
              className="max-w-3xl font-display text-[clamp(3.1rem,7vw,6.6rem)] font-semibold leading-[0.91] tracking-[-0.055em] text-foreground"
            >
              The shortest path from <span className="text-primary">“we need resin”</span> to “I can
              source it.”
            </h1>
            <p className="mt-7 max-w-2xl text-balance text-lg leading-8 text-muted-foreground md:text-xl">
              Injection molders submit one clear material request. Meldstock connects it with the
              brokers and resin sales specialists most likely to solve it.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="h-12 px-6 text-base">
                <Link href="/request-material">
                  Request material
                  <ArrowRight className="ml-1 size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base">
                <Link href="/signup?role=specialist">Join as a sourcing specialist</Link>
              </Button>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Check className="size-4 text-primary" aria-hidden />
                Free for injection molders
              </li>
              <li className="flex items-center gap-2">
                <Check className="size-4 text-primary" aria-hidden />
                Private by default
              </li>
              <li className="flex items-center gap-2">
                <Check className="size-4 text-primary" aria-hidden />
                Built for thermoplastics
              </li>
            </ul>
          </div>

          <ExampleRequest />
        </div>

        <div className="container-page relative pb-8">
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-6">
            <span className="mr-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Material fluency, not a generic directory
            </span>
            {MATERIALS.map((material) => (
              <span
                key={material}
                className="rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-foreground"
              >
                {material}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="container-page py-section-lg"
        aria-labelledby="how-title"
      >
        <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
          <div>
            <span className="text-eyebrow">A sourcing desk, not a trading floor</span>
            <h2 id="how-title" className="mt-4 max-w-xl font-display text-h2 text-foreground">
              One request replaces the scavenger hunt.
            </h2>
            <p className="mt-5 max-w-lg text-lg leading-8 text-muted-foreground">
              No public inventory maze. No price ticker. No freight suite. Meldstock does one job:
              put a real molding need in front of the right material people.
            </p>
          </div>

          <ol className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
            <ProcessStep
              number="01"
              icon={<MessageSquareText className="size-5" />}
              title="Describe the need"
              body="Grade or performance, condition, color, quantity, destination, timing, and whether equivalents are allowed."
            />
            <ProcessStep
              number="02"
              icon={<Route className="size-5" />}
              title="Route it intelligently"
              body="The request reaches specialists whose material focus and geography fit—not the whole internet."
            />
            <ProcessStep
              number="03"
              icon={<CircleCheck className="size-5" />}
              title="Choose a solution"
              body="Compare credible responses, open the useful conversations, and continue the deal directly."
            />
          </ol>
        </div>
      </section>

      <section className="border-y border-border bg-muted/35">
        <div className="container-page grid lg:grid-cols-2">
          <AudiencePanel
            id="for-molders"
            eyebrow="For injection molders"
            title="Spend less time hunting material."
            body="Use Meldstock when a normal distributor is out, a program needs a qualified alternative, or a hard-to-find grade is holding up a press."
            benefits={MOLDER_BENEFITS}
            cta="Start a material request"
            href="/request-material"
          />
          <AudiencePanel
            id="for-specialists"
            eyebrow="For brokers & resin sales specialists"
            title="See demand that fits your book."
            body="Tell us the polymers, conditions, volumes, and regions you cover. Receive focused opportunities instead of chasing a noisy public feed."
            benefits={SPECIALIST_BENEFITS}
            cta="Apply to the founding network"
            href="/signup?role=specialist"
            border
          />
        </div>
      </section>

      <section
        id="pricing"
        className="container-page py-section-lg"
        aria-labelledby="pricing-title"
      >
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <span className="text-eyebrow">Simple incentives</span>
            <h2 id="pricing-title" className="mt-4 font-display text-h2 text-foreground">
              Charge for qualified access, not for buyer friction.
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted-foreground">
              Molders create the demand that makes the network valuable, so they use it free.
              Specialists pay one predictable membership after the founding pilot proves the match
              quality.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <PricingCard
              audience="Injection molders"
              price="$0"
              cadence="always"
              description="Submit sourcing requests, receive responses, and connect directly."
              items={[
                'Unlimited requests',
                'Private request identity',
                'Direct specialist replies',
              ]}
              href="/request-material"
              cta="Request material"
            />
            <PricingCard
              audience="Verified specialists"
              price="$199"
              cadence="per month after pilot"
              description="Receive matched, purchase-intent opportunities without a deal commission."
              items={[
                'Material and region matching',
                'Unlimited direct responses',
                'Founding pilot is free',
              ]}
              href="/signup?role=specialist"
              cta="Join the founding network"
              featured
            />
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            Direct introductions carry no success fee. Managed payment, credit, freight, or quality
            services may be added later as optional transaction services—not as a condition of using
            the network.
          </p>
        </div>
      </section>

      <section className="border-y border-border bg-foreground text-background">
        <div className="container-page grid gap-10 py-section lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:gap-20">
          <div>
            <div className="flex size-11 items-center justify-center rounded-full border border-background/20 bg-background/10">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <h2 className="mt-5 max-w-lg font-display text-h3 text-background">
              Relevance and discretion are the product.
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <TrustPoint
              title="Controlled introductions"
              body="A molder’s identity is not displayed on the public request. Conversations stay inside the existing private thread workflow."
            />
            <TrustPoint
              title="Specialist applications"
              body="The launch model uses manual review before a sourcing specialist enters the active network."
            />
            <TrustPoint
              title="No invented market data"
              body="Meldstock does not pretend to have live prices or transaction activity it has not actually collected."
            />
            <TrustPoint
              title="Human judgment stays central"
              body="Structured matching narrows the field; experienced material people make the actual sourcing recommendation."
            />
          </div>
        </div>
      </section>

      <section id="faq" className="container-page py-section-lg" aria-labelledby="faq-title">
        <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
          <div>
            <span className="text-eyebrow">Plain answers</span>
            <h2 id="faq-title" className="mt-4 font-display text-h2 text-foreground">
              What Meldstock is—and isn’t.
            </h2>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {FAQ.map((item) => (
              <details key={item.question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-semibold text-foreground">
                  {item.question}
                  <span className="font-mono text-xl font-normal text-primary transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="max-w-2xl pb-1 pt-4 leading-7 text-muted-foreground">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="container-page pb-section-lg">
        <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-12 text-primary-foreground md:px-12 md:py-16">
          <div
            aria-hidden
            className="absolute -right-20 -top-28 size-80 rounded-full border-[56px] border-primary-foreground/10"
          />
          <div className="relative max-w-3xl">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/75">
              Start with the material problem
            </span>
            <h2 className="mt-4 font-display text-h2 text-primary-foreground">
              What resin is holding up your next run?
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-primary-foreground/80">
              Put the need into one structured request. We’ll build the network around solving it.
            </p>
            <Button asChild size="lg" variant="secondary" className="mt-7 h-12 px-6">
              <Link href="/request-material">
                Request material
                <ArrowRight className="ml-1 size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function ExampleRequest() {
  return (
    <aside className="relative mx-auto w-full max-w-xl" aria-label="Illustrative material request">
      <div className="absolute -inset-3 -rotate-2 rounded-2xl border border-primary/15 bg-primary/5" />
      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Material request · example
            </p>
            <p className="mt-1 font-mono text-xs text-foreground">MS-0427</p>
          </div>
          <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wider">
            Private
          </Badge>
        </div>

        <div className="p-5 sm:p-6">
          <p className="text-sm text-muted-foreground">Exact grade or qualified equivalent</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground">
            SABIC CYCOLOY™ C6600
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <RequestFact
              icon={<CircleCheck />}
              label="Requirement"
              value="Black · Prime · UL94 V-0"
            />
            <RequestFact icon={<MapPin />} label="Deliver to" value="Chicago, IL · USA" />
            <RequestFact icon={<Globe2 />} label="Quantity" value="5,000 lb · ongoing program" />
            <RequestFact icon={<Clock3 />} label="Timing" value="Needed within 10 days" />
          </div>

          <div className="mt-6 rounded-lg border border-primary/20 bg-primary/7 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                  Match path
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  Routed by resin expertise + geography
                </p>
              </div>
              <div className="flex -space-x-2" aria-hidden>
                {['PC', 'AB', 'GF', '+'].map((label, index) => (
                  <span
                    key={label}
                    className="flex size-9 items-center justify-center rounded-full border-2 border-card bg-foreground font-mono text-[10px] font-semibold text-background"
                    style={{ opacity: 1 - index * 0.12 }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function RequestFact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 rounded-md border border-border bg-background/70 p-3">
      <span className="mt-0.5 text-primary [&>svg]:size-4" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-sm font-medium leading-5 text-foreground">{value}</p>
      </div>
    </div>
  );
}

function ProcessStep({
  number,
  icon,
  title,
  body,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="bg-card p-6 md:min-h-64">
      <div className="flex items-center justify-between">
        <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          {icon}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{number}</span>
      </div>
      <h3 className="mt-8 font-display text-xl font-semibold text-foreground">{title}</h3>
      <p className="mt-3 leading-7 text-muted-foreground">{body}</p>
    </li>
  );
}

function AudiencePanel({
  id,
  eyebrow,
  title,
  body,
  benefits,
  cta,
  href,
  border = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  benefits: string[];
  cta: string;
  href: string;
  border?: boolean;
}) {
  return (
    <article
      id={id}
      className={`py-section lg:px-12 ${border ? 'border-t border-border lg:border-l lg:border-t-0 lg:pr-0' : 'lg:pl-0'}`}
    >
      <span className="text-eyebrow">{eyebrow}</span>
      <h2 className="mt-4 max-w-lg font-display text-h3 text-foreground">{title}</h2>
      <p className="mt-4 max-w-xl text-lg leading-8 text-muted-foreground">{body}</p>
      <ul className="mt-7 space-y-3">
        {benefits.map((benefit) => (
          <li key={benefit} className="flex gap-3 text-sm leading-6 text-foreground">
            <span className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-3" aria-hidden />
            </span>
            {benefit}
          </li>
        ))}
      </ul>
      <Button asChild variant="link" className="mt-7 h-auto px-0 text-base">
        <Link href={href}>
          {cta}
          <ArrowRight className="ml-1 size-4" aria-hidden />
        </Link>
      </Button>
    </article>
  );
}

function PricingCard({
  audience,
  price,
  cadence,
  description,
  items,
  href,
  cta,
  featured = false,
}: {
  audience: string;
  price: string;
  cadence: string;
  description: string;
  items: string[];
  href: string;
  cta: string;
  featured?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border p-6 md:p-8 ${featured ? 'border-primary bg-primary/6 shadow-brand' : 'border-border bg-card'}`}
    >
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {audience}
      </p>
      <div className="mt-5 flex items-end gap-3">
        <span className="font-display text-5xl font-semibold tracking-tight text-foreground">
          {price}
        </span>
        <span className="pb-1 text-sm text-muted-foreground">{cadence}</span>
      </div>
      <p className="mt-5 leading-7 text-muted-foreground">{description}</p>
      <ul className="mt-6 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-3 text-sm text-foreground">
            <Check className="size-4 text-primary" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
      <Button asChild variant={featured ? 'default' : 'outline'} className="mt-8 w-full">
        <Link href={href}>{cta}</Link>
      </Button>
    </article>
  );
}

function TrustPoint({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-display text-lg font-semibold text-background">{title}</h3>
      <p className="mt-2 leading-7 text-background/65">{body}</p>
    </div>
  );
}
