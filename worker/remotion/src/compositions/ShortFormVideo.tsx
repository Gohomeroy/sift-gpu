import React, { useEffect } from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  useVideoConfig,
} from "remotion";
import { Captions, type Cue } from "../components/Captions";
import { ProgressBar } from "../components/ProgressBar";
import { ViralTitle } from "../components/ViralTitle";
import { ensureFonts } from "../fonts";

export type ShortFormProps = {
  videoUrl: string; // absolute http URL served by the render server
  cues: Cue[];
  title: string;
  captionStyle: string;
  durationSeconds: number;
};

export const ShortFormVideo: React.FC<ShortFormProps> = ({
  videoUrl,
  cues,
  title,
  captionStyle,
  durationSeconds,
}) => {
  const { width, height, fps } = useVideoConfig();

  useEffect(() => {
    ensureFonts();
  }, []);

  const frames = Math.max(1, Math.round(durationSeconds * fps));

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Registered composition runs long; the renderer trims to `frames`. */}
      <Sequence from={0} durationInFrames={frames}>
        <OffthreadVideo
          src={videoUrl}
          style={{ width, height, objectFit: "cover" }}
        />
        <Captions cues={cues} style={captionStyle} />
        <ViralTitle title={title} />
        <ProgressBar durationSeconds={durationSeconds} />
      </Sequence>
    </AbsoluteFill>
  );
};
