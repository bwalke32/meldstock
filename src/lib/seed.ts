// @polsia:user-owned — deploy-time database seed. You OWN this file.
//
// seed() runs once when the server boots (via the framework-owned
// src/instrumentation.ts), on the Node server, AFTER the schema is applied. We
// use it to seed a non-empty trading-floor feed so the live UI demos well on
// first deploy. Every write MUST be idempotent — runs on every boot.

export async function seed(): Promise<void> {
  const { prisma } = await import('@/lib/db');

  // Pre-existing threads on WANTED lots from before RFQ-scoping shipped
  // have `rfqId = null` and won't render the RFQ pill until the buyer
  // posts again. Stamp them on every boot — idempotent (the `rfqId null`
  // filter is the natural no-op after the first pass).
  await backfillWantedRfqIds();

  // Idempotency: skip if any lot already exists.
  const existing = await prisma.lot.count();
  if (existing > 0) {
    return;
  }

  await prisma.lot.createMany({
    data: [
      {
        type: 'HAVE',
        polymer: 'PET',
        condition: 'REPROCESSED',
        color: 'Natural',
        form: 'Pellets',
        manufacturer: 'SABIC',
        grade: 'Lexan 141R',
        quantityLb: 38000,
        packaging: 'Octabin',
        location: 'Houston, TX',
        country: 'USA',
        askingPricePerLb: 1.42,
        hasCoa: true,
        notes: '50% PCR, food-contact grade. Q3 surplus.',
        postedByName: 'SAMPLE — Polymer Bros.',
      },
      {
        type: 'WANTED',
        polymer: 'ABS',
        condition: 'PRIME_VIRGIN',
        color: 'Natural',
        form: 'Pellets',
        manufacturer: 'LG Chem',
        grade: 'Lustran 433',
        quantityLb: 24000,
        packaging: 'Gaylord',
        location: 'Chicago, IL',
        country: 'USA',
        askingPricePerLb: 1.05,
        hasCoa: true,
        notes: 'Looking for monthly recurring offtake, 6 month horizon.',
        postedByName: 'SAMPLE — Midwest Molders Co-op',
      },
      {
        type: 'HAVE',
        polymer: 'PP',
        condition: 'POST_INDUSTRIAL',
        color: 'Black',
        form: 'Regrind',
        manufacturer: null,
        grade: 'PPH homopol',
        quantityLb: 16000,
        packaging: 'Supersack',
        location: 'Monterrey, NL',
        country: 'Mexico',
        askingPricePerLb: 0.71,
        hasCoa: true,
        notes: '30% PIR, cosmetic blemish <1%. Production overrun.',
        postedByName: 'SAMPLE — Nearshoring Aggregator',
      },
      {
        type: 'HAVE',
        polymer: 'PC',
        condition: 'OFF_GRADE_WIDE_SPEC',
        color: 'Clear',
        form: 'Pellets',
        manufacturer: 'Covestro',
        grade: 'Makrolon 2458',
        quantityLb: 9000,
        packaging: 'Bags',
        location: 'Leverkusen, BY',
        country: 'Germany',
        askingPricePerLb: 2.1,
        hasCoa: true,
        notes: 'Wide-spec MVR window, color grade B. Trimmed order line.',
        postedByName: 'SAMPLE — Bayer Resin Offtake',
      },
      {
        type: 'WANTED',
        polymer: 'PE_HDPE',
        condition: 'RECYCLED_CONTENT',
        color: 'Mixed',
        form: 'Flake',
        manufacturer: null,
        grade: null,
        quantityLb: 60000,
        packaging: 'Truckload',
        location: 'Houston, TX',
        country: 'USA',
        askingPricePerLb: 0.58,
        hasCoa: false,
        notes: 'Bottle-grade PCR, FDA migration documentation on request.',
        postedByName: 'SAMPLE — RPC Intraplast',
      },
      {
        type: 'HAVE',
        polymer: 'PA66',
        condition: 'PRIME_VIRGIN',
        color: 'Black',
        form: 'Pellets',
        manufacturer: 'BASF',
        grade: 'Ultramid A27E',
        quantityLb: 11000,
        packaging: 'Octabin',
        location: 'Ludwigshafen, RP',
        country: 'Germany',
        askingPricePerLb: 3.85,
        hasCoa: true,
        notes: 'Glass-filled 35%. New production.',
        postedByName: 'SAMPLE — BASF Surplus Channel',
      },
      {
        type: 'HAVE',
        polymer: 'TPU',
        condition: 'REGRIND_GRANULATED',
        color: 'Amber',
        form: 'Granulated',
        manufacturer: 'Lubrizol',
        grade: 'Estane 58315',
        quantityLb: 4400,
        packaging: 'Supersack',
        location: 'Cleveland, OH',
        country: 'USA',
        askingPricePerLb: 1.92,
        hasCoa: false,
        notes: 'Post-industrial trim, ~95 Shore A. Two pallets.',
        postedByName: 'SAMPLE — Estane Bridge',
      },
      {
        type: 'WANTED',
        polymer: 'PET',
        condition: 'REGRIND_GRANULATED',
        color: 'Clear',
        form: 'Regrind',
        manufacturer: null,
        grade: null,
        quantityLb: 22000,
        packaging: 'Bales',
        location: 'Lyon, RA',
        country: 'France',
        askingPricePerLb: 0.68,
        hasCoa: true,
        notes: 'Bottle-grade wash. ECOSENSE-certified chain of custody.',
        postedByName: 'SAMPLE — PPWR-ready Mill',
      },
    ],
  });
}

// Boot-time backfill: every `MessageThread` whose source lot is WANTED and
// whose `rfqId` is still null gets stamped `rfqId = lotId` so legacy 1:1
// inbox rows render the RFQ pill without needing a fresh buyer reply. Cheap
// after the first pass — the `rfqId: null` filter is the natural no-op.
async function backfillWantedRfqIds(): Promise<void> {
  const { prisma } = await import('@/lib/db');
  const wantedIds = (
    await prisma.lot.findMany({
      where: { type: 'WANTED' },
      select: { id: true },
    })
  ).map((l) => l.id);
  if (wantedIds.length === 0) return;
  const stale = await prisma.messageThread.findMany({
    where: { lotId: { in: wantedIds }, rfqId: null },
    select: { id: true, lotId: true },
  });
  for (const t of stale) {
    await prisma.messageThread.update({
      where: { id: t.id },
      data: { rfqId: t.lotId },
    });
  }
}
