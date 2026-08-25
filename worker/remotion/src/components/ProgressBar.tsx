import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

/** Thin progress bar pinned to the bottom edge, TikTok-style. */
export const ProgressBar: React.FC<{ durationSeconds: number }> = ({
  durationSeconds,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = Math.max(durationSeconds * fps, 1);
  const pct = Math.min(frame / total, 1);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 40,
        left: 60,
        right: 60,
        height: 10,
        borderRadius: 999,
        background: "rgba(255,255,255,0.28)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct * 100}%`,
          height: "100%",
          borderRadius: 999,
          background: "#FFFFFF",
        }}
      />
    </div>
  );
};
