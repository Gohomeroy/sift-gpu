import React from "react";
import { Composition } from "remotion";
import { ShortFormVideo, type ShortFormProps } from "./compositions/ShortFormVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/*
       * Long-running composition; the render server trims each job to the
       * clip's real length via trimAfter (frames = durationSeconds * fps).
       */}
      <Composition
        id="ShortFormVideo"
        component={ShortFormVideo}
        durationInFrames={30 * 90}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={
          {
            videoUrl: "",
            cues: [],
            title: "",
            captionStyle: "hormozi",
            durationSeconds: 40,
          } satisfies ShortFormProps
        }
      />
    </>
  );
};
