import { Check, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { MaterialRequestForm } from '@/components/custom/material-request-form';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Request material — ${siteName}`,
  description:
    'Send one private thermoplastic material request to brokers and resin sales specialists matched to the grade, volume, timing, and destination.',
  alternates: { canonical: '/request-material' },
};

const NEXT_STEPS = [
  'Your request is saved without displaying your company identity.',
  'Relevant sourcing specialists can respond with availability or alternatives.',
  'You choose which private conversations are worth continuing.',
];

export default function RequestMaterialPage() {
  return (
    <main className="container-page py-section">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] lg:gap-16">
        <section>
          <span className="text-eyebrow">For injection molders</span>
          <h1 className="mt-4 max-w-3xl font-display text-h1 leading-[1.02] text-foreground">
            Tell the network what resin you need.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Start with what you know. An exact grade is helpful, but a performance requirement and a
            clear application can be enough for the right specialist to help.
          </p>

          <div className="mt-9 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8">
            <MaterialRequestForm />
          </div>
        </section>

        <aside className="lg:pt-28">
          <div className="sticky top-24 rounded-xl border border-primary/20 bg-primary/6 p-6">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <h2 className="mt-5 font-display text-xl font-semibold text-foreground">
              What happens next
            </h2>
            <ol className="mt-5 space-y-5">
              {NEXT_STEPS.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-background font-mono text-[10px] text-primary">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <div className="mt-6 border-t border-primary/15 pt-5">
              <p className="flex gap-2 text-sm font-medium text-foreground">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                Free for injection molders
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                If you are not signed in, your draft stays in this browser while you create the free
                molder account needed to send it securely.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
