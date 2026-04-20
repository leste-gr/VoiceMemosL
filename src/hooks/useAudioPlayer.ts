import { useState, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import { Recording } from '../types/Recording';

export type PlayerState = 'idle' | 'playing' | 'paused';

export function useAudioPlayer() {
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const soundRef = useRef<Audio.Sound | null>(null);

  const load = useCallback(async (recording: Recording) => {
    // Unload previous
    await soundRef.current?.unloadAsync();

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri: recording.fileUri },
      { shouldPlay: false },
      (status) => {
        if (!status.isLoaded) return;
        setCurrentTime(status.positionMillis / 1000);
        setDuration((status.durationMillis ?? 0) / 1000);
        if (status.didJustFinish) {
          setPlayerState('idle');
          setCurrentTime(0);
        }
      }
    );

    soundRef.current = sound;
    setDuration(recording.duration);
    setCurrentTime(0);
    setPlayerState('idle');
  }, []);

  const play = useCallback(async () => {
    await soundRef.current?.playAsync();
    setPlayerState('playing');
  }, []);

  const pause = useCallback(async () => {
    await soundRef.current?.pauseAsync();
    setPlayerState('paused');
  }, []);

  const seek = useCallback(async (seconds: number) => {
    await soundRef.current?.setPositionAsync(seconds * 1000);
    setCurrentTime(seconds);
  }, []);

  const unload = useCallback(async () => {
    await soundRef.current?.unloadAsync();
    soundRef.current = null;
    setPlayerState('idle');
    setCurrentTime(0);
    setDuration(0);
  }, []);

  return { playerState, currentTime, duration, load, play, pause, seek, unload };
}
