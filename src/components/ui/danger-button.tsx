"use client";

import { useRef, useState } from "react";

/**
 * Two-step destructive submit button. First click arms it (label flips,
 * auto-disarms after 3s); second click lets the parent <form action={...}>
 * fire. Keeps irreversible actions off single accidental clicks.
 */
export function DangerButton({
  label,
  confirmLabel,
  className,
}: {
  label: string;
  confirmLabel?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (!armed) {
      e.preventDefault();
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3000);
    } else if (timer.current) {
      clearTimeout(timer.current);
    }
  }

  return (
    <button
      type="submit"
      onClick={handleClick}
      className={
        className ??
        "cursor-pointer rounded px-2 py-1 font-mono text-[11px] text-muted transition-colors duration-150 hover:bg-raised hover:text-err"
      }
    >
      {armed ? confirmLabel ?? `Confirm ${label.toLowerCase()}?` : label}
    </button>
  );
}
