// @polsia:user-owned — single combined 5-dimension rating form. One row
// per dimension (MATERIAL_MATCH, DOCUMENTATION, PAYMENT, SHIPPING,
// COMMUNICATION), each is 1–5 star control + optional short comment. The
// five rows submit as ONE round-trip (`SubmitRating.scores.length === 5`)
// so a partial draft stays local until Submit; once the form passes the
// full=false check on Submit, the server writes the 5 rows in one
// `prisma.$transaction`.
//
// STAR CONTROL: implemented as a row of 5 radio inputs (one per score)
// visually styled as stars. Lens: only ONE `<input type="radio">` per row
// (highly a11y-friendly — keyboard arrow keys cycle through the scale,
// screen-readers announce the chosen value), no SVG/JS hijacking of clicks,
// no React state outside the form. The star look is purely cosmetic via
// sibling-label selectors (`peer-checked:fill-current` etc.).

'use client';

import { Star } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import {
  type RatingDimension as RatingDimensionT,
  RatingList as RatingListSchema,
  type RatingScoreInput,
  SubmitRating,
} from '@/lib/contracts/ratings';

const DIMENSIONS: { key: RatingDimensionT; label: string; hint: string }[] = [
  {
    key: 'MATERIAL_MATCH',
    label: 'Material match',
    hint: 'Did the resin actually match the spec sheet — polymer, grade, condition?',
  },
  {
    key: 'DOCUMENTATION',
    label: 'Documentation',
    hint: 'COA, TDS, SDS, photos — was the paperwork complete and prompt?',
  },
  {
    key: 'PAYMENT',
    label: 'Payment',
    hint: 'Wire landed on time, terms honored, no surprise deductions.',
  },
  {
    key: 'SHIPPING',
    label: 'Shipping',
    hint: 'Pickup window, freight arrival, no pallets lost or damaged.',
  },
  {
    key: 'COMMUNICATION',
    label: 'Communication',
    hint: 'Replies on time, no ghosting, problems raised instead of buried.',
  },
];

export interface RatingFormProps {
  threadId: string;
  onSubmitted: () => void;
}

type FormState = Record<RatingDimensionT, { score: number; comment: string }>;

function emptyState(): FormState {
  return {
    MATERIAL_MATCH: { score: 0, comment: '' },
    DOCUMENTATION: { score: 0, comment: '' },
    PAYMENT: { score: 0, comment: '' },
    SHIPPING: { score: 0, comment: '' },
    COMMUNICATION: { score: 0, comment: '' },
  };
}

export function RatingForm({ threadId, onSubmitted }: RatingFormProps) {
  const [state, setState] = useState<FormState>(emptyState);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function setScore(dim: RatingDimensionT, score: number) {
    setState((s) => ({ ...s, [dim]: { ...s[dim], score } }));
  }
  function setComment(dim: RatingDimensionT, comment: string) {
    setState((s) => ({ ...s, [dim]: { ...s[dim], comment } }));
  }

  async function handleSubmit() {
    if (submitting) return;
    const incomplete = DIMENSIONS.filter((d) => state[d.key].score < 1);
    if (incomplete.length > 0) {
      setServerError(`Score all 5 dimensions — ${incomplete.length} missing.`);
      return;
    }
    const scores: RatingScoreInput[] = DIMENSIONS.map((d) => {
      const row = state[d.key];
      return {
        dimension: d.key,
        score: row.score,
        comment: row.comment.trim().length > 0 ? row.comment.trim() : null,
      };
    });
    // Local re-validate against the wire zod so a client drift triggers
    // the same shape error as the server would — avoids round-tripping an
    // obviously-bad shape.
    const candidate = { threadId, scores };
    const parsed = SubmitRating.safeParse(candidate);
    if (!parsed.success) {
      setServerError('Rating shape is invalid — please refresh the page.');
      return;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      // Stamp the wire through zod to detect any server-side drift on
      // the parsed 201 body. The result isn't surfaced in UI (parent
      // re-fetches the confirmation via the dispatched window event),
      // but parsing keeps the contract from silently rotting.
      await apiFetch('/api/ratings', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        schema: RatingListSchema,
      });
      toast.success('Rating submitted — thanks for closing the loop.');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('ratings:submitted'));
      }
      onSubmitted();
    } catch (err: unknown) {
      const statusMatch = /\((\d{3})\)/.exec(err instanceof Error ? err.message : '');
      const status = statusMatch?.[1];
      const body = (err as { cause?: { error?: string } } | undefined)?.cause;
      if (status === '409') {
        setServerError(body?.error ?? 'You have already rated this transaction.');
        onSubmitted();
        return;
      }
      setServerError(body?.error ?? 'Could not submit — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <ul className="flex flex-col gap-4">
        {DIMENSIONS.map((d) => {
          const current = state[d.key].score;
          return (
            <li
              key={d.key}
              className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">{d.label}</span>
                <span className="text-caption text-muted-foreground">{d.hint}</span>
              </div>
              <fieldset
                aria-label={`${d.label} score`}
                className="flex flex-wrap items-center gap-1.5"
              >
                {[1, 2, 3, 4, 5].map((n) => {
                  const checked = current === n;
                  const id = `${d.key}-${n}`;
                  return (
                    <span key={n} className="inline-flex items-center">
                      <input
                        type="radio"
                        id={id}
                        name={`score-${d.key}`}
                        value={n}
                        checked={checked}
                        onChange={() => setScore(d.key, n)}
                        className="peer sr-only"
                        aria-label={`${d.label}: ${n} of 5`}
                      />
                      <label
                        htmlFor={id}
                        className="flex size-7 cursor-pointer items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/60 peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary"
                      >
                        <Star
                          aria-hidden="true"
                          className="size-3.5"
                          fill={checked ? 'currentColor' : 'none'}
                        />
                        <span className="sr-only">{n}</span>
                      </label>
                    </span>
                  );
                })}
                <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {current > 0 ? `${current} / 5` : 'not rated'}
                </span>
              </fieldset>
              <label className="flex flex-col gap-1" htmlFor={`${d.key}-comment`}>
                <span className="sr-only">{`${d.label} comment`}</span>
                <Textarea
                  id={`${d.key}-comment`}
                  placeholder={`Optional note — what stood out about ${d.label.toLowerCase()}?`}
                  className="min-h-[60px] text-sm"
                  value={state[d.key].comment}
                  maxLength={500}
                  onChange={(e) => setComment(d.key, e.target.value)}
                />
              </label>
            </li>
          );
        })}
      </ul>
      {serverError ? <output className="text-[11px] text-destructive">{serverError}</output> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit rating'}
        </Button>
      </div>
    </form>
  );
}
