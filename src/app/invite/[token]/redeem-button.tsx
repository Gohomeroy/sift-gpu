"use client";

import { useActionState } from "react";
import { redeemInviteAction } from "@/app/actions/invites";
import { emptyState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function RedeemButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState(redeemInviteAction, emptyState);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <Button type="submit" loading={pending} className="w-full">
        Accept invite
      </Button>
    </form>
  );
}
