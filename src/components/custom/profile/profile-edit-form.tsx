// @polsia:user-owned — profile-edit island. Fetches /api/profile/me, hydrates
// the form, submits PATCH /api/profile. The "Request verification" button
// collects a short note and POSTs /api/profile/verification, which creates
// a PENDING request and mirrors that status onto the Profile row.
//
// Loading / unauthenticated / no-profile / error / ready state machine —
// required by the data plane. The form schema mirrors UpdateProfile but
// keeps `yearsInBusiness` as a text input (coerced to a nullable int at
// submit), so the user can leave the field empty.
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { VerificationBadge } from '@/components/custom/profile/verification-badge';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import { ACCOUNT_TYPE_LABELS, BUSINESS_ROLE_LABELS } from '@/lib/business/profiles';
import {
  type AccountType,
  type BusinessRole,
  CreateVerificationRequest,
  type CreateVerificationRequestInput,
  type ProfileItem,
  ProfileItem as ProfileItemSchema,
  type UpdateProfileInput,
} from '@/lib/contracts/profiles';
import { applyServerErrors } from '@/lib/forms';
import { cn } from '@/lib/utils';

// /api/profile/me returns `{ profile: ProfileItem | null }` on GET.
const MeGetResponseSchema = z.object({ profile: ProfileItemSchema.nullable() });
// PATCH /api/profile returns the non-null updated Profile inside `{ profile }`.
const MePatchResponseSchema = z.object({ profile: ProfileItemSchema });

const RequestResponseSchema = z.object({
  request: z.object({
    id: z.string(),
    status: z.enum(['VERIFIED', 'PENDING', 'REJECTED', 'UNVERIFIED']),
    requestedAt: z.string(),
  }),
});

// Local form schema: mirrors the wire contract except `yearsInBusiness`
// stays a text input (empty → null at submit). All optional fields validate
// as either the wire value or empty string; we normalise nulls at submit.
const EditFormSchema = z.object({
  displayName: z.string().min(2, 'At least 2 characters').max(120),
  accountType: z.enum(['INDIVIDUAL', 'COMPANY']),
  companyName: z.string().max(200),
  positionTitle: z.string().max(120),
  role: z.enum([
    'BROKER_TRADER',
    'INJECTION_MOLDER',
    'EXTRUDER',
    'BLOW_MOLDER',
    'THERMOFORMER',
    'RECYCLER_REPROCESSOR',
    'COMPOUNDER',
    'DISTRIBUTOR',
    'RESIN_PRODUCER',
    'SCRAP_GENERATOR',
    'MANUFACTURER',
    'BUYER',
  ]),
  location: z.string().max(160),
  country: z.string().max(80),
  companyDescription: z.string().max(2000),
  websiteUrl: z
    .string()
    .max(300)
    .refine(
      (v) => v === '' || /^https?:\/\/.+/i.test(v.trim()),
      'Enter a URL that starts with http(s)://',
    ),
  publicEmail: z
    .string()
    .max(200)
    .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()), 'Enter a valid email'),
  phone: z.string().max(40),
  yearsInBusiness: z.string().refine((v) => v === '' || /^\d{1,3}$/.test(v.trim()), 'Enter 0–120'),
});
type EditValues = z.infer<typeof EditFormSchema>;

function fromProfileToDefaults(p: ProfileItem): EditValues {
  return {
    displayName: p.displayName,
    accountType: p.accountType,
    companyName: p.companyName ?? '',
    positionTitle: p.positionTitle ?? '',
    role: p.role,
    location: p.location ?? '',
    country: p.country ?? '',
    companyDescription: p.companyDescription ?? '',
    websiteUrl: p.websiteUrl ?? '',
    publicEmail: p.publicEmail ?? '',
    phone: p.phone ?? '',
    yearsInBusiness: p.yearsInBusiness !== null ? String(p.yearsInBusiness) : '',
  };
}

type State =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'no-profile' }
  | { kind: 'error' }
  | { kind: 'ready'; profile: ProfileItem };

export function ProfileEditForm() {
  const { data: session, isPending: sessionPending } = useSession();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [verificationNote, setVerificationNote] = useState('');
  const [verificationPanelOpen, setVerificationPanelOpen] = useState(false);

  const form = useForm<EditValues>({
    resolver: zodResolver(EditFormSchema),
    defaultValues: {
      displayName: '',
      accountType: 'INDIVIDUAL',
      companyName: '',
      positionTitle: '',
      role: 'BROKER_TRADER',
      location: '',
      country: '',
      companyDescription: '',
      websiteUrl: '',
      publicEmail: '',
      phone: '',
      yearsInBusiness: '',
    },
    mode: 'onBlur',
  });

  useEffect(() => {
    let active = true;
    if (sessionPending) {
      return () => {
        active = false;
      };
    }
    if (!session?.user) {
      if (active) setState({ kind: 'unauthenticated' });
      return () => {
        active = false;
      };
    }
    apiFetch<{ profile: ProfileItem | null }>('/api/profile/me', {
      schema: MeGetResponseSchema,
    })
      .then((res) => {
        if (!active) return;
        if (!res.profile) setState({ kind: 'no-profile' });
        else {
          setState({ kind: 'ready', profile: res.profile });
          form.reset(fromProfileToDefaults(res.profile));
        }
      })
      .catch(() => {
        if (active) setState({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [form, session, sessionPending]);

  const onSubmit = form.handleSubmit(async (values: EditValues) => {
    setSaving(true);
    try {
      // Convert blank optional text inputs to null at submit so the wire shape
      // matches UpdateProfile's nullable fields. Number inputs normalise to a
      // positive int or null.
      const payload: UpdateProfileInput = {
        displayName: values.displayName,
        accountType: values.accountType,
        companyName: values.companyName.trim() ? values.companyName : null,
        positionTitle: values.positionTitle.trim() ? values.positionTitle : null,
        role: values.role,
        location: values.location.trim() ? values.location : null,
        country: values.country.trim() ? values.country : null,
        companyDescription: values.companyDescription.trim() ? values.companyDescription : null,
        websiteUrl: values.websiteUrl.trim() ? values.websiteUrl : null,
        publicEmail: values.publicEmail.trim() ? values.publicEmail : null,
        phone: values.phone.trim() ? values.phone : null,
        yearsInBusiness: values.yearsInBusiness.trim()
          ? Number(values.yearsInBusiness.trim())
          : null,
      };
      const updated = await apiFetch<{ profile: ProfileItem }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
        schema: MePatchResponseSchema,
      });
      if (updated.profile) {
        setState({ kind: 'ready', profile: updated.profile });
        form.reset(fromProfileToDefaults(updated.profile));
      }
      toast.success('Profile saved.');
    } catch (err) {
      const applied = err instanceof Error && applyServerErrors(err.cause, form.setError);
      if (!applied) toast.error('Could not save — please try again.');
    } finally {
      setSaving(false);
    }
  });

  const onRequestVerification = async () => {
    if (!verificationNote.trim() || verificationNote.trim().length < 10) {
      toast.error('Add a short note (at least 10 characters).');
      return;
    }
    setRequesting(true);
    try {
      const payload: CreateVerificationRequestInput = {
        requestedDocumentsText: verificationNote.trim(),
      };
      CreateVerificationRequest.parse(payload);
      await apiFetch('/api/profile/verification', {
        method: 'POST',
        body: JSON.stringify(payload),
        schema: RequestResponseSchema,
      });
      toast.success('Verification requested. We will email once the review is complete.');
      setVerificationPanelOpen(false);
      setVerificationNote('');
      if (state.kind === 'ready') {
        setState({
          kind: 'ready',
          profile: {
            ...state.profile,
            verificationStatus: 'PENDING',
            verifiedBadge: 'pending',
          },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not submit verification request.';
      toast.error(msg);
    } finally {
      setRequesting(false);
    }
  };

  // ---- State machine -----------------------------------------------
  if (state.kind === 'loading') {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-8 text-sm text-muted-foreground">
        Loading your profile…
      </div>
    );
  }

  if (state.kind === 'unauthenticated') {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-8 text-sm">
        <p className="mb-3 text-muted-foreground">Sign in to edit your profile.</p>
        <Button asChild>
          <Link href="/login">Sign in →</Link>
        </Button>
      </div>
    );
  }

  if (state.kind === 'no-profile') {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-8 text-sm">
        <p className="mb-2 font-medium text-foreground">No trading profile yet.</p>
        <p className="mb-4 text-muted-foreground">
          You have an account, but no /u/[handle] page yet. Complete your profile on signup to
          unlock listings + verified badges.
        </p>
        <Button asChild>
          <Link href="/signup">Finish signup →</Link>
        </Button>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-sm text-destructive">
        Couldn’t load your profile. Refresh and try again.
      </div>
    );
  }

  const profile = state.profile;
  return (
    <div className="flex flex-col gap-6">
      <Form {...form}>
        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card/40 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <Label className="text-sm font-medium">Public handle</Label>
              <p className="font-mono text-sm text-foreground">
                meldstock.polsia.app/u/<span className="text-primary">{profile.handle}</span>
              </p>
              <p className="text-caption text-muted-foreground">
                Used on every lot you post and on messages from buyers.
              </p>
            </div>
            <VerificationBadge status={profile.verifiedBadge} className="self-start sm:self-auto" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <fieldset className="sm:col-span-2">
              <Label className="text-sm font-medium">Account type</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(['COMPANY', 'INDIVIDUAL'] as const).map((t) => {
                  const checked = form.watch('accountType') === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        form.setValue('accountType', t as AccountType, { shouldDirty: true })
                      }
                      aria-pressed={checked}
                      className={cn(
                        'rounded-md border px-3 py-2 text-left transition-colors',
                        checked
                          ? 'border-primary/60 bg-primary/10 text-foreground'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted/40',
                      )}
                    >
                      <div className="text-sm font-medium">{ACCOUNT_TYPE_LABELS[t]}</div>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input className="h-11" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business role</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value) => field.onChange(value as BusinessRole)}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        [
                          'BROKER_TRADER',
                          'INJECTION_MOLDER',
                          'EXTRUDER',
                          'BLOW_MOLDER',
                          'THERMOFORMER',
                          'RECYCLER_REPROCESSOR',
                          'COMPOUNDER',
                          'DISTRIBUTOR',
                          'RESIN_PRODUCER',
                          'SCRAP_GENERATOR',
                          'MANUFACTURER',
                          'BUYER',
                        ] as BusinessRole[]
                      ).map((key) => (
                        <SelectItem key={key} value={key}>
                          {BUSINESS_ROLE_LABELS[key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company name</FormLabel>
                  <FormControl>
                    <Input className="h-11" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="positionTitle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your title / role</FormLabel>
                  <FormControl>
                    <Input className="h-11" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>City / region</FormLabel>
                  <FormControl>
                    <Input className="h-11" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Country</FormLabel>
                  <FormControl>
                    <Input className="h-11" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="companyDescription"
            render={({ field }) => (
              <FormItem>
                <FormLabel>About you / your company</FormLabel>
                <FormControl>
                  <Textarea
                    className="min-h-[120px]"
                    placeholder="Specialises in prime and off-spec PP. Monthly volumes out of the US Gulf, ships to Mexico and the EU. Open to mutually beneficial barters."
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="websiteUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website</FormLabel>
                  <FormControl>
                    <Input
                      className="h-11"
                      type="url"
                      placeholder="https://"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="publicEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Public email</FormLabel>
                  <FormControl>
                    <Input
                      className="h-11"
                      type="email"
                      placeholder="desk@company.com"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormDescription>Shown on your /u/[handle] page.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input
                      className="h-11"
                      type="tel"
                      placeholder="+1 555 555 5555"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="yearsInBusiness"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Years in business</FormLabel>
                  <FormControl>
                    <Input
                      className="h-11"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-caption text-muted-foreground">
                Last updated <span className="font-mono">{profile.updatedAt.slice(0, 10)}</span>
              </p>
            </div>
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Form>

      <section
        aria-label="Company verification"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card/40 p-5"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-h4 font-display tracking-tight text-foreground">
              Company verification
            </h2>
            <p className="text-sm text-muted-foreground">
              Vetting lifts trust with buyers. We review the request manually and email you when it
              has been decided.
            </p>
          </div>
          <VerificationBadge status={profile.verifiedBadge} className="self-start sm:self-auto" />
        </div>

        {profile.verifiedBadge === 'none' ? (
          !verificationPanelOpen ? (
            <Button
              variant="outline"
              type="button"
              onClick={() => setVerificationPanelOpen(true)}
              className="self-start"
            >
              Request verification →
            </Button>
          ) : (
            <div className="flex flex-col gap-3 rounded-md border border-dashed border-border bg-background/50 p-4">
              <Label htmlFor="verification-note" className="text-sm font-medium">
                Verification note
              </Label>
              <Textarea
                id="verification-note"
                placeholder="Your DUNS / D&B #, US state business registration, or a link to a regulatory license you hold. We do not need uploaded documents for this v1."
                value={verificationNote}
                onChange={(e) => setVerificationNote(e.target.value)}
                className="min-h-[120px]"
              />
              <p className="text-caption text-muted-foreground">At least 10 characters.</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={onRequestVerification}
                  disabled={requesting}
                  size="sm"
                >
                  {requesting ? 'Submitting…' : 'Submit request'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setVerificationPanelOpen(false);
                    setVerificationNote('');
                  }}
                  size="sm"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )
        ) : null}

        {profile.verifiedBadge === 'pending' ? (
          <p className="text-sm text-muted-foreground">
            Your verification request is in the review queue. Average turnaround is 1–2 business
            days.
          </p>
        ) : null}
        {profile.verifiedBadge === 'verified' && profile.verifiedAt ? (
          <p className="text-sm text-muted-foreground">
            Verified on <span className="font-mono">{profile.verifiedAt.slice(0, 10)}</span>. Your
            /u/{' '}
            <Link href={`/u/${profile.handle}`} className="text-brand-600 hover:underline">
              {profile.handle}
            </Link>{' '}
            page shows the badge to every visitor.
          </p>
        ) : null}
        {profile.verifiedBadge === 'rejected' ? (
          <p className="text-sm text-muted-foreground">
            The most recent verification request was rejected. Contact us at meldstock@polsia.app
            and we’ll help you resubmit.
          </p>
        ) : null}
      </section>
    </div>
  );
}
