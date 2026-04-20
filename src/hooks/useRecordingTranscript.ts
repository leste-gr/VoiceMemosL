import { useRef, useCallback } from 'react';

const API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '';
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export type TranscriptCommand = 'stopRecording' | 'pause' | 'resume';

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

  const processSegment = useCallback((uri: string): Promise<string> => {
    const p = doTranscribe(uri, transcriptRef, onCommandRef);
    pendingRef.current.push(p);
    return p;
  }, []);

  /** Wait for all in-flight Groq calls to settle before saving. */
  const waitForPending = useCallback(async () => {
    await Promise.allSettled(pendingRef.current);
    pendingRef.current = [];
  }, []);

  const reset = useCallback(() => {
    transcriptRef.current = '';
    pendingRef.current = [];
  }, []);

  const getTranscript = useCallback(() => transcriptRef.current, []);

  return { processSegment, waitForPending, reset, getTranscript };
}

async function doTranscribe(
  uri: string,
  transcriptRef: React.MutableRefObject<string>,
  onCommandRef: React.MutableRefObject<OnCommand>,
): Promise<string> {
  try {
    const formData = new FormData();
    formData.append('file', { uri, type: 'audio/m4a', name: 'audio.m4a' } as unknown as Blob);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'json');
    formData.append('language', 'en');

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
  return text.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectCommand(text: string): TranscriptCommand | null {
  if (hasPhrase(text, ['stop recording', 'end recording', 'finish recording'])) return 'stopRecording';
  if (text === 'stop' || text === 'end' || text === 'finish') return 'stopRecording';
  if (hasPhrase(text, ['pause recording'])) return 'pause';
  if (text === 'pause') return 'pause';
  if (hasPhrase(text, ['resume recording', 'continue recording', 'unpause'])) return 'resume';
  if (text === 'resume' || text === 'continue') return 'resume';
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
