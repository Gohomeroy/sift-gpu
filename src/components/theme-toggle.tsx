"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme = "dark", setTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={
        className ??
        "inline-flex cursor-pointer items-center justify-center rounded-md p-2 text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
      }
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
