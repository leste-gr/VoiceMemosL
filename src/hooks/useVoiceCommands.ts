import { useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';

export type IdleEngine = 'vosk' | 'groq' | 'none';

const API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '';
const VOSK_MODEL = process.env.EXPO_PUBLIC_VOSK_MODEL ?? 'model-en-us';
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
  const [idleEngine, setIdleEngine] = useState<IdleEngine>('none');
  const loopRef = useRef(false);
  const voskRef = useRef<any>(null);
  const voskListenersRef = useRef<Array<{ remove: () => void }>>([]);
  const onStartRef = useRef(onStartCommand);
  const onExportLatestToNoteRef = useRef(onExportLatestToNoteCommand);
  onStartRef.current = onStartCommand;
  onExportLatestToNoteRef.current = onExportLatestToNoteCommand;

  const active = activeStart;

  useEffect(() => {
    if (!active) {
      loopRef.current = false;
      stopVosk();
      setIdleEngine('none');
      return;
    }

    let cancelled = false;

    (async () => {
      const startedWithVosk = await startVosk(cancelled);
      if (cancelled) return;
      if (startedWithVosk) {
        setIdleEngine('vosk');
        return;
      }

      loopRef.current = true;
      setIdleEngine('groq');
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
      stopVosk();
      setIdleEngine('none');
    };
  }, [active]);

  async function startVosk(cancelled: boolean): Promise<boolean> {
    try {
      const voskModule = require('react-native-vosk');
      const Vosk = voskModule.default ?? voskModule;
      if (!Vosk) return false;

      const vosk = new Vosk();
      await vosk.loadModel(VOSK_MODEL);

      const handlePhrase = (raw: string) => {
        if (cancelled) return;
        const text = normalize(raw ?? '');
        if (!text) return;

        if (isStartCommand(text)) {
          console.log('[VoiceCmd] start command detected (vosk):', JSON.stringify(text));
          stopVosk();
          onStartRef.current();
          return;
        }

        if (onExportLatestToNoteRef.current && isExportLatestToNoteCommand(text)) {
          console.log('[VoiceCmd] export command detected (vosk):', JSON.stringify(text));
          onExportLatestToNoteRef.current();
        }
      };

      voskListenersRef.current = [
        vosk.onResult(handlePhrase),
        vosk.onFinalResult(handlePhrase),
        vosk.onError((err: unknown) => {
          console.warn('[VoiceCmd] Vosk runtime error:', err);
        }),
      ].filter(Boolean);

      const grammar = [
        'record',
        'start recording',
        'start a recording',
        'begin recording',
        'new recording',
        'export recording',
        'export the recording',
        'save recording',
        'save the recording',
        'export latest recording to note',
        'export latest recording to notes',
        'save latest recording to note',
        'save latest recording to notes',
        '[unk]',
      ];

      await vosk.start({ grammar });
      voskRef.current = vosk;
      console.log('[VoiceCmd] Vosk idle listener active');
      return true;
    } catch (e) {
      console.warn('[VoiceCmd] Vosk unavailable; using Groq fallback:', e);
      stopVosk();
      return false;
    }
  }

  function stopVosk() {
    for (const sub of voskListenersRef.current) {
      try { sub.remove(); } catch {}
    }
    voskListenersRef.current = [];

    if (voskRef.current) {
      try { voskRef.current.stop(); } catch {}
      try { voskRef.current.unload(); } catch {}
      voskRef.current = null;
    }
  }

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

  return { idleEngine };
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


