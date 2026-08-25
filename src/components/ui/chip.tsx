import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-raised text-muted border-line-strong",
  accent: "bg-accent/10 text-accent border-accent/30",
  ok: "bg-ok/10 text-ok border-ok/30",
  err: "bg-err/10 text-err border-err/30",
  info: "bg-info/10 text-info border-info/30",
} as const;

/**
 * Status chip — reads like a timeline clip: tinted ground, signal dot,
 * mono label. Used for job/submission states, plans, member status.
 */
export function Chip({
  tone = "neutral",
  dot = true,
  children,
  className,
}: {
  tone?: keyof typeof tones;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-current opacity-80"
        />
      )}
      {children}
    </span>
  );
}

export function RoleChip({
  name,
  color,
}: {
  name: string;
  color: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-raised px-2 py-0.5 font-mono text-[11px] text-muted">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {name}
    </span>
  );
}
