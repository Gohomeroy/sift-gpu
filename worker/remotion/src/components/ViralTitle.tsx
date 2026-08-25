import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * Top title bar: slides in over the first second, bold uppercase with an
 * accent block behind the first word. Auto-hides after 3.5s.
 */
export const ViralTitle: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 200 } });
  const exitAt = 3.5 * fps;
  const opacity = interpolate(frame, [exitAt - 8, exitAt], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (!title) return null;

  const words = title.toUpperCase().split(" ");
  const first = words.shift() ?? "";

  return (
    <div
      style={{
        position: "absolute",
        top: 150,
        left: 60,
        right: 60,
        transform: `translateY(${(1 - enter) * -80}px)`,
        opacity,
      }}
    >
      <div
        style={{
          display: "inline-block",
          background: "#0570de",
          color: "#fff",
          padding: "10px 22px",
          borderRadius: 12,
          fontSize: 54,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        {first}
      </div>
      <div
        style={{
          background: "rgba(10,37,64,0.88)",
          color: "#fff",
          padding: "14px 24px",
          borderRadius: 14,
          fontSize: 62,
          fontWeight: 900,
          lineHeight: 1.12,
          marginTop: 10,
          textShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}
      >
        {words.join(" ")}
      </div>
    </div>
  );
};
