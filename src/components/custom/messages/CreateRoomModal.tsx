// @polsia:user-owned — Create-room modal. Triggered from the dashboard
// inbox header ("Create room" button). Two-step flow:
//
//   1. NAME + (optional) DESCRIPTION.
//   2. INVITEE PICKER (the mounted <RoomInviteePicker/> component) —
//      caller must pick at least 1 invitee before submit.
//
// Submit POSTs to /api/rooms with the validated shape from
// `CreateRoomInput`. On 201 the modal closes and the parent hub is asked
// to navigate to /dashboard/messages?thread=<id> and refresh the inbox —
// the wire is `RoomCreated`, the same shape the inbox stamps on
// broker-group rows.
//
// 403: an invitee is not in the caller's network AND not a verified
// company — surfaced inline on the form with the offending userId list
// so the picker row can be highlighted.
// 400: field-level (zod) error — rendered against the offending input.
// 401: redirect to /login (mirrors the inbox failure path).
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { RoomInviteePicker } from '@/components/custom/messages/RoomInviteePicker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api-client';
import {
  type CreateRoomInput,
  CreateRoomInput as CreateRoomInputSchema,
  type RoomCreated,
  RoomCreated as RoomCreatedSchema,
} from '@/lib/contracts/messaging';

export interface CreateRoomModalProps {
  /** Controlled open state — owned by the inbox so the modal can be
   *  dismissed from outside via the dialog's X-button. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called on a successful 201. The parent navigates AND refreshes the
   *  inbox list so the new room row appears without a manual reload. */
  onCreated?: (room: RoomCreated) => void;
}

export function CreateRoomModal({ open, onOpenChange, onCreated }: CreateRoomModalProps) {
  const router = useRouter();
  const form = useForm<CreateRoomInput>({
    resolver: zodResolver(CreateRoomInputSchema),
    defaultValues: { name: '', description: '', inviteeUserIds: [] },
    mode: 'onBlur',
  });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Reset on close — keeps stale form state from leaking into the next
      // open, especially the invitee list (last week's invitees shouldn't
      // pre-populate this week's picker).
      form.reset({ name: '', description: '', inviteeUserIds: [] });
      setServerError(null);
    }
    onOpenChange(next);
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    if (submitting) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const room = await apiFetch<RoomCreated>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name.trim(),
          description: values.description?.trim() === '' ? undefined : values.description,
          inviteeUserIds: values.inviteeUserIds,
        }),
        schema: RoomCreatedSchema,
      });
      toast.success(`Room “${room.subject}” created.`);
      onCreated?.(room);
      // Navigate to the new room — the inbox island picks up the URL
      // param, opens the right pane on it, and the threads fetch
      // re-runs naturally.
      router.push(`/dashboard/messages?thread=${encodeURIComponent(room.id)}`);
      handleOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const statusMatch = /\((\d{3})\)/.exec(message);
      const status = statusMatch?.[1];
      const body = (
        err as
          | { cause?: { error?: string; err?: string; errors?: Record<string, string> } }
          | undefined
      )?.cause;
      if (status === '401') {
        router.replace('/login');
        return;
      }
      if (status === '403') {
        setServerError(body?.error ?? 'Some invitees are not allowed.');
        return;
      }
      if (body?.errors) {
        // Field-level errors from zod — apply to react-hook-form.
        for (const [field, msg] of Object.entries(body.errors)) {
          form.setError(field as keyof CreateRoomInput, { type: 'server', message: msg });
        }
        return;
      }
      setServerError(body?.error ?? 'Could not create the room. Please try again.');
    } finally {
      setSubmitting(false);
    }
  });

  const nameError = form.formState.errors.name?.message;
  const inviteeError = form.formState.errors.inviteeUserIds?.message;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-h3 tracking-[-0.02em]">
            Create a broker group room
          </DialogTitle>
          <DialogDescription>
            Rooms are private conversations not tied to any one listing. Pick a clear name and
            invite people from your network or verified companies.
          </DialogDescription>
        </DialogHeader>

        <form
          id="create-room-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-name" className="text-eyebrow text-muted-foreground">
              Room name
            </Label>
            <Input
              id="room-name"
              type="text"
              placeholder="e.g. March MRP swaps"
              autoComplete="off"
              maxLength={120}
              {...form.register('name')}
            />
            {nameError ? <p className="text-[11px] text-destructive">{nameError}</p> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-description" className="text-eyebrow text-muted-foreground">
              Description <span className="text-[10px] text-muted-foreground/70">(optional)</span>
            </Label>
            <Textarea
              id="room-description"
              placeholder="What is this room about?"
              className="min-h-[72px]"
              maxLength={1000}
              {...form.register('description')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-eyebrow text-muted-foreground">Invite people</Label>
            <RoomInviteePicker
              value={form.watch('inviteeUserIds')}
              max={50}
              onChange={(next) => form.setValue('inviteeUserIds', next, { shouldValidate: true })}
            />
            {inviteeError ? <p className="text-[11px] text-destructive">{inviteeError}</p> : null}
          </div>

          {serverError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-caption text-destructive">
              {serverError}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" form="create-room-form" size="sm" disabled={submitting}>
            <Plus aria-hidden="true" className="mr-1 size-3.5" />
            {submitting ? 'Creating…' : 'Create room'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
