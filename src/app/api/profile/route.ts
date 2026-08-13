// @polsia:user-owned — /api/profile self-service endpoints.
// GET: current user's Profile row or null (auth required, 401 otherwise).
// POST: one-time-create on signup completion (auth required, 409 on duplicate).
// PATCH: owner-scoped update (auth required + caller owns the row).
//
// No `@relation` to the locked `User` model — userId is a plain scalar FK, and
// lookups scope by `where: { userId: session.user.id }` to keep callers from
// touching each other's rows.
import 'server-only';
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { type ProfileRow, profileRowToWire } from '@/lib/business/profiles';
import {
  CreateProfile,
  type CreateProfileInput,
  ProfileItem,
  UpdateProfile,
  type UpdateProfileInput,
} from '@/lib/contracts/profiles';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

// Inline flatten of zod issues into `{ errors: { field: message } }` so
// applyServerErrors() lights up the matching form fields.
function flattenZod(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(error.flatten().fieldErrors)) {
    const message = messages?.[0];
    if (message) out[field] = message;
  }
  return out;
}

// Slugify `displayName` (+ optional company) into a URL-safe handle. If a
// collision exists, append a short suffix until unique. Always guarantees a
// non-empty handle.
async function generateHandle(seedDisplay: string, seedCompany: string | null): Promise<string> {
  const baseRaw = [seedCompany, seedDisplay].filter(Boolean).join('-') || seedDisplay;
  const base =
    baseRaw
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'user';
  let candidate = base;
  for (let i = 0; i < 6; i += 1) {
    const taken = await prisma.profile.findUnique({ where: { handle: candidate } });
    if (!taken) return candidate;
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function GET() {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }
  try {
    const row = await prisma.profile.findUnique({ where: { userId: user.id } });
    if (!row) return NextResponse.json({ profile: null });
    return NextResponse.json({ profile: ProfileItem.parse(profileRowToWire(row as ProfileRow)) });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }
  try {
    const parsed = CreateProfile.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ errors: flattenZod(parsed.error) }, { status: 400 });
    }
    const existing = await prisma.profile.findUnique({ where: { userId: user.id } });
    if (existing) {
      return NextResponse.json({ error: 'Profile already exists for this user' }, { status: 409 });
    }
    const data: CreateProfileInput = parsed.data;
    const handle = await generateHandle(data.displayName, data.companyName ?? null);
    const created = await prisma.profile.create({
      data: {
        userId: user.id,
        accountType: data.accountType,
        displayName: data.displayName,
        companyName: data.companyName ?? null,
        positionTitle: data.positionTitle ?? null,
        role: data.role,
        location: data.location ?? null,
        country: data.country ?? null,
        companyDescription: data.companyDescription ?? null,
        materialsBought: data.materialsBought ?? undefined,
        materialsSold: data.materialsSold ?? undefined,
        yearsInBusiness: data.yearsInBusiness ?? null,
        websiteUrl: data.websiteUrl ?? null,
        phone: data.phone ?? null,
        publicEmail: data.publicEmail ?? null,
        socialTwitter: data.socialTwitter ?? null,
        socialLinkedin: data.socialLinkedin ?? null,
        socialInstagram: data.socialInstagram ?? null,
        handle,
      },
    });
    return NextResponse.json(
      { profile: ProfileItem.parse(profileRowToWire(created as ProfileRow)) },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal Server Error';
    if (msg.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Please try a different display name' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }
  try {
    const parsed = UpdateProfile.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ errors: flattenZod(parsed.error) }, { status: 400 });
    }
    const data: UpdateProfileInput = parsed.data;
    const existing = await prisma.profile.findUnique({ where: { userId: user.id } });
    if (!existing) {
      return NextResponse.json({ error: 'No profile to update' }, { status: 404 });
    }
    await prisma.profile.updateMany({
      where: { id: existing.id, userId: user.id },
      data: {
        ...(data.accountType ? { accountType: data.accountType } : {}),
        ...(data.displayName ? { displayName: data.displayName } : {}),
        ...(data.companyName !== undefined ? { companyName: data.companyName } : {}),
        ...(data.positionTitle !== undefined ? { positionTitle: data.positionTitle } : {}),
        ...(data.role ? { role: data.role } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
        ...(data.companyDescription !== undefined
          ? { companyDescription: data.companyDescription }
          : {}),
        ...(data.materialsBought !== undefined
          ? { materialsBought: data.materialsBought ?? undefined }
          : {}),
        ...(data.materialsSold !== undefined
          ? { materialsSold: data.materialsSold ?? undefined }
          : {}),
        ...(data.yearsInBusiness !== undefined ? { yearsInBusiness: data.yearsInBusiness } : {}),
        ...(data.websiteUrl !== undefined ? { websiteUrl: data.websiteUrl } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.publicEmail !== undefined ? { publicEmail: data.publicEmail } : {}),
        ...(data.socialTwitter !== undefined ? { socialTwitter: data.socialTwitter } : {}),
        ...(data.socialLinkedin !== undefined ? { socialLinkedin: data.socialLinkedin } : {}),
        ...(data.socialInstagram !== undefined ? { socialInstagram: data.socialInstagram } : {}),
      },
    });
    const refreshed = await prisma.profile.findUnique({ where: { id: existing.id } });
    if (!refreshed) {
      return NextResponse.json({ error: 'Profile disappeared' }, { status: 500 });
    }
    return NextResponse.json({
      profile: ProfileItem.parse(profileRowToWire(refreshed as ProfileRow)),
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
