import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in?next=/admin");

  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/");

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
          <p className="flex items-baseline gap-2 font-mono text-sm font-medium tracking-widest">
            SIFT<span className="sift-tick" aria-hidden />
            <span className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              platform console
            </span>
          </p>
          <Link
            href="/"
            className="font-mono text-[11px] text-muted transition-colors hover:text-accent"
          >
            ← back to app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-6 sm:px-8">{children}</main>
    </div>
  );
}
