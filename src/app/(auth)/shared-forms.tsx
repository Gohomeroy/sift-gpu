"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction, updatePasswordAction } from "@/app/actions/auth";
import { emptyState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    forgotPasswordAction,
    emptyState,
  );

  return (
    <form action={action} className="grid gap-4">
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@studio.com"
        />
      </Field>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <Button type="submit" loading={pending} className="w-full">
        Send reset link
      </Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(
    updatePasswordAction,
    emptyState,
  );

  return (
    <form action={action} className="grid gap-4">
      <Field label="New password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm">
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.success && (
        <>
          <Alert kind="success">{state.success}</Alert>
          <Link
            href="/"
            className="text-center font-mono text-[11px] text-accent hover:underline"
          >
            Continue to SIFT â†’
          </Link>
        </>
      )}
      {!state.success && (
        <Button type="submit" loading={pending} className="w-full">
          Update password
        </Button>
      )}
    </form>
  );
}
