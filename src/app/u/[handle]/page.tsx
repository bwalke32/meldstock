// @polsia:user-owned — /u/[handle] — public profile page. A Server Component
// (no 'use client' — exports metadata per the data-plane rule) that renders
// the PublicProfile island. The island does the actual data fetch via
// /api/profile/[handle].
import type { Metadata } from 'next';
import { PublicProfile } from '@/components/custom/profile/public-profile';

interface PageProps {
  params: Promise<{ handle: string }>;
}

// Fallback when we don't have a session (the page is public): the metadata
// title is just the handle. The island shows the full display name once it
// resolves.
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle } = await params;
  return {
    title: `@${handle} — Meldstock`,
    description: `Public trade profile for @${handle} on the Meldstock resin trading floor.`,
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { handle } = await params;
  return (
    <main className="container-page flex flex-col gap-8 py-section">
      <PublicProfile handle={handle} />
    </main>
  );
}
