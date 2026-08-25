import type { Metadata } from "next";
import Link from "next/link";
import { requireUser, getUserOrganizations } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/actions/auth";
import { leaveOrganizationAction } from "@/app/actions/orgs";
import { ProfileForm } from "./profile-form";
import { AvatarPicker } from "@/components/avatar-picker";
import { LinkedAccounts, type LinkedAccountView } from "@/components/linked-accounts";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: profile }, orgs, linkedRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    getUserOrganizations(),
    supabase
      .from("linked_accounts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="mx-auto grid min-h-dvh max-w-2xl content-start gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="font-mono text-sm font-medium tracking-widest">
          SIFT<span className="sift-tick" aria-hidden />
        </Link>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <section>
        <h1 className="text-xl font-semibold tracking-tight">Your profile</h1>
        <p className="mt-0.5 text-sm text-muted">
          One profile across every workspace you&apos;re in. Reputation and
          ratings stay per-workspace.
        </p>
      </section>

      <section className="rounded-lg border border-line bg-panel p-5">
        <h2 className="mb-3 text-sm font-semibold">Profile photo</h2>
        <AvatarPicker
          userId={user.id}
          displayName={profile?.display_name ?? "Member"}
          avatarUrl={profile?.avatar_url ?? null}
        />
      </section>

      <ProfileForm
        displayName={profile?.display_name ?? ""}
        bio={profile?.bio ?? ""}
        skills={(profile?.skills ?? []).join(", ")}
      />

      <section className="rounded-lg border border-line bg-panel p-5">
        <h2 className="mb-1 text-sm font-semibold">Linked accounts</h2>
        <p className="mb-3 text-xs text-muted">
          Prove you own your clipping accounts once — campaign entries must come
          from a verified account.
        </p>
        <LinkedAccounts accounts={(linkedRes.data ?? []) as LinkedAccountView[]} />
      </section>

      <section className="grid gap-2">
        <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
          Workspaces
        </h2>
        {orgs.length === 0 ? (
          <p className="text-sm text-muted">
            You haven&apos;t joined any workspace yet —{" "}
            <Link href="/onboarding" className="text-accent hover:underline">
              start one or redeem an invite
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
            {orgs.map((o) => (
              <li key={o.id} className="flex items-center justify-between px-3 py-2.5">
                <Link
                  href={`/o/${o.slug}`}
                  className="text-sm hover:text-accent"
                >
                  {o.name}
                  <span className="ml-2 font-mono text-[11px] text-faint">
                    /o/{o.slug}
                  </span>
                </Link>
                {o.owner_id === user.id ? (
                  <span className="font-mono text-[10px] text-accent">OWNER</span>
                ) : (
                  <form action={leaveOrganizationAction}>
                    <input type="hidden" name="organization_id" value={o.id} />
                    <button
                      type="submit"
                      className="cursor-pointer rounded px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-raised hover:text-err"
                    >
                      LEAVE
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
