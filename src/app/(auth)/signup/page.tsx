// @polsia:user-owned — seeded by polsia/modules/better-auth; restyle freely.

import { SignUpForm } from '@/components/custom/sign-up-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { BusinessRole } from '@/lib/contracts/profiles';

interface SignupPageProps {
  searchParams: Promise<{ role?: string; next?: string }>;
}

const SAFE_REDIRECTS = new Set(['/request-material', '/dashboard', '/messages']);

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const initialRole: BusinessRole =
    params.role === 'specialist' ? 'BROKER_TRADER' : 'INJECTION_MOLDER';
  const redirectTo =
    params.next && SAFE_REDIRECTS.has(params.next) ? params.next : '/request-material';

  return (
    <main className="min-h-dvh flex items-center justify-center px-gutter py-section bg-[var(--background)]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-[-30%] left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-[var(--brand-100)] opacity-40 blur-3xl" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[var(--brand-200)] opacity-30 blur-3xl" />
      </div>

      <Card className="relative w-full max-w-md shadow-brand border border-border/60 bg-card/95 backdrop-blur-sm">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-h4">Create an account</CardTitle>
          <CardDescription>
            {initialRole === 'BROKER_TRADER'
              ? 'Apply to the founding sourcing network'
              : 'Create a free molder account'}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <SignUpForm redirectTo={redirectTo} initialRole={initialRole} />
          <p className="mt-4 text-center text-small text-muted-foreground">
            Already have an account?{' '}
            <a
              href="/login"
              className="text-brand-600 font-medium hover:text-brand-700 hover:underline underline-offset-2 transition-colors"
            >
              Sign in
            </a>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
