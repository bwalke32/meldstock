// @polsia:user-owned — submit-response launcher for WANTED listings.
// Mirror of `<MakeOfferButton/>` flipping sides: this opens a Dialog
// hosting `<ResponseForm/>` which POSTs to
// `/api/listings/[lotId]/responses`.
//
// Renders ONLY for a signed-in viewer who is NOT the lot poster. Signed-in
// specialists may respond to identity-scrubbed requests; the server resolves
// the real owner and opens a private thread without exposing that owner id on
// the public wire.
// Successful submit fires `wanted-responses:invalidate` so the
// `<WantedResponsesSummary/>` re-fetches on this page (and any other
// open /lots/[id] pages).
'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ResponseForm } from '@/components/custom/rfq/ResponseForm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSession } from '@/lib/auth-client';

export interface RespondToWantedButtonProps {
  lotId: string;
  /** id of the lot poster (the buyer) — gated true when this is the viewer. */
  postedByUserId: string | null;
  postedByName: string;
  lotSummary: string;
  /** True only for the current viewer; does not reveal an anonymous buyer id. */
  viewerIsOwner?: boolean;
}

export function RespondToWantedButton({
  lotId,
  postedByUserId,
  lotSummary,
  viewerIsOwner = false,
}: RespondToWantedButtonProps) {
  const { data: session, isPending } = useSession();
  const [open, setOpen] = useState(false);

  if (isPending) {
    return null;
  }
  if (!session?.user?.id) {
    return null;
  }
  // The detail endpoint supplies this privacy-safe flag even when the
  // anonymous request intentionally scrubs postedByUserId from the wire.
  if (viewerIsOwner) {
    return null;
  }
  // Non-anonymous fallback: hide the action for the request owner.
  if (postedByUserId === session.user.id) {
    return null;
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Plus aria-hidden="true" className="mr-1.5 size-3.5" />
        Submit a structured response →
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Respond to this material request</DialogTitle>
            <DialogDescription>
              Submit a structured response on {lotSummary}. The requester can accept, counter, or
              decline without their identity being exposed publicly. A private thread opens when
              your response is submitted.
            </DialogDescription>
          </DialogHeader>
          <ResponseForm
            lotId={lotId}
            onSuccess={() => {
              setOpen(false);
              toast.success('Response sent to the buyer.');
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('wanted-responses:invalidate'));
                window.dispatchEvent(new Event('deal-status:invalidate'));
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
