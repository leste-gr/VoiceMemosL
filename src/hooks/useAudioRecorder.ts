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
    // Use refs for the guard — never stale unlike React state
    if (pausedRef.current || !activeRef.current || !recorderRef.current) return;
    clearTimeout(segmentTimerRef.current!);
    segmentTimerRef.current = null;
    stopElapsedTimer();

    // Stop and save the current segment so we accumulate its duration
    const segDuration = segElapsedRef.current + (Date.now() - segStartRef.current) / 1000;
    totalElapsedRef.current += segDuration;

    const rec = recorderRef.current;
    recorderRef.current = null;
    await rec.stopAndUnloadAsync();
    const uri = rec.getURI();
    if (uri) {
      segmentUrisRef.current.push(uri);
      onSegmentRef.current?.(uri, segDuration);
    }

    // Release the audio session so the voice-command listener can use the mic
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}

    pausedRef.current = true;
    setState('paused');
  }, [stopElapsedTimer]);

  const resume = useCallback(async () => {
    // Use refs for the guard — never stale
    if (!pausedRef.current || !activeRef.current) return;

    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    pausedRef.current = false;
    segElapsedRef.current = 0;
    setState('recording');

    await startSegment();
  }, [startSegment]);

  /**
   * Stop recording. Emits the final segment via onSegment, then returns
   * all segment URIs and total duration.
   */
  const stop = useCallback(async (): Promise<{ segmentUris: string[]; duration: number }> => {
    console.log('[Recorder] stop() called, activeRef=', activeRef.current, 'recorderRef=', recorderRef.current ? 'exists' : 'null');
    // Set activeRef FIRST (sync) so startSegment bails even if rotateSegment
    // is mid-execution and about to call startSegment.
    activeRef.current = false;
    clearTimeout(segmentTimerRef.current!);
    segmentTimerRef.current = null;
    stopElapsedTimer();

    const rec = recorderRef.current;
    recorderRef.current = null;
    console.log('[Recorder] stop() rec=', rec ? 'exists' : 'null (race path)');

    let finalDuration = totalElapsedRef.current;

    if (rec) {
      // Normal path: we have the recorder.
      const segDuration = segElapsedRef.current + (Date.now() - segStartRef.current) / 1000;
      finalDuration += segDuration;
      try { await rec.stopAndUnloadAsync(); } catch {}
      const uri = rec.getURI();
      if (uri) {
        segmentUrisRef.current.push(uri);
        onSegmentRef.current?.(uri, segDuration);
      }
    } else {
      // Race path: rotateSegment grabbed the recorder before us and is currently
      // awaiting stopAndUnloadAsync. Give it time to finish and push its URI.
      // startSegment will not run because activeRef is already false.
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
    }

    // Always release the iOS audio session, regardless of which path ran above.
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}

    // Collect URIs now — rotateSegment (if it was running) has had time to push its URI.
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
