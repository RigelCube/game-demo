import { useEffect, useRef, useState } from "react";

const VIDEO_CONSTRAINTS = {
  video: { width: { max: 640 }, height: { max: 480 }, frameRate: { max: 25 } },
  audio: true,
};

export function useLocalStream() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let isMounted = true;

    const getStream = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
        if (isMounted) {
          setStream(mediaStream);
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          console.error("Error accessing media devices:", err);
        }
      }
    };

    getStream();

    return () => {
      isMounted = false;
      // Don't stop stream here, let parent manage it
    };
  }, []);

  const stopStream = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  return { stream, error, videoRef, stopStream };
}
