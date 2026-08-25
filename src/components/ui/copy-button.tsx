"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({
  value,
  getValue,
  label = "Copy",
  copiedLabel = "Copied",
  className,
}: {
  value?: string;
  /** Resolved at click time — for URLs that depend on window.location. */
  getValue?: () => string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const text = getValue ? getValue() : (value ?? "");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (permissions/insecure context) — select fallback:
      window.prompt("Copy this link:", getValue ? getValue() : value);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        className ??
        "inline-flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] text-muted transition-colors duration-150 hover:bg-raised hover:text-accent"
      }
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? copiedLabel : label}
    </button>
  );
}
