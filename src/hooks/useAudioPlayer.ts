import { useState, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import { Recording } from '../types/Recording';

export type PlayerState = 'idle' | 'playing' | 'paused';

export function useAudioPlayer() {
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const soundRef = useRef<Audio.Sound | null>(null);
  const segmentUrisRef = useRef<string[]>([]);
  const segmentIndexRef = useRef(0);
  const segmentOffsetRef = useRef(0); // elapsed seconds of all completed segments
  const totalDurationRef = useRef(0);
  const isPlayingRef = useRef(false);

  const unloadCurrent = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
  }, []);

  /** Load and (optionally) play a specific segment by index. */
  const loadSegment = useCallback(async (index: number, autoPlay: boolean) => {
    const uri = segmentUrisRef.current[index];
    if (!uri) {
      // No more segments — playback finished
      setPlayerState('idle');
      isPlayingRef.current = false;
      return;
    }

    await unloadCurrent();

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: autoPlay },
      (status) => {
        if (!status.isLoaded) return;
        const pos = segmentOffsetRef.current + status.positionMillis / 1000;
        setCurrentTime(pos);
        if (status.didJustFinish && isPlayingRef.current) {
          // Advance to the next segment
          const segDur = (status.durationMillis ?? 0) / 1000;
          segmentOffsetRef.current += segDur;
          segmentIndexRef.current += 1;
          loadSegment(segmentIndexRef.current, true);
        }
      },
    );

    soundRef.current = sound;
    if (autoPlay) setPlayerState('playing');
  }, [unloadCurrent]);

  const load = useCallback(async (recording: Recording) => {
    await unloadCurrent();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });

    // Use segmentUris if available, else fall back to the single fileUri
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
  }, [unloadCurrent, loadSegment]);

  const play = useCallback(async () => {
    isPlayingRef.current = true;
    await soundRef.current?.playAsync();
    setPlayerState('playing');
  }, []);

  const pause = useCallback(async () => {
    isPlayingRef.current = false;
    await soundRef.current?.pauseAsync();
    setPlayerState('paused');
  }, []);

  /**
   * Seek to an absolute position in seconds across all segments.
   * Uses approximate per-segment durations.
   */
  const seek = useCallback(async (targetSeconds: number) => {
    const uris = segmentUrisRef.current;
    if (!uris.length) return;

    const total = totalDurationRef.current;
    const approxSegDur = total / uris.length; // approximate segment duration

    let idx = 0;
    let offset = 0;
    while (idx < uris.length - 1 && offset + approxSegDur < targetSeconds) {
      offset += approxSegDur;
      idx += 1;
    }

    const posWithinSeg = Math.max(0, targetSeconds - offset);
    const wasPlaying = isPlayingRef.current;

    if (idx !== segmentIndexRef.current) {
      segmentIndexRef.current = idx;
      segmentOffsetRef.current = offset;
      await loadSegment(idx, false);
    }

    await soundRef.current?.setPositionAsync(posWithinSeg * 1000);
    setCurrentTime(offset + posWithinSeg);

    if (wasPlaying) {
      await soundRef.current?.playAsync();
    }
  }, [loadSegment]);

  const unload = useCallback(async () => {
    isPlayingRef.current = false;
    await unloadCurrent();
    segmentUrisRef.current = [];
    segmentIndexRef.current = 0;
    segmentOffsetRef.current = 0;
    setPlayerState('idle');
    setCurrentTime(0);
    setDuration(0);
  }, [unloadCurrent]);

  return { playerState, currentTime, duration, load, play, pause, seek, unload };
}
