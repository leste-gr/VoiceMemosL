import { useState, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';

export type RecorderState = 'idle' | 'recording' | 'paused';

/** Called each time a 5-second segment is completed with its actual file URI. */
type OnSegment = (uri: string, segDuration: number) => void;

const RECORDING_OPTIONS: Audio.RecordingOptions = {
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
};

const SEGMENT_MS = 5000;

export function useAudioRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [metering, setMetering] = useState(-160);

  const recorderRef = useRef<Audio.Recording | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalElapsedRef = useRef(0);      // completed segments total
  const pauseElapsedRef = useRef(0);      // elapsed at moment of pause
  const segStartRef = useRef(0);          // wall-clock when segment/resume started
  const segElapsedRef = useRef(0);        // elapsed within current segment before last start

  const onSegmentRef = useRef<OnSegment | null>(null);
  const activeRef = useRef(false);
  const pausedRef = useRef(false);
  const segmentUrisRef = useRef<string[]>([]);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const startElapsedTimer = useCallback(() => {
    segStartRef.current = Date.now();
    elapsedTimerRef.current = setInterval(async () => {
      const segNow = segElapsedRef.current + (Date.now() - segStartRef.current) / 1000;
      setElapsed(totalElapsedRef.current + segNow);
      const status = await recorderRef.current?.getStatusAsync();
      if (status?.isRecording) setMetering(status.metering ?? -160);
    }, 100);
  }, []);

  // Forward declaration for mutual recursion
  const rotateSegmentRef = useRef<(() => Promise<void>) | null>(null);

  /** Start a new segment recording. */
  const startSegment = useCallback(async () => {
    if (!activeRef.current) return;
    segElapsedRef.current = 0;

    const { recording } = await Audio.Recording.createAsync(
      RECORDING_OPTIONS,
      undefined,
      100,
    );
    recorderRef.current = recording;
    startElapsedTimer();

    // Auto-rotate after SEGMENT_MS
    segmentTimerRef.current = setTimeout(() => {
      if (!activeRef.current || pausedRef.current) return;
      rotateSegmentRef.current?.();
    }, SEGMENT_MS);
  }, [startElapsedTimer]);

  /** Stop current segment, emit callback with real URI, start the next one. */
  const rotateSegment = useCallback(async () => {
    if (!recorderRef.current) return;

    clearTimeout(segmentTimerRef.current!);
    segmentTimerRef.current = null;
    stopElapsedTimer();

    const rec = recorderRef.current;
    recorderRef.current = null;
    const segDuration = segElapsedRef.current + (Date.now() - segStartRef.current) / 1000;
    totalElapsedRef.current += segDuration;

    await rec.stopAndUnloadAsync();
    const uri = rec.getURI();
    if (uri) {
      segmentUrisRef.current.push(uri);
      onSegmentRef.current?.(uri, segDuration);
    }

    await startSegment();
  }, [stopElapsedTimer, startSegment]);

  // Keep ref in sync
  rotateSegmentRef.current = rotateSegment;

  const start = useCallback(async (onSegment: OnSegment) => {
    await Audio.requestPermissionsAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

    activeRef.current = true;
    pausedRef.current = false;
    onSegmentRef.current = onSegment;
    segmentUrisRef.current = [];
    totalElapsedRef.current = 0;
    segElapsedRef.current = 0;
    setElapsed(0);
    setMetering(-160);
    setState('recording');

    await startSegment();
  }, [startSegment]);

  const pause = useCallback(async () => {
    if (state !== 'recording' || !recorderRef.current) return;
    clearTimeout(segmentTimerRef.current!);
    segmentTimerRef.current = null;
    stopElapsedTimer();
    pauseElapsedRef.current = segElapsedRef.current + (Date.now() - segStartRef.current) / 1000;
    await recorderRef.current.pauseAsync();
    pausedRef.current = true;
    setState('paused');
  }, [state, stopElapsedTimer]);

  const resume = useCallback(async () => {
    if (state !== 'paused' || !recorderRef.current) return;
    segElapsedRef.current = pauseElapsedRef.current;
    await recorderRef.current.startAsync();
    pausedRef.current = false;
    setState('recording');
    startElapsedTimer();
    const remaining = SEGMENT_MS - pauseElapsedRef.current * 1000;
    segmentTimerRef.current = setTimeout(() => {
      if (!activeRef.current || pausedRef.current) return;
      rotateSegmentRef.current?.();
    }, Math.max(remaining, 500));
  }, [state, startElapsedTimer]);

  /**
   * Stop recording. Emits the final segment via onSegment, then returns
   * all segment URIs and total duration.
   */
  const stop = useCallback(async (): Promise<{ segmentUris: string[]; duration: number }> => {
    activeRef.current = false;
    clearTimeout(segmentTimerRef.current!);
    segmentTimerRef.current = null;
    stopElapsedTimer();

    const rec = recorderRef.current;
    recorderRef.current = null;

    let finalDuration = totalElapsedRef.current;

    if (rec) {
      const segDuration = segElapsedRef.current + (Date.now() - segStartRef.current) / 1000;
      finalDuration += segDuration;
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      if (uri) {
        segmentUrisRef.current.push(uri);
        onSegmentRef.current?.(uri, segDuration);
      }
    }

    const uris = [...segmentUrisRef.current];
    segmentUrisRef.current = [];
    totalElapsedRef.current = 0;
    setElapsed(0);
    setMetering(-160);
    setState('idle');

    return { segmentUris: uris, duration: finalDuration };
  }, [stopElapsedTimer]);

  return { state, elapsed, metering, start, pause, resume, stop };
}

export function formatTitle(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}
