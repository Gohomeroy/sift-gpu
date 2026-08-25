import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = { title: "Account" };

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative grid min-h-dvh place-items-center px-4">
      <ThemeToggle className="absolute top-5 right-5 inline-flex cursor-pointer items-center justify-center rounded-md p-2 text-muted transition-colors duration-150 hover:bg-raised hover:text-ink" />
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex justify-center font-mono text-sm font-medium tracking-widest"
        >
          SIFT<span className="sift-tick" aria-hidden />
        </Link>
        <div className="rounded-lg border border-line bg-panel p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
