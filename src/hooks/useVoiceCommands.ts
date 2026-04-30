import { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';

const API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '';
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const CHUNK_MS = 4000;

/**
 * Listens for a voice command to start recording when idle.
 */
export function useVoiceCommands(
  onStartCommand: () => void,
  activeStart: boolean,
  onExportLatestToNoteCommand?: () => void,
) {
  const loopRef = useRef(false);
  const onStartRef = useRef(onStartCommand);
  const onExportLatestToNoteRef = useRef(onExportLatestToNoteCommand);
  onStartRef.current = onStartCommand;
  onExportLatestToNoteRef.current = onExportLatestToNoteCommand;

  const active = activeStart;

  useEffect(() => {
    if (!active) {
      loopRef.current = false;
      return;
    }

    let cancelled = false;

    (async () => {
      loopRef.current = true;
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

      if (isStartCommand(text)) {
        console.log('[VoiceCmd] start command detected:', JSON.stringify(text));
        loopRef.current = false;
        onStartRef.current();
        return;
      }

      if (onExportLatestToNoteRef.current && isExportLatestToNoteCommand(text)) {
        console.log('[VoiceCmd] export command detected:', JSON.stringify(text));
        onExportLatestToNoteRef.current();
      }
    } catch (e) {
      console.warn('[VoiceCmd] chunk error:', e);
      if (recording) {
        try { await recording.stopAndUnloadAsync(); } catch {}
      }
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
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
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

function isExportLatestToNoteCommand(raw: string): boolean {
  const text = normalize(raw);
  return hasPhrase(text, [
    'export recording',
    'export the recording',
    'save recording',
    'save the recording',
    'export latest recording to note',
    'export latest recording to notes',
    'save latest recording to note',
    'save latest recording to notes',
  ]);
}


