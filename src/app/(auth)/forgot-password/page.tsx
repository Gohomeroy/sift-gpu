import type { Metadata } from "next";
import { ForgotPasswordForm } from "../shared-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Forgot password</h1>
      <p className="mb-5 text-sm text-muted">
        We&apos;ll email you a link to set a new one.
      </p>
      <ForgotPasswordForm />
    </>
  );
}
