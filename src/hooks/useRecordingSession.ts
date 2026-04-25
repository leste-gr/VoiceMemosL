import { useState, useRef, useCallback } from 'react';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { SpeechLocale } from './useVoiceCommands';

export type RecordingSessionState = 'idle' | 'recording';

export interface RecordingSessionResult {
  segmentUris: string[];
  duration: number;
  transcript: string;
}

/**
 * Simultaneously records audio and transcribes speech using the device's
 * on-board speech recognizer (iOS SFSpeechRecognizer). No Groq / network
 * dependency for STT.
 *
 * The recognizer runs with recordingOptions.persist = true, so each session
 * produces a local audio file. If the OS ends the session before stop() is
 * called (e.g. iOS ~60 s limit or silence timeout), it restarts automatically
 * and the per-session audio files are collected as segments — compatible with
 * the existing useAudioPlayer multi-segment playback.
 *
 * Language: change TRANSCRIPT_LANG to the locale you want. Defaults to Greek
 * (el-GR). Pass requiresOnDeviceRecognition: false to allow Apple / Google
 * network STT for better accuracy on low-end devices.
 */

export function useRecordingSession(transcriptLang: SpeechLocale = 'el-GR') {
  const [state, setState] = useState<RecordingSessionState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');

  // ── Internal mutable refs (never stale in callbacks) ────────────────────
  const stateRef = useRef<RecordingSessionState>('idle');
  const committedRef = useRef('');        // final speech results only
  const segmentUrisRef = useRef<string[]>([]);
  const currentUriRef = useRef<string | null>(null);
  const startTimeRef = useRef(0);
  const isStoppingRef = useRef(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subsRef = useRef<{ remove(): void }[]>([]);
  const resolveStopRef = useRef<((r: RecordingSessionResult) => void) | null>(null);
  const onStopCommandRef = useRef<(() => void) | undefined>(undefined);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const cleanupSubs = () => {
    subsRef.current.forEach((s) => s.remove());
    subsRef.current = [];
  };

  const finalize = useCallback(() => {
    if (stateRef.current !== 'recording') return;
    stateRef.current = 'idle';
    cleanupSubs();

    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }

    // Capture the last audio segment
    if (currentUriRef.current && !segmentUrisRef.current.includes(currentUriRef.current)) {
      segmentUrisRef.current.push(currentUriRef.current);
    }

    const duration = (Date.now() - startTimeRef.current) / 1000;
    const result: RecordingSessionResult = {
      segmentUris: [...segmentUrisRef.current],
      duration,
      transcript: committedRef.current,
    };

    setState('idle');
    setElapsed(0);
    setLiveTranscript('');

    resolveStopRef.current?.(result);
    resolveStopRef.current = null;
  }, []);

  const startInnerSession = useCallback(() => {
    ExpoSpeechRecognitionModule.start({
      lang: transcriptLang,
      interimResults: true,
      continuous: true,
      // Allow network fallback for transcription to ensure both EN/EL work reliably
      requiresOnDeviceRecognition: false,
      addsPunctuation: true,
      iosTaskHint: 'dictation',
      recordingOptions: { persist: true },
    });
  }, [transcriptLang]);

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Start a recording session.
   * @param onStopCommand  Optional callback fired when a stop phrase is
   *   detected in the live transcript. Caller is responsible for calling stop().
   */
  const start = useCallback((onStopCommand?: () => void) => {
    if (stateRef.current !== 'idle') return;

    stateRef.current = 'recording';
    committedRef.current = '';
    segmentUrisRef.current = [];
    currentUriRef.current = null;
    isStoppingRef.current = false;
    onStopCommandRef.current = onStopCommand;
    startTimeRef.current = Date.now();

    setState('recording');
    setElapsed(0);
    setLiveTranscript('');

    elapsedTimerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    const subs: { remove(): void }[] = [];

    // ── Result events (live transcript + stop command detection) ───────────
    subs.push(
      ExpoSpeechRecognitionModule.addListener('result', (event) => {
        if (stateRef.current !== 'recording') return;

        const text = (event.results[0]?.transcript ?? '').trim();

        if (event.isFinal) {
          const updated = committedRef.current
            ? committedRef.current + ' ' + text
            : text;
          committedRef.current = updated;
          setLiveTranscript(updated);

          if (isStopCommand(text)) onStopCommandRef.current?.();
        } else {
          // Interim — show but don't commit
          const preview = committedRef.current
            ? committedRef.current + ' ' + text
            : text;
          setLiveTranscript(preview);
          // Check interim too for faster response
          if (isStopCommand(text)) onStopCommandRef.current?.();
        }
      }),
    );

    // ── Audio file URI (produced when recognizer session ends) ─────────────
    subs.push(
      ExpoSpeechRecognitionModule.addListener('audioend', (event) => {
        if (event.uri) currentUriRef.current = event.uri;
      }),
    );

    // ── Session end ────────────────────────────────────────────────────────
    subs.push(
      ExpoSpeechRecognitionModule.addListener('end', () => {
        if (stateRef.current !== 'recording') return;

        if (isStoppingRef.current) {
          finalize();
        } else {
          // Unexpected end (silence timeout, ~60 s iOS limit, etc.)
          // Save current segment and restart a new session.
          if (currentUriRef.current && !segmentUrisRef.current.includes(currentUriRef.current)) {
            segmentUrisRef.current.push(currentUriRef.current);
            currentUriRef.current = null;
          }
          setTimeout(() => {
            if (stateRef.current === 'recording' && !isStoppingRef.current) {
              startInnerSession();
            }
          }, 200);
        }
      }),
    );

    // ── Errors (log only; 'end' always fires after, handling restart/finalize) ──
    subs.push(
      ExpoSpeechRecognitionModule.addListener('error', (event) => {
        console.warn('[RecordingSession] error:', event.error, event.message);
      }),
    );

    subsRef.current = subs;
    startInnerSession();
  }, [startInnerSession, finalize]);

  /**
   * Stop the recording session.
   * Returns a promise that resolves with the collected audio segments,
   * duration, and accumulated transcript once the recognizer has shut down.
   */
  const stop = useCallback((): Promise<RecordingSessionResult> => {
    if (stateRef.current !== 'recording') {
      return Promise.resolve({ segmentUris: [], duration: 0, transcript: '' });
    }

    isStoppingRef.current = true;

    return new Promise((resolve) => {
      resolveStopRef.current = resolve;
      ExpoSpeechRecognitionModule.stop();
      // Safety net: finalize after 5 s if 'end' never fires
      setTimeout(() => {
        if (stateRef.current === 'recording') finalize();
      }, 5000);
    });
  }, [finalize]);

  return { state, elapsed, liveTranscript, start, stop };
}

// ── Stop command detection ────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const STOP_PHRASES = [
  // English
  'stop recording', 'stop the recording', 'end recording', 'finish recording',
  // Greek
  'σταμάτα εγγραφή', 'σταμάτα την εγγραφή', 'τέλος εγγραφής',
  'σταμάτησε εγγραφή', 'σταμάτησε την εγγραφή',
];

function hasPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((p) => {
    const idx = text.indexOf(p);
    if (idx === -1) return false;
    const before = idx === 0 || text[idx - 1] === ' ';
    const after = idx + p.length === text.length || text[idx + p.length] === ' ';
    return before && after;
  });
}

export function isStopCommand(raw: string): boolean {
  const text = normalize(raw);
  return hasPhrase(text, STOP_PHRASES) || STOP_PHRASES.includes(text);
}
