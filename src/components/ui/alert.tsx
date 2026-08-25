import { cn } from "@/lib/utils";

const kinds = {
  error: "border-err/30 bg-err/10 text-err",
  success: "border-ok/30 bg-ok/10 text-ok",
} as const;

export function Alert({
  kind,
  children,
  className,
}: {
  kind: keyof typeof kinds;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        kinds[kind],
        className,
      )}
    >
      {children}
    </div>
  );
}
