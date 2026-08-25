"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { ChevronsUpDown, Plus } from "lucide-react";

export type SwitcherOrg = { id: string; name: string; slug: string };

export function OrgSwitcher({
  current,
  orgs,
}: {
  current: SwitcherOrg;
  orgs: SwitcherOrg[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const others = orgs.filter((o) => o.id !== current.id);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2 transition-colors hover:border-line-strong"
      >
        <span className="truncate text-sm font-medium">{current.name}</span>
        <ChevronsUpDown size={14} className="shrink-0 text-faint" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-40 mt-1 w-full overflow-hidden rounded-md border border-line-strong bg-overlay shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
        >
          <ul className="max-h-56 overflow-y-auto p-1">
            {others.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/o/${o.slug}`}
                  onClick={() => setOpen(false)}
                  className="block truncate rounded px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  {o.name}
                </Link>
              </li>
            ))}
            {others.length === 0 && (
              <li className="px-2.5 py-1.5 font-mono text-[11px] text-faint">
                Only this workspace
              </li>
            )}
          </ul>
          <Link
            href="/onboarding"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs text-muted transition-colors hover:bg-raised hover:text-accent"
          >
            <Plus size={13} /> All workspaces &amp; newâ€¦
          </Link>
        </div>
      )}
    </div>
  );
}
