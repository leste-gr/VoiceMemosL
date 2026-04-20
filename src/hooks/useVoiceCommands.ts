import { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';

const API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '';
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const CHUNK_MS = 4000;

/**
 * Listens for a "start recording" voice command when idle.
 * Only active when `active` is true (i.e. the recorder is idle).
 * Records short 4-second mic chunks → Groq → checks for start phrase.
 */
export function useVoiceCommands(
  onStartCommand: () => void,
  active: boolean,
) {
  const loopRef = useRef(false);
  const onStartRef = useRef(onStartCommand);
  onStartRef.current = onStartCommand;

  useEffect(() => {
    if (!active) {
      loopRef.current = false;
      return;
    }

    loopRef.current = true;
    let cancelled = false;

    (async () => {
      await Audio.requestPermissionsAsync();
      while (loopRef.current && !cancelled) {
        await runChunk();
      }
    })();

    return () => {
      cancelled = true;
      loopRef.current = false;
    };
  }, [active]);

  async function runChunk() {
    let recording: Audio.Recording | null = null;
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recording = rec;
      await new Promise<void>((resolve) => setTimeout(resolve, CHUNK_MS));
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      if (!uri) return;
      const text = await transcribe(uri);
      if (text && isStartCommand(text)) {
        console.log('[VoiceCmd] start command detected:', JSON.stringify(text));
        onStartRef.current();
        loopRef.current = false; // stop the loop once triggered
      }
    } catch (e) {
      console.warn('[VoiceCmd] chunk error:', e);
      if (recording) {
        try { await recording.stopAndUnloadAsync(); } catch {}
        try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
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
