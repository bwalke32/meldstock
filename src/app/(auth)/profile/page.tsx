// @polsia:user-owned — /profile — trading-profile editor. The profile island
// handles the unauthenticated case (renders a Sign-in CTA) so the Server
// Component stays small + safe.
import type { Metadata } from 'next';
import { ProfileEditForm } from '@/components/custom/profile/profile-edit-form';

export const metadata: Metadata = {
  title: 'My profile — Meldstock',
  description:
    'Edit your trading profile, materials, and verification status on the Meldstock resin floor.',
};

export default function ProfilePage() {
  return (
    <main className="container-page flex flex-col gap-6 py-section">
      <header className="flex flex-col gap-2">
        <span className="text-eyebrow text-primary">Your profile</span>
        <h1 className="text-h2 font-display leading-tight tracking-[-0.02em] text-foreground">
          Edit trading profile.
        </h1>
        <p className="text-body text-muted-foreground">
          This is the public face you present on every listing and message. Sets your handle, your
          role on the floor, and gates your{' '}
          <span className="font-medium text-foreground">/u/[handle]</span> page.
        </p>
      </header>
      <ProfileEditForm />
    </main>
  );
}
