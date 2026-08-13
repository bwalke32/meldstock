// @polsia:user-owned — left-side filter panel for the /lots browse island.
// Mirrors parseLotFilter so every control round-trips through the URL. All
// controls stay controlled so URL-sync in the parent is the single source.
//
// Also renders the "Save this search" affordance and the caller's saved
// searches list. Both are owned by parent state — this sidebar just renders
// the controls and dispatches save/apply/delete via props.
'use client';

import { Bookmark, BookmarkPlus, Trash2, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { activeFilterCount } from '@/lib/business/lot-filters';
import { CONDITION_LABELS, POLYMER_LABELS } from '@/lib/business/lots';
import type { LotCondition, Polymer } from '@/lib/contracts/lots';
import type { LotFilter } from '@/lib/contracts/lots-filters';
import type { SavedSearch } from '@/lib/contracts/saved-searches';

interface LotsFilterSidebarProps {
  filter: LotFilter;
  totalLoaded: number;
  visibleCount: number;
  onChange: (next: LotFilter) => void;
  onClear: () => void;
  savedSearches: SavedSearch[];
  onSaveSearch: (name: string) => Promise<void> | void;
  onDeleteSavedSearch: (id: string) => Promise<void> | void;
}

const POLYMER_KEYS = Object.keys(POLYMER_LABELS) as Polymer[];
const CONDITION_KEYS = Object.keys(CONDITION_LABELS) as LotCondition[];

export function LotsFilterSidebar({
  filter,
  totalLoaded,
  visibleCount,
  onChange,
  onClear,
  savedSearches,
  onSaveSearch,
  onDeleteSavedSearch,
}: LotsFilterSidebarProps) {
  const updates = {
    setType: (type: LotFilter['type']) => onChange({ ...filter, type }),
    togglePolymer: (key: Polymer) => {
      const next = filter.polymers.includes(key)
        ? filter.polymers.filter((p) => p !== key)
        : [...filter.polymers, key];
      onChange({ ...filter, polymers: next });
    },
    toggleCondition: (key: LotCondition) => {
      const next = filter.conditions.includes(key)
        ? filter.conditions.filter((c) => c !== key)
        : [...filter.conditions, key];
      onChange({ ...filter, conditions: next });
    },
    setForm: (form: string) => onChange({ ...filter, form }),
    setGrade: (grade: string) => onChange({ ...filter, grade }),
    setColor: (color: string) => onChange({ ...filter, color }),
    setQ: (q: string) => onChange({ ...filter, q }),
    setHasCoa: (hasCoa: boolean | null) => onChange({ ...filter, hasCoa }),
    setMfr: (lo: number | null, hi: number | null) =>
      onChange({ ...filter, mfrMin: lo, mfrMax: hi }),
    setGlass: (lo: number | null, hi: number | null) =>
      onChange({ ...filter, glassMin: lo, glassMax: hi }),
    setRecycled: (lo: number | null, hi: number | null) =>
      onChange({ ...filter, recycledMin: lo, recycledMax: hi }),
    setFlame: (flame: string) => onChange({ ...filter, flame }),
    setCerts: (certs: string[]) => onChange({ ...filter, certs }),
  };

  const activeCount = activeFilterCount(filter);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="gap-2 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-display text-base tracking-tight text-foreground">
            Filters
          </CardTitle>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {activeCount} active
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {visibleCount} of {totalLoaded} visible · applied client-side
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={activeCount === 0}
          className="h-auto self-start px-2 text-[11px] font-mono uppercase tracking-wider"
        >
          <X className="mr-1 h-3 w-3" /> Clear filters
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 p-4">
        <SavedSearchesSection
          activeCount={activeCount}
          searches={savedSearches}
          onSave={onSaveSearch}
          onDelete={onDeleteSavedSearch}
        />

        <Section title="Lot type">
          <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
            <legend className="sr-only">Lot type</legend>
            {(['ALL', 'HAVE', 'WANTED'] as const).map((value) => {
              const active = filter.type === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => updates.setType(value)}
                  aria-pressed={active}
                  className={chipClass(active)}
                >
                  {value}
                </button>
              );
            })}
          </fieldset>
        </Section>

        <Section title="Polymer" subtitle="multi-select">
          <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
            <legend className="sr-only">Polymer</legend>
            {POLYMER_KEYS.map((key) => {
              const active = filter.polymers.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => updates.togglePolymer(key)}
                  aria-pressed={active}
                  className={chipClass(active)}
                >
                  {POLYMER_LABELS[key]}
                </button>
              );
            })}
          </fieldset>
        </Section>

        <Section title="Condition" subtitle="multi-select">
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="sr-only">Condition</legend>
            {CONDITION_KEYS.map((key) => {
              const id = `cond-${key}`;
              const checked = filter.conditions.includes(key);
              return (
                <label
                  key={key}
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-[11px] text-foreground transition-colors hover:bg-muted/40"
                >
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={() => updates.toggleCondition(key)}
                  />
                  <span>{CONDITION_LABELS[key]}</span>
                </label>
              );
            })}
          </fieldset>
        </Section>

        <Section title="Spec matches (substring)">
          <ControlledText
            label="Form"
            placeholder="pellets, regrind…"
            value={filter.form}
            onBlur={(v) => updates.setForm(v)}
          />
          <ControlledText
            label="Grade"
            placeholder="Sabic 800, MFI 12…"
            value={filter.grade}
            onBlur={(v) => updates.setGrade(v)}
          />
          <ControlledText
            label="Color"
            placeholder="natural, black…"
            value={filter.color}
            onBlur={(v) => updates.setColor(v)}
          />
        </Section>

        <Section title="Free-text search">
          <ControlledText
            label="Notes / manufacturer / grade / color"
            placeholder="e.g. PCR, FDA, food-grade"
            value={filter.q}
            onBlur={(v) => updates.setQ(v)}
          />
        </Section>

        <Section title="COA available">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="coa-switch" className="text-[11px] text-foreground">
              {filter.hasCoa === true
                ? 'Only lots with COA'
                : filter.hasCoa === false
                  ? 'Only lots without COA'
                  : 'No filter'}
            </Label>
            <Switch
              id="coa-switch"
              checked={filter.hasCoa !== null}
              onCheckedChange={(checked) => updates.setHasCoa(checked ? true : null)}
              aria-label="Filter by COA availability"
            />
          </div>
        </Section>

        <Section title="Numbers (from notes)" subtitle="substring parse">
          <RangeSlider
            label="Melt flow (g/10min)"
            min={0}
            max={100}
            step={1}
            value={[filter.mfrMin ?? 0, filter.mfrMax ?? 100]}
            onCommit={(lo, hi) => updates.setMfr(lo === 0 ? null : lo, hi === 100 ? null : hi)}
          />
          <RangeSlider
            label="Glass / mineral %"
            min={0}
            max={70}
            step={1}
            value={[filter.glassMin ?? 0, filter.glassMax ?? 70]}
            onCommit={(lo, hi) => updates.setGlass(lo === 0 ? null : lo, hi === 70 ? null : hi)}
          />
          <RangeSlider
            label="Recycled content %"
            min={0}
            max={100}
            step={1}
            value={[filter.recycledMin ?? 0, filter.recycledMax ?? 100]}
            onCommit={(lo, hi) => updates.setRecycled(lo === 0 ? null : lo, hi === 100 ? null : hi)}
          />
        </Section>

        <Section title="Other notes">
          <ControlledText
            label="Flame rating"
            placeholder="UL94 V-0, V-2, HB…"
            value={filter.flame}
            onBlur={(v) => updates.setFlame(v)}
          />
          <ControlledText
            label="Certifications (comma-separated)"
            placeholder="FDA, ISO 9001, RoHS…"
            value={filter.certs.join(', ')}
            onBlur={(v) =>
              updates.setCerts(
                v
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
          <p className="text-[10px] italic text-muted-foreground">
            MFR, glass %, recycled %, flame rating and certifications live on the broker’s notes
            today — match is substring against <span className="font-mono">notes</span>. They'd be
            first-class columns in a future iteration.
          </p>
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between">
        <h3 className="text-eyebrow text-foreground">{title}</h3>
        {subtitle ? (
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

// "Save this search" form + saved-searches list. The parent owns fetch/delete
// dispatch — this section is presentation only. `activeCount` gates the save
// button so an empty filter can't be saved (a saved "show me everything"
// search produces noisy notifications).
function SavedSearchesSection({
  activeCount,
  searches,
  onSave,
  onDelete,
}: {
  activeCount: number;
  searches: SavedSearch[];
  onSave: (name: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}) {
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const inputId = React.useId();

  const canSave = activeCount > 0 && name.trim().length > 0 && !pending;

  const handleSave = async () => {
    if (!canSave) return;
    setPending(true);
    try {
      await onSave(name.trim());
      setName('');
    } finally {
      setPending(false);
    }
  };

  return (
    <Section title="Saved searches" subtitle={`${activeCount} active`}>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          type="text"
          placeholder={activeCount > 0 ? 'Name this search…' : 'Pick a filter first'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSave();
            }
          }}
          disabled={activeCount === 0 || pending}
          className="h-8 text-[11px]"
          aria-label="New saved search name"
        />
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="h-8 shrink-0"
          aria-label="Save this search"
        >
          <BookmarkPlus className="mr-1 h-3 w-3" />
          Save
        </Button>
      </div>
      {searches.length > 0 ? (
        <ul className="flex flex-col gap-1.5 border-t border-border pt-2">
          {searches.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-sm border border-border/60 bg-background px-2 py-1.5"
            >
              <a
                href={`/lots?${buildQueryFromFilter(s.filter)}`}
                className="flex min-w-0 flex-1 flex-col gap-0.5 transition-colors hover:text-primary"
                aria-label={`Apply saved search ${s.name}`}
              >
                <span className="flex items-center gap-1 text-[11px] font-medium text-foreground">
                  <Bookmark className="h-3 w-3 shrink-0 text-primary" />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {s.matchCount} matching · {humanFilterSummary(s.filter)}
                </span>
              </a>
              <button
                type="button"
                onClick={() => void onDelete(s.id)}
                aria-label={`Delete saved search ${s.name}`}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10px] italic text-muted-foreground">
          Save a filter set to get an email whenever a matching lot lands.
        </p>
      )}
    </Section>
  );
}

function buildQueryFromFilter(f: LotFilter): string {
  // Inline-import-free helper: deliberately use the same param names as
  // parseLotFilter so a saved-search link opens the right filter combination.
  const params = new URLSearchParams();
  if (f.type !== 'ALL') params.set('type', f.type);
  if (f.polymers.length > 0) params.set('polymer', f.polymers.join(','));
  if (f.conditions.length > 0) params.set('condition', f.conditions.join(','));
  if (f.form) params.set('form', f.form);
  if (f.grade) params.set('grade', f.grade);
  if (f.color) params.set('color', f.color);
  if (f.q) params.set('q', f.q);
  if (f.hasCoa !== null) params.set('coa', f.hasCoa ? 'true' : 'false');
  if (f.mfrMin !== null) params.set('mfrMin', String(f.mfrMin));
  if (f.mfrMax !== null) params.set('mfrMax', String(f.mfrMax));
  if (f.glassMin !== null) params.set('glassMin', String(f.glassMin));
  if (f.glassMax !== null) params.set('glassMax', String(f.glassMax));
  if (f.recycledMin !== null) params.set('recycledMin', String(f.recycledMin));
  if (f.recycledMax !== null) params.set('recycledMax', String(f.recycledMax));
  if (f.flame) params.set('flame', f.flame);
  if (f.certs.length > 0) params.set('cert', f.certs.join(','));
  return params.toString();
}

function humanFilterSummary(f: LotFilter): string {
  const bits: string[] = [];
  if (f.polymers.length > 0) bits.push(`${f.polymers.length} polymer`);
  if (f.conditions.length > 0) bits.push(`${f.conditions.length} cond`);
  if (f.form) bits.push(`form:${f.form}`);
  if (f.grade) bits.push(`grade:${f.grade}`);
  if (f.color) bits.push(`color:${f.color}`);
  if (f.q) bits.push(`q:${f.q}`);
  if (f.mfrMin !== null || f.mfrMax !== null) {
    bits.push(`mfr:${f.mfrMin ?? 0}-${f.mfrMax ?? 100}`);
  }
  if (f.glassMin !== null || f.glassMax !== null) {
    bits.push(`glass:${f.glassMin ?? 0}-${f.glassMax ?? 70}`);
  }
  if (f.recycledMin !== null || f.recycledMax !== null) {
    bits.push(`recycled:${f.recycledMin ?? 0}-${f.recycledMax ?? 100}`);
  }
  if (f.flame) bits.push(`flame:${f.flame}`);
  if (f.certs.length > 0) bits.push(`cert:${f.certs.length}`);
  return bits.length > 0 ? bits.join(' · ') : 'broad search';
}

function ControlledText({
  label,
  placeholder,
  value,
  onBlur,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onBlur: (next: string) => void;
}) {
  const inputId = React.useId();
  const [local, setLocal] = React.useState(value);
  // value prop change covers resets — parent's onClear() resets the filter,
  // which propagates a new value here.
  React.useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </label>
      <Input
        id={inputId}
        type="text"
        placeholder={placeholder}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => onBlur(local)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className="h-8 text-[11px]"
      />
    </div>
  );
}

function RangeSlider({
  label,
  min,
  max,
  step,
  value,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onCommit: (lo: number, hi: number) => void;
}) {
  const [local, setLocal] = React.useState<[number, number]>(value);
  // value prop change covers resets — parent's onClear() resets the filter,
  // which propagates a new value pair here.
  React.useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-[10px] text-foreground">
          {local[0]}–{local[1]}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={local}
        onValueChange={(v) => setLocal([v[0] ?? min, v[1] ?? max])}
        onValueCommit={(v) => onCommit(v[0] ?? min, v[1] ?? max)}
        aria-label={label}
      />
    </div>
  );
}

function chipClass(active: boolean) {
  return [
    'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
    active
      ? 'border-primary/60 bg-primary/15 text-primary'
      : 'border-border bg-background text-muted-foreground hover:bg-muted/40',
  ].join(' ');
}
