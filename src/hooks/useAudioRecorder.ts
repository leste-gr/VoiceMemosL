import { useState, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import { Recording } from '../types/Recording';

export type RecorderState = 'idle' | 'recording' | 'paused';

export function useAudioRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [metering, setMetering] = useState(-160);

  const recorderRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedElapsedRef = useRef<number>(0);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(async () => {
      const now = Date.now();
      setElapsed(pausedElapsedRef.current + (now - startTimeRef.current) / 1000);
      const status = await recorderRef.current?.getStatusAsync();
      if (status?.isRecording) {
        setMetering(status.metering ?? -160);
      }
    }, 100);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(async (fileUri: string): Promise<void> => {
    await Audio.requestPermissionsAsync();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording } = await Audio.Recording.createAsync(
      {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        android: {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
        },
        ios: {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
        },
      },
      undefined,
      100
    );

    recorderRef.current = recording;
    pausedElapsedRef.current = 0;
    setElapsed(0);
    setState('recording');
    startTimer();
  }, [startTimer]);

  const pause = useCallback(async () => {
    if (state !== 'recording') return;
    await recorderRef.current?.pauseAsync();
    pausedElapsedRef.current = elapsed;
    stopTimer();
    setState('paused');
  }, [state, elapsed, stopTimer]);

  const resume = useCallback(async () => {
    if (state !== 'paused') return;
    await recorderRef.current?.startAsync();
    setState('recording');
    startTimer();
  }, [state, startTimer]);

  /** Stop recording and return a Recording object, or null on failure. */
  const stop = useCallback(async (addToStore: (r: Recording) => void): Promise<void> => {
    if (!recorderRef.current) return;
    stopTimer();

    const rec = recorderRef.current;
    recorderRef.current = null;

    await rec.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    const uri = rec.getURI();
    if (!uri) return;

    const duration = elapsed;
    const now = new Date();
    const title = formatTitle(now);

    addToStore({
      id: `${Date.now()}`,
      title,
      fileUri: uri,
      createdAt: now.toISOString(),
      duration,
    });

    setElapsed(0);
    setMetering(-160);
    pausedElapsedRef.current = 0;
    setState('idle');
  }, [elapsed, stopTimer]);

  return { state, elapsed, metering, start, pause, resume, stop };
}

function formatTitle(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}
