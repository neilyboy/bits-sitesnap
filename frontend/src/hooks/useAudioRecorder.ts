import { useCallback, useEffect, useRef, useState } from "react";

export interface UseAudioRecorder {
  supported: boolean;
  recording: boolean;
  error: string;
  start: () => Promise<void>;
  stop: () => Promise<{ blob: Blob; durationSec: number } | null>;
}

export function useAudioRecorder(): UseAudioRecorder {
  const supported = typeof MediaRecorder !== "undefined";
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTsRef = useRef(0);

  const start = useCallback(async () => {
    if (!supported) {
      setError("MediaRecorder not supported.");
      return;
    }
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start();
      recRef.current = rec;
      startTsRef.current = Date.now();
      setRecording(true);
    } catch (e: any) {
      setError(e?.message ?? "microphone access denied");
    }
  }, [supported]);

  const stop = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return null;
    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || "audio/webm";
        resolve(new Blob(chunksRef.current, { type }));
      };
      rec.stop();
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    setRecording(false);
    const durationSec = (Date.now() - startTsRef.current) / 1000;
    return { blob, durationSec };
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { supported, recording, error, start, stop };
}
