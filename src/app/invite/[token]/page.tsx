import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/org-context";
import { Chip } from "@/components/ui/chip";
import { RedeemButton } from "./redeem-button";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data: preview } = await supabase.rpc("invite_preview", {
    p_token: token,
  });
  const info = preview?.[0];
  const user = await getSessionUser();

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-6 text-center">
        <span className="font-mono text-sm font-medium tracking-widest">
          SIFT<span className="sift-tick" aria-hidden />
        </span>

        {info ? (
          <>
            <h1 className="mt-6 text-base font-semibold">You&apos;re invited</h1>
            <p className="mt-2 text-sm text-muted">
              Join{" "}
              <span className="font-medium text-ink">{info.org_name}</span> as
              a{" "}
              <Chip tone="accent" className="ml-1">
                {info.role_name}
              </Chip>
            </p>
            <div className="mt-6">
              {user ? (
                <RedeemButton token={token} />
              ) : (
                <div className="grid gap-2">
                  <Link
                    href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}
                    className="inline-flex h-9 items-center justify-center rounded-md bg-accent text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                  >
                    Sign in to accept
                  </Link>
                  <Link
                    href={`/sign-up?next=${encodeURIComponent(`/invite/${token}`)}`}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-line-strong text-sm transition-colors hover:border-faint hover:bg-raised"
                  >
                    Create an account first
                  </Link>
                </div>
              )}
            </div>
            <p className="mt-5 font-mono text-[10px] break-all text-faint">
              INVITE {token.slice(0, 12)}…
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-base font-semibold">
              Invite unavailable
            </h1>
            <p className="mt-2 text-sm text-muted">
              This link is invalid, expired, or out of uses. Ask the workspace
              admin for a fresh one.
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex h-9 items-center justify-center rounded-md border border-line-strong px-4 text-sm transition-colors hover:border-faint hover:bg-raised"
            >
              Back home
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
