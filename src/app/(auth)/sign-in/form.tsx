"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction } from "@/app/actions/auth";
import { emptyState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, emptyState);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@studio.com"
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <Button type="submit" loading={pending} className="w-full">
        Sign in
      </Button>
      <div className="flex justify-between font-mono text-[11px] text-muted">
        <Link href="/forgot-password" className="hover:text-accent">
          Forgot password?
        </Link>
        <Link href="/sign-up" className="hover:text-accent">
          Create account â†’
        </Link>
      </div>
    </form>
  );
}
