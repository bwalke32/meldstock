// @polsia:user-owned — two-step sign-up + profile-completion form.
// Step 1: account type (COMPANY / INDIVIDUAL) + displayName + email + password.
// Step 2: company details + business role + country/region + about-me +
// (optional) contact info + website.
// On submit we (a) hit better-auth's signUp.email with `name = displayName`
// (better-auth requires a name field), then (b) POST /api/profile to persist
// the full Profile row. After successful create we `window.location.assign`
// so the next page boots with a resolved session.
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import type { Resolver } from 'react-hook-form';
import { type FieldValues, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
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
import { signUp } from '@/lib/auth-client';
import { ACCOUNT_TYPE_LABELS, BUSINESS_ROLE_LABELS } from '@/lib/business/profiles';
import type { AccountType, BusinessRole } from '@/lib/contracts/profiles';
import {
  AccountTypeEnum,
  BusinessRoleEnum,
  CreateProfile,
  type CreateProfileInput,
  ProfileItem,
} from '@/lib/contracts/profiles';
import { applyServerErrors } from '@/lib/forms';
import { cn } from '@/lib/utils';

interface SignUpFormProps {
  /** Optional next path to redirect to after successful signup. */
  redirectTo?: string;
}

// Step 1 — local validation only; better-auth's signUp.email validates the
// actual sign-up server-side.
const StepOneSchema = z.object({
  displayName: z.string().min(2, 'At least 2 characters').max(120),
  email: z.string().email('Enter a valid work email'),
  password: z.string().min(8, 'At least 8 characters').max(128),
  accountType: AccountTypeEnum,
});

type StepOneValues = {
  displayName: string;
  email: string;
  password: string;
  accountType: AccountType;
} & FieldValues;

const STEP_ONE_DEFAULTS: StepOneValues = {
  displayName: '',
  email: '',
  password: '',
  accountType: 'COMPANY',
};

// Step 2 — maps onto the CreateProfile contract. We accept string inputs for
// numeric fields, then parse at submit time.
type StepTwoValues = {
  companyName: string;
  positionTitle: string;
  role: BusinessRole;
  location: string;
  country: string;
  companyDescription: string;
  yearsInBusiness: string;
  websiteUrl: string;
  publicEmail: string;
  phone: string;
} & FieldValues;

const STEP_TWO_DEFAULTS: StepTwoValues = {
  companyName: '',
  positionTitle: '',
  role: 'BROKER_TRADER',
  location: '',
  country: 'USA',
  companyDescription: '',
  yearsInBusiness: '',
  websiteUrl: '',
  publicEmail: '',
  phone: '',
};

// Form-input schema — accepts whatever the form posts to the resolver. Strings
// for optional text fields (the form submits via `field.value` which is
// always a string), then we coerce the numeric + nullable fields at submit.
const StepTwoSchema = z.object({
  companyName: z.string().max(200),
  positionTitle: z.string().max(120),
  role: BusinessRoleEnum,
  location: z.string().max(160),
  country: z.string().max(80),
  companyDescription: z.string().max(2000),
  websiteUrl: z
    .string()
    .max(300)
    .refine((v) => v === '' || /^https?:\/\/.+/i.test(v.trim()), {
      message: 'Enter a URL that starts with http(s)://',
    }),
  publicEmail: z
    .string()
    .max(200)
    .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()), {
      message: 'Enter a valid email',
    }),
  phone: z.string().max(40),
  yearsInBusiness: z
    .string()
    .refine((v) => v === '' || /^\d{1,3}$/.test(v.trim()), { message: 'Enter 0–120' }),
});

// Profile-creating response shape: { profile: ProfilePublic }
const ProfileCreatedSchema = z.object({ profile: ProfileItem });

export function SignUpForm({ redirectTo = '/trading-floor' }: SignUpFormProps) {
  const [step, setStep] = useState<'one' | 'two'>('one');
  const [stepOne, setStepOne] = useState<StepOneValues | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const stepOneForm = useForm<StepOneValues>({
    resolver: zodResolver(StepOneSchema) as Resolver<StepOneValues>,
    defaultValues: STEP_ONE_DEFAULTS,
    mode: 'onBlur',
  });

  const stepTwoForm = useForm<StepTwoValues>({
    resolver: zodResolver(StepTwoSchema) as Resolver<StepTwoValues>,
    defaultValues: STEP_TWO_DEFAULTS,
    mode: 'onBlur',
  });

  const onStepOne = stepOneForm.handleSubmit(async (values) => {
    setStepOne({ ...values });
    setStep('two');
  });

  const onStepTwo = stepTwoForm.handleSubmit(async (values) => {
    if (!stepOne) return;
    setPending(true);
    setError(undefined);
    try {
      // Step A — better-auth sign-up. `name` is required by the better-auth
      // user model; we use the display name so the seeded shape stays clean.
      const { error: signUpError } = await signUp.email({
        email: stepOne.email,
        password: stepOne.password,
        name: stepOne.displayName,
      });
      if (signUpError) {
        setError(signUpError.message ?? 'Could not create your account.');
        setPending(false);
        return;
      }
      // Step B — first-time-create the Profile row.
      const merged: CreateProfileInput = {
        accountType: stepOne.accountType,
        displayName: stepOne.displayName,
        companyName: values.companyName.trim() ? values.companyName : null,
        positionTitle: values.positionTitle.trim() ? values.positionTitle : null,
        role: values.role as BusinessRole,
        location: values.location.trim() ? values.location : null,
        country: values.country.trim() ? values.country : null,
        companyDescription: values.companyDescription.trim() ? values.companyDescription : null,
        websiteUrl: values.websiteUrl.trim() ? values.websiteUrl : null,
        publicEmail: values.publicEmail.trim() ? values.publicEmail : null,
        phone: values.phone.trim() ? values.phone : null,
        yearsInBusiness:
          values.yearsInBusiness && Number.isFinite(Number(values.yearsInBusiness))
            ? Number(values.yearsInBusiness)
            : null,
      };
      // Validate against the contract before hitting the network — surfaces
      // field issues locally without a round-trip.
      const verification = CreateProfile.safeParse(merged);
      if (!verification.success) {
        const applied = applyServerErrors(verification.error.flatten(), stepTwoForm.setError);
        if (!applied) setError('Please check the highlighted fields.');
        setPending(false);
        return;
      }
      const created = await apiFetch<{ profile: unknown }>('/api/profile', {
        method: 'POST',
        body: JSON.stringify(verification.data),
        schema: ProfileCreatedSchema,
      });
      void created;
      toast.success('Account created. Welcome to the floor.');
      window.location.assign(redirectTo);
    } catch (err) {
      const applied = err instanceof Error && applyServerErrors(err.cause, stepTwoForm.setError);
      if (!applied) {
        const message =
          err instanceof Error ? err.message : 'Something went wrong. Please try again.';
        setError(message);
      }
      setPending(false);
    }
  });

  if (step === 'one' || !stepOne) {
    const watchedType = stepOneForm.watch('accountType');
    return (
      <Form {...stepOneForm}>
        <form onSubmit={onStepOne} className="flex flex-col gap-4" noValidate>
          <fieldset className="flex flex-col gap-2">
            <Label className="text-sm font-medium">Account type</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['COMPANY', 'INDIVIDUAL'] as const).map((type) => {
                const checked = watchedType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => stepOneForm.setValue('accountType', type, { shouldDirty: true })}
                    aria-pressed={checked}
                    className={cn(
                      'rounded-md border px-3 py-3 text-left transition-colors',
                      checked
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    <div className="text-sm font-medium">{ACCOUNT_TYPE_LABELS[type]}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {type === 'COMPANY'
                        ? 'For LLCs, corporations, or registered brokerage desks.'
                        : 'For independent traders or sole proprietors.'}
                    </div>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <FormField
            control={stepOneForm.control}
            name="displayName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Display name</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    placeholder="Acme Polymers · Broker desk"
                    autoComplete="organization"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={stepOneForm.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email address</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={stepOneForm.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input className="h-11" type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormDescription>At least 8 characters.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" size="lg">
            Continue →
          </Button>
        </form>
      </Form>
    );
  }

  const isCompany = stepOne.accountType === 'COMPANY';
  const roleKeys = BusinessRoleEnum.options;
  return (
    <Form {...stepTwoForm}>
      <form onSubmit={onStepTwo} className="flex flex-col gap-4" noValidate>
        <p className="text-caption text-muted-foreground">
          Step 2 of 2 · Trading profile for{' '}
          <span className="font-medium text-foreground">{stepOne.email}</span>
        </p>
        {isCompany ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              control={stepTwoForm.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company name</FormLabel>
                  <FormControl>
                    <Input
                      className="h-11"
                      placeholder="Acme Polymers LLC"
                      autoComplete="organization"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={stepTwoForm.control}
              name="positionTitle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your role / title</FormLabel>
                  <FormControl>
                    <Input
                      className="h-11"
                      placeholder="VP Resin Trading"
                      autoComplete="organization-title"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        ) : null}
        <FormField
          control={stepTwoForm.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Business role</FormLabel>
              <Select value={field.value} onValueChange={(value) => field.onChange(value)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {(roleKeys as BusinessRole[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {BUSINESS_ROLE_LABELS[key as BusinessRole]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>What your business does on the floor.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={stepTwoForm.control}
            name="location"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City / region</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    placeholder="Houston, TX"
                    autoComplete="address-level2"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={stepTwoForm.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    placeholder="USA"
                    autoComplete="country-name"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={stepTwoForm.control}
          name="companyDescription"
          render={({ field }) => (
            <FormItem>
              <FormLabel>About you {isCompany ? ' / your company' : ''}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Specialises in prime and off-spec PP. Monthly volumes out of the US Gulf, ships to Mexico and the EU. Open to mutually beneficial barters."
                  className="min-h-[80px]"
                  {...field}
                  value={field.value ?? ''}
                />
              </FormControl>
              <FormDescription>Public, shown to other members on the floor.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={stepTwoForm.control}
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
                    placeholder="0"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={stepTwoForm.control}
            name="websiteUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Website</FormLabel>
                <FormControl>
                  <Input
                    className="h-11"
                    type="url"
                    placeholder="https://"
                    autoComplete="url"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={pending} size="lg" className="w-full">
          {pending ? 'Creating account…' : 'Create account →'}
        </Button>
      </form>
    </Form>
  );
}
