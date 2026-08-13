// @polsia:user-owned — make-offer launcher on the lot detail page.
//
// Opposite of <MessageSellerButton/>: posts a STRUCTURED offer on a HAVE
// listing. Renders ONLY for a signed-in viewer who is NOT the lot
// poster — anonymous viewers and the seller fall through to the
// legacy anonymous free-text dialog. Anonymous + signed-in user paths
// stay additive: anonymous viewers still post LotMessage free-text;
// signed-in buyers also see this button.
//
// The button kicks off a Dialog hosting <OfferForm/>. The form
// POSTs to `/api/listings/[lotId]/offers`, on success closes the
// dialog and emits an `offers:invalidate` window event so the
// `<OfferThread>` re-fetches the timeline.
'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { OfferForm } from '@/components/custom/offers/OfferForm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSession } from '@/lib/auth-client';

export interface MakeOfferButtonProps {
  lotId: string;
  sellerUserId: string | null;
  postedByName: string;
  lotSummary: string;
}

export function MakeOfferButton({
  lotId,
  sellerUserId,
  postedByName,
  lotSummary,
}: MakeOfferButtonProps) {
  const { data: session, isPending } = useSession();
  const [open, setOpen] = useState(false);

  // While the client hasn't resolved, render nothing so we don't
  // briefly flash the button for anon viewers / the seller.
  if (isPending) {
    return null;
  }
  // Anonymous viewer → legacy free-text thread carries them.
  if (!session?.user?.id) {
    return null;
  }
  // Anonymous lot (no seller profile) → the existing free-text path.
  if (!sellerUserId) {
    return null;
  }
  // Seller viewing their own lot → no offer entry from themselves.
  if (sellerUserId === session.user.id) {
    return null;
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next && typeof window !== 'undefined') {
      // Closing the dialog after a successful submit triggers re-hydrate.
      window.dispatchEvent(new Event('offers:invalidate'));
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Plus aria-hidden="true" className="mr-1.5 size-3.5" />
        Make offer →
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Make an offer to {postedByName}</DialogTitle>
            <DialogDescription>
              Submit a structured offer on {lotSummary}. The seller can accept, counter with
              different terms, or decline. Counters preserve the full negotiation history — nothing
              you write here is ever silent or hidden.
            </DialogDescription>
          </DialogHeader>
          <OfferForm
            lotId={lotId}
            onSuccess={() => {
              setOpen(false);
              toast.success('Offer sent to the seller.');
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('offers:invalidate'));
                window.dispatchEvent(new Event('deal-status:invalidate'));
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
