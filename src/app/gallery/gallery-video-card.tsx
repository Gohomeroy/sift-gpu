"use client";

import { useRef } from "react";

type Props = {
  src: string;
  viralScore?: number | null;
};

export function GalleryVideoCard({ src, viralScore }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="relative aspect-[9/16] bg-raised">
      <video
        ref={videoRef}
        src={src}
        muted
        preload="metadata"
        className="h-full w-full object-cover"
        onMouseEnter={() => videoRef.current?.play()}
        onMouseLeave={() => {
          const v = videoRef.current;
          if (v) {
            v.pause();
            v.currentTime = 0;
          }
        }}
      />
      {viralScore != null && (
        <span className="absolute right-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-bold text-green-400">
          {viralScore}
        </span>
      )}
    </div>
  );
}
