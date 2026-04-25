import { useState, useRef, useCallback } from 'react';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { Recording } from '../types/Recording';

export type PlayerState = 'idle' | 'playing' | 'paused';

// AAC-in-m4a chunks usually contain tiny encoder delay/padding at boundaries.
// Skipping a small amount at the start of non-first segments makes transitions
// sound continuous without affecting intelligible speech.
const PRELOAD_WINDOW_MS = 3000;
const EARLY_SWITCH_MS = 140;
const CHUNK_LEADING_TRIM_MS = 35;

function segmentStartTrimMs(index: number): number {
  return index > 0 ? CHUNK_LEADING_TRIM_MS : 0;
}

export function useAudioPlayer() {
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const soundRef = useRef<Audio.Sound | null>(null);
  // Preloaded next segment to eliminate the gap at segment boundaries
  const nextSoundRef = useRef<Audio.Sound | null>(null);
  const preloadingIndexRef = useRef(-1);

  const segmentUrisRef = useRef<string[]>([]);
  const segmentIndexRef = useRef(0);
  const segmentOffsetRef = useRef(0);
  const totalDurationRef = useRef(0);
  const isPlayingRef = useRef(false);
  const preloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Forward refs to break circular useCallback dependencies
  const loadSegmentRef = useRef<(index: number, autoPlay: boolean) => Promise<void>>(async () => {});
  const makeCallbackRef = useRef<(segIndex: number) => (status: AVPlaybackStatus) => void>(() => () => {});

  // ── Preload ──────────────────────────────────────────────────────────────
  const preloadNext = useCallback((nextIndex: number) => {
    if (preloadingIndexRef.current === nextIndex) return;
    const uri = segmentUrisRef.current[nextIndex];
    if (!uri) return;
    preloadingIndexRef.current = nextIndex;
    Audio.Sound.createAsync(
      { uri },
      { shouldPlay: false, volume: 1.0, positionMillis: segmentStartTrimMs(nextIndex) },
    )
      .then(({ sound }) => {
        if (preloadingIndexRef.current === nextIndex) {
          nextSoundRef.current?.unloadAsync().catch(() => {});
          nextSoundRef.current = sound;
        } else {
          sound.unloadAsync().catch(() => {});
        }
      })
      .catch(() => {
        if (preloadingIndexRef.current === nextIndex) preloadingIndexRef.current = -1;
      });
  }, []);

  const schedulePreload = useCallback((nextIndex: number) => {
    if (preloadTimerRef.current) {
      clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
    // Delay a bit so decode work does not coincide with boundary handoff.
    preloadTimerRef.current = setTimeout(() => {
      preloadNext(nextIndex);
      preloadTimerRef.current = null;
    }, 250);
  }, [preloadNext]);

  // ── Advance to next segment (called from status callback) ────────────────
  const advanceToNext = useCallback((completedIndex: number, segDur: number) => {
    const nextIndex = completedIndex + 1;
    const nextOffset = segmentOffsetRef.current + segDur;
    const prevSound = soundRef.current;

    if (!segmentUrisRef.current[nextIndex]) {
      // End of recording
      prevSound?.unloadAsync().catch(() => {});
      soundRef.current = null;
      nextSoundRef.current?.unloadAsync().catch(() => {});
      nextSoundRef.current = null;
      preloadingIndexRef.current = -1;
      segmentOffsetRef.current = nextOffset;
      segmentIndexRef.current = nextIndex;
      setPlayerState('idle');
      isPlayingRef.current = false;
      return;
    }

    segmentOffsetRef.current = nextOffset;
    segmentIndexRef.current = nextIndex;

    if (nextSoundRef.current) {
      // Preloaded — start next immediately, then unload previous a bit later.
      const sound = nextSoundRef.current;
      nextSoundRef.current = null;
      preloadingIndexRef.current = -1;
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate(makeCallbackRef.current!(nextIndex));
      sound.playAsync().catch(() => {});
      prevSound?.unloadAsync().catch(() => {});
      schedulePreload(nextIndex + 1);
    } else {
      // Fallback: load normally
      prevSound?.unloadAsync().catch(() => {});
      soundRef.current = null;
      loadSegmentRef.current?.(nextIndex, true);
    }
  }, [schedulePreload]);

  // ── Status callback factory ──────────────────────────────────────────────
  // advancedRef prevents double-advance if both the <50ms trigger and
  // didJustFinish fire for the same segment.
  const advancedSegRef = useRef(-1);

  makeCallbackRef.current = (segIndex: number) => (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    const posAdjusted = Math.max(0, status.positionMillis - segmentStartTrimMs(segIndex));
    setCurrentTime(segmentOffsetRef.current + posAdjusted / 1000);

    // Start preloading next segment when within the configured window.
    const remaining = (status.durationMillis ?? 0) - status.positionMillis;
    if (remaining > 0 && remaining < PRELOAD_WINDOW_MS) {
      preloadNext(segIndex + 1);
    }

    // Trigger advance ~50 ms before end (if preloaded) to hide the JS bridge
    // roundtrip that would otherwise appear as silence between segments.
    if (
      remaining > 0 &&
      remaining < EARLY_SWITCH_MS &&
      isPlayingRef.current &&
      nextSoundRef.current &&
      advancedSegRef.current !== segIndex
    ) {
      advancedSegRef.current = segIndex;
      advanceToNext(segIndex, (status.durationMillis ?? 0) / 1000);
      return;
    }

    if (status.didJustFinish && isPlayingRef.current && advancedSegRef.current !== segIndex) {
      advancedSegRef.current = segIndex;
      advanceToNext(segIndex, (status.durationMillis ?? 0) / 1000);
    }
  };

  // ── Load a segment from scratch ──────────────────────────────────────────
  const loadSegment = useCallback(async (index: number, autoPlay: boolean) => {
    const uri = segmentUrisRef.current[index];
    if (!uri) {
      setPlayerState('idle');
      isPlayingRef.current = false;
      return;
    }

    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      {
        shouldPlay: autoPlay,
        volume: 1.0,
        positionMillis: segmentStartTrimMs(index),
      },
      makeCallbackRef.current!(index),
    );
    soundRef.current = sound;
    if (autoPlay) {
      setPlayerState('playing');
      schedulePreload(index + 1);
    }
  }, [schedulePreload]);

  loadSegmentRef.current = loadSegment;

  // ── Public API ───────────────────────────────────────────────────────────

  const load = useCallback(async (recording: Recording) => {
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    nextSoundRef.current?.unloadAsync().catch(() => {});
    nextSoundRef.current = null;
    preloadingIndexRef.current = -1;
    advancedSegRef.current = -1;
    if (preloadTimerRef.current) {
      clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }

    // Ensure playback mode so iOS routes to speaker/headphones (not earpiece)
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });

    const uris = recording.segmentUris?.length ? recording.segmentUris : [recording.fileUri];
    segmentUrisRef.current = uris;
    segmentIndexRef.current = 0;
    segmentOffsetRef.current = 0;
    totalDurationRef.current = recording.duration;
    isPlayingRef.current = false;

    setDuration(recording.duration);
    setCurrentTime(0);
    setPlayerState('idle');

    await loadSegment(0, false);
  }, [loadSegment]);

  const play = useCallback(async () => {
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    isPlayingRef.current = true;
    await soundRef.current?.playAsync();
    setPlayerState('playing');
    schedulePreload(segmentIndexRef.current + 1);
  }, [schedulePreload]);

  const pause = useCallback(async () => {
    isPlayingRef.current = false;
    await soundRef.current?.pauseAsync();
    setPlayerState('paused');
  }, []);

  const seek = useCallback(async (targetSeconds: number) => {
    const uris = segmentUrisRef.current;
    if (!uris.length) return;

    const total = totalDurationRef.current;
    const approxSegDur = total / uris.length;

    let idx = 0;
    let offset = 0;
    while (idx < uris.length - 1 && offset + approxSegDur < targetSeconds) {
      offset += approxSegDur;
      idx += 1;
    }

    const posWithinSeg = Math.max(0, targetSeconds - offset);
    const wasPlaying = isPlayingRef.current;

    // Discard preloaded segment — it may be the wrong index after seek
    nextSoundRef.current?.unloadAsync().catch(() => {});
    nextSoundRef.current = null;
    preloadingIndexRef.current = -1;
    if (preloadTimerRef.current) {
      clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
    advancedSegRef.current = -1;

    if (idx !== segmentIndexRef.current) {
      segmentIndexRef.current = idx;
      segmentOffsetRef.current = offset;
      await loadSegment(idx, false);
    }

    const targetMs = posWithinSeg * 1000 + segmentStartTrimMs(idx);
    await soundRef.current?.setPositionAsync(targetMs);
    setCurrentTime(offset + posWithinSeg);

    if (wasPlaying) {
      await soundRef.current?.playAsync();
      schedulePreload(idx + 1);
    }
  }, [loadSegment, schedulePreload]);

  const unload = useCallback(async () => {
    isPlayingRef.current = false;
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    nextSoundRef.current?.unloadAsync().catch(() => {});
    nextSoundRef.current = null;
    preloadingIndexRef.current = -1;
    advancedSegRef.current = -1;
    if (preloadTimerRef.current) {
      clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
    segmentUrisRef.current = [];
    segmentIndexRef.current = 0;
    segmentOffsetRef.current = 0;
    setPlayerState('idle');
    setCurrentTime(0);
    setDuration(0);
  }, []);

  return { playerState, currentTime, duration, load, play, pause, seek, unload };
}
