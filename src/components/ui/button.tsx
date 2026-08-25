import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-accent text-on-accent font-medium hover:bg-accent-hover active:bg-accent-hover disabled:hover:bg-accent",
  outline:
    "border border-line-strong text-ink hover:border-faint hover:bg-raised disabled:hover:border-line-strong disabled:hover:bg-transparent",
  ghost: "text-muted hover:bg-raised hover:text-ink",
  danger:
    "border border-err/40 text-err hover:bg-err/10 disabled:hover:bg-transparent",
} as const;

const sizes = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
} as const;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-md transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading && (
        <span
          aria-hidden
          className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
