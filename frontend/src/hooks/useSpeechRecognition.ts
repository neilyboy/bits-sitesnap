import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getCtor() !== null;
}

export interface UseSpeechRecognition {
  supported: boolean;
  listening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string;
  start: () => void;
  stop: () => void;
  reset: () => void;
  setTranscript: (s: string) => void;
}

export function useSpeechRecognition(): UseSpeechRecognition {
  const supported = isSpeechRecognitionSupported();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  // Track whether the user wants to keep listening (for auto-restart).
  const wantListenRef = useRef(false);

  const start = useCallback(() => {
    if (!supported) {
      setError("Speech recognition not supported on this browser.");
      return;
    }
    setError("");
    finalRef.current = "";
    setTranscript("");
    setInterimTranscript("");
    wantListenRef.current = true;
    startSession();
  }, [supported]);

  const startSession = useCallback(() => {
    if (!wantListenRef.current) return;
    const Ctor = getCtor()!;
    // Stop any existing recognition instance.
    if (recRef.current) {
      try { recRef.current.abort(); } catch {}
      recRef.current = null;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    // continuous: false — each session handles ONE phrase.
    // This avoids the cumulative interim result duplication that
    // happens with continuous: true in Chrome.
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      // With continuous: false, e.results has a single entry that
      // gets updated as the phrase is recognized. Take the last result.
      const lastIdx = e.results.length - 1;
      if (lastIdx < 0) return;
      const r = e.results[lastIdx];
      if (r.isFinal) {
        finalRef.current += r[0].transcript;
        setTranscript(finalRef.current);
        setInterimTranscript("");
      } else {
        setInterimTranscript(r[0].transcript);
      }
    };
    rec.onerror = (e: any) => {
      if (e?.error === "no-speech" || e?.error === "aborted") {
        // These are benign — just restart.
        return;
      }
      setError(e?.error ?? "speech error");
      wantListenRef.current = false;
      setListening(false);
    };
    rec.onend = () => {
      // Auto-restart if the user still wants to listen (continuous: false
      // ends after each phrase, so we restart for the next one).
      if (wantListenRef.current) {
        try {
          rec.start();
        } catch {
          // If restart fails (e.g., too rapid), stop.
          wantListenRef.current = false;
          setListening(false);
        }
      } else {
        setListening(false);
        setInterimTranscript("");
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (e: any) {
      setError(e?.message ?? "failed to start");
      wantListenRef.current = false;
    }
  }, []);

  const stop = useCallback(() => {
    wantListenRef.current = false;
    try { recRef.current?.stop(); } catch {}
    setListening(false);
    setInterimTranscript("");
  }, []);

  const reset = useCallback(() => {
    finalRef.current = "";
    setTranscript("");
    setInterimTranscript("");
    setError("");
  }, []);

  useEffect(() => {
    return () => {
      wantListenRef.current = false;
      try { recRef.current?.abort(); } catch {}
    };
  }, []);

  return {
    supported,
    listening,
    transcript,
    interimTranscript,
    error,
    start,
    stop,
    reset,
    setTranscript,
  };
}
