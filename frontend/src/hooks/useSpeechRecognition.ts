import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (not in lib.dom.d.ts in all TS versions).
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

  const start = useCallback(() => {
    if (!supported) {
      setError("Speech recognition not supported on this browser.");
      return;
    }
    setError("");
    const Ctor = getCtor()!;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      // Rebuild final + interim from ALL results each time.
      // Do NOT accumulate — Chrome fires onresult with resultIndex=0
      // on every event with continuous:true, so accumulating would
      // duplicate final segments on every fire.
      let final = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          final += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      finalRef.current = final;
      setTranscript(final);
      setInterimTranscript(interim);
    };
    rec.onerror = (e: any) => {
      setError(e?.error ?? "speech error");
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterimTranscript("");
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (e: any) {
      setError(e?.message ?? "failed to start");
    }
  }, [supported]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const reset = useCallback(() => {
    finalRef.current = "";
    setTranscript("");
    setInterimTranscript("");
    setError("");
  }, []);

  useEffect(() => {
    return () => {
      recRef.current?.abort();
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
