import type { Metadata } from "next";
import { requireOrgContext } from "@/lib/org-context";

export const metadata: Metadata = { title: "Studio" };

// SIFT Studio — our wrapped, rebranded build of the open-source DonkeyCut
// browser editor (Apache-2.0), deployed standalone at STUDIO_URL. Local
// projects live entirely in the browser's own storage; cloud sync is a
// later phase that wires this deployment to our Supabase/R2.
const STUDIO_URL = "https://sift-studio-teal.vercel.app/app";

export default async function StudioPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireOrgContext(slug);

  return (
    <div className="grid gap-3">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Studio</h1>
          <p className="font-mono text-[11px] text-faint">
            Multi-track editing in the browser · projects save to this device
          </p>
        </div>
        <a
          href={STUDIO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-line-strong px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          Open full screen ↗
        </a>
      </header>

      <iframe
        src={STUDIO_URL}
        title="SIFT Studio editor"
        className="h-[calc(100dvh-14rem)] min-h-[32rem] w-full rounded-lg border border-line bg-panel"
        allow="clipboard-write; fullscreen; camera; microphone"
      />
    </div>
  );
}
