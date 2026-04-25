import { useRef, useCallback } from 'react';

const API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '';
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export type TranscriptCommand = 'stopRecording';

type OnCommand = (cmd: TranscriptCommand) => void;

/**
 * Sends a completed audio segment to Groq Whisper, accumulates the
 * transcript, and fires onCommand when a control phrase is detected.
 *
 * Usage: call processSegment(uri) from the onSegment callback of
 * useAudioRecorder. The returned transcript accumulates across all segments.
 */
export function useRecordingTranscript(onCommand: OnCommand) {
  const transcriptRef = useRef('');
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const pendingRef = useRef<Promise<string>[]>([]);
  // When reset() is called, mark as disabled so any in-flight Groq calls
  // that settle afterwards do not append to the transcript or fire commands.
  const activeRef = useRef(true);

  const processSegment = useCallback((uri: string): Promise<string> => {
    const p = doTranscribe(uri, transcriptRef, onCommandRef, activeRef);
    pendingRef.current.push(p);
    return p;
  }, []);

  /** Wait for all in-flight Groq calls to settle before saving. */
  const waitForPending = useCallback(async () => {
    await Promise.allSettled(pendingRef.current);
    pendingRef.current = [];
  }, []);

  const reset = useCallback(() => {
    activeRef.current = false;   // discards any still-pending Groq responses
    transcriptRef.current = '';
    pendingRef.current = [];
  }, []);

  /** Call this before starting a new recording session to re-enable the hook. */
  const enable = useCallback(() => {
    activeRef.current = true;
  }, []);

  const getTranscript = useCallback(() => transcriptRef.current, []);

  return { processSegment, waitForPending, reset, enable, getTranscript };
}

async function doTranscribe(
  uri: string,
  transcriptRef: React.MutableRefObject<string>,
  onCommandRef: React.MutableRefObject<OnCommand>,
  activeRef: React.MutableRefObject<boolean>,
): Promise<string> {
  try {
    const formData = new FormData();
    formData.append('file', { uri, type: 'audio/m4a', name: 'audio.m4a' } as unknown as Blob);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'json');
    // No language param — Whisper auto-detects and transcribes in the spoken language.

    const res = await fetch(GROQ_STT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.status.toString());
      console.warn('[Transcript] Groq error:', res.status, err);
      return transcriptRef.current;
    }

    const json = await res.json();
    const chunk: string = (json.text ?? '').trim();
    console.log('[Transcript] chunk:', JSON.stringify(chunk));

    // If recording was stopped while this request was in-flight, discard it.
    if (!activeRef.current) return transcriptRef.current;

    if (chunk) {
      transcriptRef.current = transcriptRef.current
        ? transcriptRef.current + ' ' + chunk
        : chunk;

      const lower = normalize(chunk);
      const cmd = detectCommand(lower);
      if (cmd) {
        console.log('[Transcript] command detected:', cmd);
        onCommandRef.current(cmd);
      }
    }

    return transcriptRef.current;
  } catch (e) {
    console.warn('[Transcript] error:', e);
    return transcriptRef.current;
  }
}

function normalize(text: string): string {
  // Keep all Unicode letters/digits (including Greek) — only collapse punctuation/symbols to spaces.
  return text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const STOP_PHRASES = [
  // English
  'stop recording', 'stop the recording', 'end recording', 'finish recording',
  // Greek
  'σταμάτα εγγραφή', 'σταμάτα την εγγραφή', 'τέλος εγγραφής','σταμάτησε εγγραφή', 'σταμάτησε την εγγραφή',
];

function detectCommand(text: string): TranscriptCommand | null {
  if (hasPhrase(text, STOP_PHRASES)) return 'stopRecording';
  return null;
}

function hasPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((p) => {
    const idx = text.indexOf(p);
    if (idx === -1) return false;
    const before = idx === 0 || text[idx - 1] === ' ';
    const after = idx + p.length === text.length || text[idx + p.length] === ' ';
    return before && after;
  });
}
