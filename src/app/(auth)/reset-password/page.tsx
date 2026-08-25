import type { Metadata } from "next";
import { ResetPasswordForm } from "../shared-forms";

export const metadata: Metadata = { title: "Set new password" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Set a new password</h1>
      <p className="mb-5 text-sm text-muted">
        Pick something you haven&apos;t used elsewhere.
      </p>
      <ResetPasswordForm />
    </>
  );
}
