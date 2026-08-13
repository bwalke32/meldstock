import { describe, expect, it } from 'vitest';

import {
  type NormalizeOptions,
  normalizeResinInput,
  resolveResinRow,
} from '../../src/lib/business/resin-normalize';

describe('normalizeResinInput', () => {
  it('returns the canonical polymer for direct aliases (polycarbonate, polypro)', () => {
    const polycarb = normalizeResinInput('Polycarbonate', { mode: 'write' });
    expect(polycarb.polymers).toEqual(['PC']);

    const polypro = normalizeResinInput('polypro', { mode: 'write' });
    expect(polypro.polymers).toEqual(['PP']);

    const homopolymer = normalizeResinInput('Nylon 6,6', { mode: 'write' });
    expect(homopolymer.polymers).toEqual(['PA66']);

    const acetal = normalizeResinInput('acetal', { mode: 'write' });
    expect(acetal.polymers).toEqual(['POM']);
  });

  it('lifts PA66 GF33 BK into a clean polymer record with a Black color chip', () => {
    const n = normalizeResinInput('PA66 GF33 BK', { mode: 'write' });
    expect(n.polymers).toEqual(['PA66']);
    expect(n.glass).toEqual({ min: 31, max: 35 });
    expect(n.color).toBe('Black');
    // All tokens lift — leftover is empty so canonical grade becomes null.
    expect(n.gradeCanonical).toBeNull();
    expect(n.chips.map((c) => c.label)).toEqual(['PA66', 'Glass 33%', 'Black']);
  });

  it('keeps ABS NAT as a residue-free polymer record', () => {
    const n = normalizeResinInput('ABS NAT', { mode: 'write' });
    expect(n.polymers).toEqual(['ABS']);
    expect(n.color).toBe('Natural');
    expect(n.gradeCanonical).toBeNull();
  });

  it('reads V-codes from PC FR V0 → polymer PC, flame V0', () => {
    const n = normalizeResinInput('PC FR V0', { mode: 'write' });
    expect(n.polymers).toEqual(['PC']);
    expect(n.flame).toBe('V0');
    expect(n.gradeCanonical).toBeNull();
  });

  it('parses glass percentages in compact and verbose forms', () => {
    const a = normalizeResinInput('PBT GF30', { mode: 'write' });
    expect(a.polymers).toEqual(['PBT']);
    expect(a.glass).toEqual({ min: 28, max: 32 });

    const b = normalizeResinInput('PBT G30', { mode: 'write' });
    expect(b.polymers).toEqual(['PBT']);
    expect(b.glass).toEqual({ min: 28, max: 32 });
  });

  it('extracts PP COPO and PP HOMO as variant chips', () => {
    const copo = normalizeResinInput('PP COPO', { mode: 'write' });
    expect(copo.polymers).toEqual(['PP']);
    expect(copo.variants).toEqual(['COPO']);

    const homo = normalizeResinInput('PP HOMO', { mode: 'write' });
    expect(homo.polymers).toEqual(['PP']);
    expect(homo.variants).toEqual(['HOMO']);
  });

  it('handles slash-separated blends like PC/ABS', () => {
    // PC/ABS is a blend — neither alias is a single match (the slash-separated
    // tokens are PC + ABS). Each token resolves individually.
    const n = normalizeResinInput('PC/ABS', { mode: 'write' });
    expect(n.polymers.sort()).toEqual(['ABS', 'PC'].sort());
    expect(n.gradeCanonical).toBeNull();
  });

  it('preserves unrecognized leading prefixes as the canonical grade', () => {
    // "Lexan 141R" — Lexan is a brand, not a polymer alias. The whole string
    // is preserved as the canonical grade so a buyer searching for the SAME
    // string still finds the lot via the literal substring match.
    const n = normalizeResinInput('Lexan 141R', { mode: 'write' });
    expect(n.polymers).toEqual([]);
    expect(n.gradeCanonical).toBe('LEXAN 141R');
  });

  it('strips surrounding whitespace and unicode noise', () => {
    const a = normalizeResinInput('   PA66 GF33 BK   ', { mode: 'write' });
    expect(a.polymers).toEqual(['PA66']);
    expect(a.color).toBe('Black');
    expect(a.gradeCanonical).toBeNull();

    const b = normalizeResinInput('PC/ABS/NAT', { mode: 'write' });
    expect(b.polymers.sort()).toEqual(['ABS', 'PC'].sort());
    expect(b.color).toBe('Natural');
  });

  it('returns an empty shape for empty / null input', () => {
    const empty = normalizeResinInput('', { mode: 'search' });
    expect(empty.polymers).toEqual([]);
    expect(empty.gradeCanonical).toBeNull();
    expect(empty.chips).toEqual([]);

    const nul = normalizeResinInput(null, { mode: 'search' });
    expect(nul.polymers).toEqual([]);
    expect(nul.gradeCanonical).toBeNull();
  });

  it('preserves the literal input when no token is recognised', () => {
    // "Polyamide 6,6 33%" — individual tokens (Polyamide, 6,6, 33%) aren't
    // aliases. Backward-compat invariant: keep the original prefix as the
    // canonical grade so the seller's exact phrasing still matches a
    // free-text search.
    const n = normalizeResinInput('Polyamide 6,6 33%', { mode: 'search' });
    expect(n.polymers).toEqual([]);
    expect(n.gradeCanonical).toBe('POLYAMIDE 6,6 33%');
  });

  it('search mode mirrors write mode for chips', () => {
    const search = normalizeResinInput('PA66 GF33 BK', { mode: 'search' });
    expect(search.polymers).toEqual(['PA66']);
    expect(search.glass).toEqual({ min: 31, max: 35 });
    expect(search.color).toBe('Black');
  });

  describe('polymer override', () => {
    it('promotes an OTHER polymer when the grade string carries a direct alias', () => {
      const opts: NormalizeOptions = {
        mode: 'write',
        polymerCandidate: 'OTHER',
      };
      const n = normalizeResinInput('polycarbonate', opts);
      expect(n.polymerOverride).toBe('PC');
    });

    it('does NOT override a non-OTHER polymer dropdown selection', () => {
      const opts: NormalizeOptions = {
        mode: 'write',
        polymerCandidate: 'PC',
      };
      const n = normalizeResinInput('polycarbonate', opts);
      expect(n.polymerOverride).toBeNull();
    });

    it('does NOT override in search mode even when the input has a polymer', () => {
      const opts: NormalizeOptions = {
        mode: 'search',
        polymerCandidate: 'OTHER',
      };
      const n = normalizeResinInput('polycarbonate', opts);
      expect(n.polymerOverride).toBeNull();
    });
  });
});

describe('resolveResinRow', () => {
  it('preserves the dropdown choice when both the polymer and grade are present', () => {
    const resolved = resolveResinRow('PC', 'GF20 NAT', 'Black');
    expect(resolved.polymer).toBe('PC');
    // GF20 + NAT lifted out of grade; canonical grade is null.
    expect(resolved.grade).toBeNull();
    // Explicit color column wins over grade-derived color.
    expect(resolved.color).toBe('Black');
  });

  it('promotes an OTHER dropdown when grade carries a real polymer alias', () => {
    const resolved = resolveResinRow('OTHER', 'Polycarbonate GF20', '');
    expect(resolved.polymer).toBe('PC');
    expect(resolved.grade).toBeNull();
  });

  it('resolves a free-form synonym typed in the polymer column', () => {
    // Wizard case — the seller typed `polycarb` in the polymer column
    // expecting the trader-standard PC. resolveResinRow upgrades via
    // alias map.
    const resolved = resolveResinRow('polycarb', '141R', 'Black');
    expect(resolved.polymer).toBe('PC');
    // "141R" doesn't match aliases ⇒ preserved as the canonical grade.
    expect(resolved.grade).toBe('141R');
    expect(resolved.color).toBe('Black');
  });

  it('falls back to OTHER when neither side resolves a polymer', () => {
    const resolved = resolveResinRow('OTHER', 'Lexan 141R', '');
    expect(resolved.polymer).toBe('OTHER');
    expect(resolved.grade).toBe('LEXAN 141R');
  });

  it('lifts color shorthand from the color column to its long label', () => {
    const resolved = resolveResinRow('PC', '141R', 'BK');
    expect(resolved.color).toBe('Black');
  });

  it('lifts color shorthand from the grade column when the color column is empty', () => {
    const resolved = resolveResinRow('PA66', 'GF33 BK', '');
    expect(resolved.color).toBe('Black');
    expect(resolved.polymer).toBe('PA66');
    expect(resolved.grade).toBeNull();
  });
});
