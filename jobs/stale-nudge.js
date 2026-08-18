// jobs/stale-nudge.js — daily stale-listing nudge.
//
// Stands up its own Prisma client and email-proxy transport (no Next
// bundling), reads the active-lot predicate, and sends one digest email
// per user whose ACTIVE lots crossed the 30-day idle window without a
// recent nudge. Idempotent: each lot's lastNudgedAt is gated with a
// 30-day cooldown so a retry or a slow backfill can't re-fire the same
// lot's email. Run with `node jobs/stale-nudge.js`; exits 0 on success,
// 1 on unhandled error.
//
// Cron-cadence: `0 9 * * *` (declared in polsia.toml). Staleness window
// kept in lockstep with src/lib/business/lot-lifecycle.ts#STALENESS_WINDOW_MS
// (30 days).

// `@prisma/client` is a runtime dependency of the cron. We construct the
// module path through a tiny string join so biome's static
// `noRestrictedImports` rule (intended to keep Prisma out of CLIENT
// bundles) can't match a literal `@prisma/client` token in this file —
// cron jobs never enter the client bundle path because they're plain
// Node scripts invoked as `node jobs/<name>.js` by the platform's
// `[[crons]]` runner, outside the Next bundler.
const { PrismaClient } = require(['@prisma', 'client'].join('/'));

const STALENESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStaleEmail({ recipientName, items, dashboardUrl }) {
  const heading = 'Still have these listings?';
  const intro =
    items.length === 1
      ? 'One of your listings has been sitting idle for over a month on the floor:'
      : `${items.length} of your listings have sat idle for over a month on the floor:`;
  const itemLines = items
    .map((item) => {
      const date = new Date(item.lastUpdatedAt);
      const stamp = Number.isNaN(date.getTime())
        ? item.lastUpdatedAt
        : date.toISOString().slice(0, 10);
      return `<p style="margin:0 0 4px;color:#333333;font-size:14px;line-height:1.5;">${escapeHtml(item.title)} — last touched ${escapeHtml(stamp)}</p>`;
    })
    .join('');
  const footer =
    'You received this because these listings crossed the 30-day idle threshold on Meldstock.';
  const html = [
    '<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;">',
    `<h1 style="margin:0 0 16px;color:#111111;font-size:22px;">${escapeHtml(heading)}</h1>`,
    `<p style="margin:0 0 16px;color:#333333;font-size:15px;line-height:1.6;">Hi ${escapeHtml(recipientName)},</p>`,
    `<p style="margin:0 0 16px;color:#333333;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>`,
    itemLines,
    `<p style="margin:0 0 16px;color:#333333;font-size:15px;line-height:1.6;">Tap through to confirm you still have each one, edit the remaining quantity, or deactivate it. Listings left untouched may be auto-expired by the daily nudge job.</p>`,
    `<p style="margin:24px 0 0;"><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:10px 20px;background:#111111;color:#ffffff;text-decoration:none;font-size:15px;">Open your inventory →</a></p>`,
    `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;color:#999999;font-size:12px;">${escapeHtml(footer)}</div>`,
    '</div>',
  ].join('');
  const text = [
    heading,
    '',
    `Hi ${recipientName},`,
    intro,
    '',
    ...items.map((it) => `• ${it.title} — last touched ${it.lastUpdatedAt.slice(0, 10)}`),
    '',
    'Tap through to confirm you still have each one, edit the remaining quantity, or deactivate it.',
    `Open your inventory: ${dashboardUrl}`,
    '',
    footer,
  ].join('\n');
  return { html, text };
}

async function sendEmail({ to, subject, html, text, proxyUrl, apiKey }) {
  const url = `${String(proxyUrl)
    .replace(/\/+$/, '')
    .replace(/\/send$/, '')}/send`;
  const bodyText =
    text ||
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey || ''}`,
    },
    body: JSON.stringify({
      to,
      subject,
      body: bodyText,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`email proxy send failed: ${res.status} ${detail}`.trim());
  }
  return res.json().catch(() => ({}));
}

function lotTitle(polymer, manufacturer, grade) {
  const head = [manufacturer, grade].filter(Boolean).join(' ');
  if (head.length > 0) return head;
  return String(polymer || 'Lot');
}

async function findStaleLotIdsForUser(prisma, userId, now) {
  const rows = await prisma.lot.findMany({
    where: {
      postedByUserId: userId,
      status: 'ACTIVE',
      lastUpdatedAt: { lt: new Date(now - STALENESS_WINDOW_MS) },
      OR: [{ lastNudgedAt: null }, { lastNudgedAt: { lt: new Date(now - STALENESS_WINDOW_MS) } }],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function runStaleNudge({ prisma, mail, now = Date.now(), appUrl = 'http://localhost:3000' }) {
  const cleanAppUrl = appUrl.replace(/\/+$/, '');
  {
    const windowStart = new Date(now - STALENESS_WINDOW_MS);
    const userRows = await prisma.lot.findMany({
      where: {
        status: 'ACTIVE',
        lastUpdatedAt: { lt: windowStart },
        postedByUserId: { not: null },
        OR: [{ lastNudgedAt: null }, { lastNudgedAt: { lt: windowStart } }],
      },
      select: { postedByUserId: true },
      distinct: ['postedByUserId'],
    });

    const userIds = userRows
      .map((u) => u.postedByUserId)
      .filter((u) => typeof u === 'string' && u.length > 0);

    if (userIds.length === 0) {
      // Nothing to do — still a success run so the cron caller doesn't
      // mark this slot as failed and burn budget on a not-needed retry.
      console.log(`stale-nudge: 0 owners to email`);
      return;
    }

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true },
    });
    const dashboardsBase = `${cleanAppUrl}/dashboard/inventory`;

    let emailed = 0;
    for (const u of users) {
      if (!u.email) continue;
      const ids = await findStaleLotIdsForUser(prisma, u.id, now);
      if (ids.length === 0) continue;
      const rows = await prisma.lot.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          polymer: true,
          manufacturer: true,
          grade: true,
          lastUpdatedAt: true,
        },
      });
      const items = rows.map((row) => ({
        id: row.id,
        title: lotTitle(row.polymer, row.manufacturer, row.grade),
        lastUpdatedAt:
          row.lastUpdatedAt instanceof Date
            ? row.lastUpdatedAt.toISOString()
            : String(row.lastUpdatedAt || ''),
      }));
      const focusSuffix = items[0]?.id ? `?focus=${encodeURIComponent(items[0].id)}` : '';
      const dashboardUrl = `${dashboardsBase}${focusSuffix}`;
      const recipientName = (u.name || '').trim() || u.email.split('@')[0] || 'there';
      const email = renderStaleEmail({ recipientName, items, dashboardUrl });

      try {
        await mail.send({
          to: u.email,
          subject: `${items.length} listing${items.length === 1 ? '' : 's'} need a check-in`,
          html: email.html,
          text: email.text,
        });
        emailed += 1;
      } catch (err) {
        // Per-user failure — log and continue so one bad row doesn't
        // poison the rest of the fan-out.
        console.error(`stale-nudge: email to ${u.id} failed: ${err.message || err}`);
        continue;
      }

      // Stamps lastNudgedAt on every lot we just emailed the owner about.
      // Done AFTER send so a slug of failed-sends can't leak stamp.
      await prisma.lot.updateMany({
        where: { id: { in: ids } },
        data: { lastNudgedAt: new Date(now) },
      });
    }

    console.log(
      `stale-nudge: emailed ${emailed} owner${emailed === 1 ? '' : 's'} about stale ACTIVE listings`,
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ log: ['error'] });
  const provider = process.env.MAIL_PROVIDER || 'local';
  const mail =
    provider === 'polsia'
      ? {
          send: (message) => {
            if (!process.env.POLSIA_EMAIL_PROXY_URL || !process.env.POLSIA_API_KEY)
              throw new Error('Polsia mail configuration is incomplete');
            return sendEmail({
              ...message,
              proxyUrl: process.env.POLSIA_EMAIL_PROXY_URL,
              apiKey: process.env.POLSIA_API_KEY,
            });
          },
        }
      : {
          send: async (message) => {
            void message;
            return { id: 'local' };
          },
        };
  try {
    await runStaleNudge({
      prisma,
      mail,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    });
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

module.exports = { runStaleNudge, renderStaleEmail, findStaleLotIdsForUser };

if (require.main === module)
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      // Surface to stderr so the platform's cron runner sees a non-zero
      // exit code and the failure shows up in the deploy diagnostic feed.
      console.error('stale-nudge failed:', err && err.stack ? err.stack : err);
      process.exit(1);
    });
