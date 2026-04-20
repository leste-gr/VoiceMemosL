import { useEffect, useRef } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

export type VoiceCommand =
  | 'startRecording'
  | 'stopRecording'
  | 'pause'
  | 'resume'
  | 'playLast';

type CommandHandler = (command: VoiceCommand) => void;

const START_OPTIONS = { lang: 'en-US', interimResults: false } as const;

/**
 * Continuously listens for hands-free voice commands.
 * Restarts automatically after each result or error so the app
 * stays responsive (important for driving use).
 *
 * Supported phrases:
 *   "record" / "start recording"
 *   "stop"   / "stop recording"
 *   "pause"  / "pause recording"
 *   "resume" / "resume recording"
 *   "play last" / "play last recording"
 */
export function useVoiceCommands(onCommand: CommandHandler) {
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  // Tracks whether this hook instance is still mounted
  const activeRef = useRef(false);

  // Classify and dispatch on final results
  useSpeechRecognitionEvent('result', (event) => {
    const results = event.results ?? [];
    results.some((r) => {
      const lower = r.transcript.toLowerCase().trim();
      const command = classify(lower);
      if (command) {
        onCommandRef.current(command);
        return true;
      }
      return false;
    });
  });

  // Restart when a session ends (covers normal end, no-speech timeout, errors)
  useSpeechRecognitionEvent('end', () => {
    if (!activeRef.current) return;
    setTimeout(() => {
      if (activeRef.current) {
        ExpoSpeechRecognitionModule.start(START_OPTIONS);
      }
    }, 300);
  });

  useEffect(() => {
    activeRef.current = true;

    ExpoSpeechRecognitionModule.requestPermissionsAsync().then(({ granted }) => {
      if (granted && activeRef.current) {
        ExpoSpeechRecognitionModule.start(START_OPTIONS);
      }
    });

    return () => {
      activeRef.current = false;
      ExpoSpeechRecognitionModule.abort();
    };
  }, []);
}

function classify(text: string): VoiceCommand | null {
  if (endsWith(text, ['start recording', 'record', 'start record'])) return 'startRecording';
  if (endsWith(text, ['stop recording', 'stop'])) return 'stopRecording';
  if (endsWith(text, ['pause recording', 'pause'])) return 'pause';
  if (endsWith(text, ['resume recording', 'resume'])) return 'resume';
  if (endsWith(text, ['play last recording', 'play last'])) return 'playLast';
  return null;
}

function endsWith(text: string, phrases: string[]): boolean {
  return phrases.some((p) => text === p || text.endsWith(' ' + p));
}
