import { useEffect, useRef } from 'react';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

export type SpeechLocale = 'en-US' | 'el-GR';

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
  locale: SpeechLocale = 'en-US',
  onLanguageCommand?: (nextLocale: SpeechLocale) => void,
  onDebugText?: (text: string, status: string) => void,
) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const onStartRef = useRef(onStartCommand);
  onStartRef.current = onStartCommand;
  const onLanguageRef = useRef(onLanguageCommand);
  onLanguageRef.current = onLanguageCommand;
  const onDebugRef = useRef(onDebugText);
  onDebugRef.current = onDebugText;

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let triggered = false;
    const subs: { remove(): void }[] = [];

    subs.push(
      ExpoSpeechRecognitionModule.addListener('result', (event) => {
        if (triggered || cancelled) return;
        const text = (event.results[0]?.transcript ?? '').toLowerCase().trim();
        onDebugRef.current?.(text, 'result');

        const requestedLanguage = getLanguageCommand(text);
        if (requestedLanguage) {
          onLanguageRef.current?.(requestedLanguage);
          return;
        }

        if (isStartCommand(text, locale)) {
          triggered = true;
          onDebugRef.current?.(text, 'matched-start');
          ExpoSpeechRecognitionModule.abort();
          onStartRef.current();
        }
      }),
    );

    subs.push(
      ExpoSpeechRecognitionModule.addListener('error', (event) => {
        onDebugRef.current?.('', `error:${event.error}`);
      }),
    );

    subs.push(
      ExpoSpeechRecognitionModule.addListener('start', () => {
        onDebugRef.current?.('', 'listening');
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
        lang: locale,
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
  }, [active, locale]); // eslint-disable-line react-hooks/exhaustive-deps
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function isStartCommand(raw: string, locale: SpeechLocale = 'en-US'): boolean {
  const text = normalize(raw);
  if (text.split(' ').length > 6) return false;
  if (locale === 'el-GR') {
    return (
      text === 'εγγραφη' ||
      text === 'εναρξη' ||
      hasPhrase(text, ['ξεκινα εγγραφη', 'ξεκινα την εγγραφη', 'εναρξη εγγραφης'])
    );
  }

  return (
    text === 'record' ||
    text === 'start' ||
    hasPhrase(text, ['start recording', 'start a recording', 'begin recording', 'new recording'])
  );
}

function getLanguageCommand(raw: string): SpeechLocale | null {
  const text = normalize(raw);

  const englishPhrases = [
    'english',
    'switch to english',
    'set language to english',
    'speak english',
    'αγγλικα',
    'βαλε αγγλικα',
    'γλωσσα αγγλικα',
  ];

  const greekPhrases = [
    'greek',
    'switch to greek',
    'set language to greek',
    'speak greek',
    'ελληνικα',
    'βαλε ελληνικα',
    'γλωσσα ελληνικα',
  ];

  if (text === 'english' || hasPhrase(text, englishPhrases)) return 'en-US';
  if (text === 'greek' || hasPhrase(text, greekPhrases)) return 'el-GR';
  return null;
}