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
  maxAlternatives: number;
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
  // Track the index of the last processed final result to avoid duplication.
  const lastFinalIdxRef = useRef(0);
  // Track whether the user wants to keep listening (for auto-restart).
  const wantListenRef = useRef(false);
  // Restart debounce — avoid hammering the API on rapid restarts.
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    if (!supported) {
      setError("Speech recognition not supported on this browser.");
      return;
    }
    setError("");
    finalRef.current = "";
    lastFinalIdxRef.current = 0;
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
    // continuous: true — keeps the session alive across pauses so the
    // user can think between sentences without the recognition cutting
    // off. Chrome will keep listening until we call stop() or a long
    // timeout (~60s of silence) fires.
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      // With continuous: true, e.results accumulates all phrases.
      // We process only results from resultIndex onwards (new ones).
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          // Only append final results we haven't seen yet.
          if (i >= lastFinalIdxRef.current) {
            finalRef.current += r[0].transcript;
            lastFinalIdxRef.current = i + 1;
          }
        } else {
          interim += r[0].transcript;
        }
      }
      setTranscript(finalRef.current);
      setInterimTranscript(interim);
    };
    rec.onerror = (e: any) => {
      if (e?.error === "no-speech" || e?.error === "aborted") {
        // "no-speech" fires after ~15s of silence in continuous mode.
        // This is benign — onend will fire and we'll restart.
        return;
      }
      if (e?.error === "network") {
        setError("Network error — speech recognition needs internet.");
        wantListenRef.current = false;
        setListening(false);
        return;
      }
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        setError("Microphone permission denied.");
        wantListenRef.current = false;
        setListening(false);
        return;
      }
      // Other errors — try to continue.
    };
    rec.onend = () => {
      // Auto-restart if the user still wants to listen.
      // In continuous mode, onend fires after:
      //   - ~60s of total silence (Chrome timeout)
      //   - "no-speech" error after ~15s silence
      //   - Network blips
      // We restart with a small debounce to avoid rapid restart loops.
      if (wantListenRef.current) {
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          if (!wantListenRef.current) return;
          try {
            rec.start();
          } catch {
            // If restart fails, try once more after a longer delay.
            restartTimerRef.current = setTimeout(() => {
              restartTimerRef.current = null;
              if (!wantListenRef.current) return;
              try { rec.start(); } catch {
                wantListenRef.current = false;
                setListening(false);
              }
            }, 1000);
          }
        }, 200);
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
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try { recRef.current?.stop(); } catch {}
    setListening(false);
    setInterimTranscript("");
  }, []);

  const reset = useCallback(() => {
    finalRef.current = "";
    lastFinalIdxRef.current = 0;
    setTranscript("");
    setInterimTranscript("");
    setError("");
  }, []);

  useEffect(() => {
    return () => {
      wantListenRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
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
