// @polsia:user-owned — submit-response launcher for WANTED listings.
// Mirror of `<MakeOfferButton/>` flipping sides: this opens a Dialog
// hosting `<ResponseForm/>` which POSTs to
// `/api/listings/[lotId]/responses`.
//
// Renders ONLY for a signed-in viewer who is NOT the lot poster — the
// poster is the RFQ buyer and can't respond to their own RFQ (the
// route rejects that case at 409). Anonymous lots and anonymous
// viewers fall through to the existing free-text thread path.
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
}

export function RespondToWantedButton({
  lotId,
  postedByUserId,
  postedByName,
  lotSummary,
}: RespondToWantedButtonProps) {
  const { data: session, isPending } = useSession();
  const [open, setOpen] = useState(false);

  if (isPending) {
    return null;
  }
  if (!session?.user?.id) {
    return null;
  }
  // Anonymous lot: no structured response path.
  if (!postedByUserId) {
    return null;
  }
  // Viewer IS the lot poster: route rejects at 409. Don't even show.
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
            <DialogTitle>Respond to {postedByName}&apos;s WANTED listing</DialogTitle>
            <DialogDescription>
              Submit a structured response on {lotSummary}. The buyer can accept, counter with their
              own terms, or decline. Counters preserve the full negotiation history — nothing you
              submit here is ever silent or hidden.
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
