import { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';

const API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '';
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const CHUNK_MS = 4000;

/**
 * Listens for voice commands when idle or paused.
 * - When `activeStart` is true: listens for "start recording".
 * - When `activePaused` is true: listens for "resume recording".
 */
export function useVoiceCommands(
  onStartCommand: () => void,
  activeStart: boolean,
  onResumeCommand?: () => void,
  activePaused?: boolean,
) {
  const loopRef = useRef(false);
  const onStartRef = useRef(onStartCommand);
  onStartRef.current = onStartCommand;
  const onResumeRef = useRef(onResumeCommand);
  onResumeRef.current = onResumeCommand;

  const active = activeStart || !!activePaused;

  useEffect(() => {
    if (!active) {
      loopRef.current = false;
      return;
    }

    loopRef.current = true;
    let cancelled = false;

    (async () => {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      while (loopRef.current && !cancelled) {
        await runChunk();
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    })();

    return () => {
      cancelled = true;
      loopRef.current = false;
    };
  }, [active]);

  async function runChunk() {
    let recording: Audio.Recording | null = null;
    try {
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recording = rec;
      await new Promise<void>((resolve) => setTimeout(resolve, CHUNK_MS));
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) return;
      const text = await transcribe(uri);
      if (!text) return;
      if (activeStart && isStartCommand(text)) {
        console.log('[VoiceCmd] start command detected:', JSON.stringify(text));
        onStartRef.current();
        loopRef.current = false;
      } else if (activePaused && isResumeCommand(text)) {
        console.log('[VoiceCmd] resume command detected:', JSON.stringify(text));
        onResumeRef.current?.();
        loopRef.current = false;
      }
    } catch (e) {
      console.warn('[VoiceCmd] chunk error:', e);
      if (recording) {
        try { await recording.stopAndUnloadAsync(); } catch {}
      }
      // Brief pause before retry so we don't hammer on error
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function transcribe(uri: string): Promise<string> {
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
    if (!res.ok) return '';
    const json = await res.json();
    return (json.text ?? '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function normalize(text: string): string {
  return text.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
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

function isStartCommand(raw: string): boolean {
  const text = normalize(raw);
  if (text.split(' ').length > 6) return false;
  return (
    text === 'record' ||
    text === 'start recording' ||
    hasPhrase(text, ['start recording', 'start a recording', 'begin recording', 'new recording'])
  );
}

function isResumeCommand(raw: string): boolean {
  const text = normalize(raw);
  if (text.split(' ').length > 4) return false;
  return (
    text === 'resume recording' ||
    hasPhrase(text, ['resume recording', 'continue recording'])
  );
}
