import type { Metadata } from "next";
import { SignInForm } from "./form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Welcome back</h1>
      <p className="mb-5 text-sm text-muted">
        Sign in to your workspaces.
      </p>
      <SignInForm next={safeNext} />
    </>
  );
}
