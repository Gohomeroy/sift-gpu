"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction } from "@/app/actions/auth";
import { emptyState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";

export function SignUpForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signUpAction, emptyState);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Display name" htmlFor="display_name">
        <Input
          id="display_name"
          name="display_name"
          required
          minLength={2}
          maxLength={50}
          placeholder="Mara Chen"
          autoComplete="name"
        />
      </Field>
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
      <Field label="Password" hint="At least 8 characters." htmlFor="password">
        <Input
          id="password"
          name="password"
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
            href="/sign-in"
            className="text-center font-mono text-[11px] text-accent hover:underline"
          >
            Back to sign in →
          </Link>
        </>
      )}
      {!state.success && (
        <Button type="submit" loading={pending} className="w-full">
          Create account
        </Button>
      )}
      <p className="text-center font-mono text-[11px] text-muted">
        Already have one?{" "}
        <Link href="/sign-in" className="hover:text-accent">
          Sign in
        </Link>
      </p>
    </form>
  );
}
