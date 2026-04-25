import { useEffect, useRef } from 'react';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

/**
 * Continuously listens for a "start recording" voice command using the
 * device's on-device speech recognizer (iOS SFSpeechRecognizer /
 * Android SpeechRecognizer). No Groq / network dependency.
 *
 * Uses non-continuous mode: the OS auto-stops after a few seconds of
 * silence, then we restart. This is reliable across all iOS versions.
 */
export function useVoiceCommands(
  onStartCommand: () => void,
  active: boolean,
) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const onStartRef = useRef(onStartCommand);
  onStartRef.current = onStartCommand;

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let triggered = false;
    const subs: { remove(): void }[] = [];

    subs.push(
      ExpoSpeechRecognitionModule.addListener('result', (event) => {
        if (triggered || cancelled) return;
        const text = (event.results[0]?.transcript ?? '').toLowerCase().trim();
        if (isStartCommand(text)) {
          triggered = true;
          ExpoSpeechRecognitionModule.abort();
          onStartRef.current();
        }
      }),
    );

    // After each session ends (silence / OS timeout), restart unless triggered.
    subs.push(
      ExpoSpeechRecognitionModule.addListener('end', () => {
        if (triggered || cancelled) return;
        setTimeout(() => {
          if (!triggered && !cancelled && activeRef.current) tryStart();
        }, 300);
      }),
    );

    function tryStart() {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        continuous: false,
        requiresOnDeviceRecognition: true,
        iosTaskHint: 'confirmation',
      });
    }

    ExpoSpeechRecognitionModule.requestPermissionsAsync().then((perm) => {
      if (perm.granted && !cancelled) tryStart();
    });

    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
      ExpoSpeechRecognitionModule.abort();
    };
  }, [active]);
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
    text === 'start' ||
    hasPhrase(text, ['start recording', 'start a recording', 'begin recording', 'new recording'])
  );
}