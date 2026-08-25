"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A bar chart of growth over time. Server-renders the finished chart;
 * when scrolled into view (and motion is allowed) the bars replay their
 * rise via a one-shot CSS animation. No JS → static chart, still correct.
 */
export function GrowthBars({
  points,
  labels,
  className = "",
}: {
  points: number[];
  labels?: string[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [play, setPlay] = useState(false);

  const max = Math.max(...points, 1);

  useEffect(() => {
    const el = ref.current;
    if (!el || play) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPlay(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [play]);

  return (
    <div ref={ref} className={className}>
      <div
        data-play={play ? "" : undefined}
        className="flex h-28 items-end gap-1.5"
        aria-hidden
      >
        {points.map((p, i) => (
          <span
            key={i}
            data-bar
            style={
              {
                height: `${Math.max((p / max) * 100, 3)}%`,
                "--d": `${i * 60}ms`,
              } as React.CSSProperties
            }
            className={`min-w-0 flex-1 rounded-t-sm ${
              i === points.length - 1 ? "bg-accent" : "bg-accent/35"
            } ${play ? "sift-bar-grow" : ""}`}
          />
        ))}
      </div>
      {labels && (
        <div className="mt-1.5 flex justify-between font-mono text-[9px] text-faint">
          {labels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}
