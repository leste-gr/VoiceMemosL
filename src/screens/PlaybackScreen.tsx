import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { RootStackParamList } from './types';

type Props = NativeStackScreenProps<RootStackParamList, 'Playback'>;

export default function PlaybackScreen({ route }: Props) {
  const { recording } = route.params;
  const { playerState, currentTime, duration, load, play, pause, seek, unload } = useAudioPlayer();

  useEffect(() => {
    load(recording);
    return () => { unload(); };
  }, [recording.id]);

  function handlePlayPause() {
    if (playerState === 'playing') pause();
    else play();
  }

  return (
    <View style={styles.container}>
      <View style={styles.titleCard}>
        <Ionicons name="mic" size={32} color="#e53935" />
        <Text style={styles.title}>{recording.title}</Text>
        <Text style={styles.date}>{new Date(recording.createdAt).toLocaleString()}</Text>
      </View>

      <View style={styles.controls}>
        {/* Slider */}
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={duration || 1}
          value={currentTime}
          onSlidingComplete={(val) => seek(val)}
          minimumTrackTintColor="#e53935"
          maximumTrackTintColor="#ddd"
          thumbTintColor="#e53935"
        />
        <View style={styles.times}>
          <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>

        {/* Buttons */}
        <View style={styles.buttons}>
          <TouchableOpacity
            onPress={() => seek(Math.max(0, currentTime - 15))}
            style={styles.skipBtn}
            accessibilityLabel="Rewind 15 seconds"
          >
            <Ionicons name="play-back" size={28} color="#333" />
            <Text style={styles.skipLabel}>15</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handlePlayPause} style={styles.playBtn} activeOpacity={0.8}>
            <Ionicons
              name={playerState === 'playing' ? 'pause' : 'play'}
              size={36}
              color="#fff"
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => seek(Math.min(duration, currentTime + 15))}
            style={styles.skipBtn}
            accessibilityLabel="Forward 15 seconds"
          >
            <Ionicons name="play-forward" size={28} color="#333" />
            <Text style={styles.skipLabel}>15</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', justifyContent: 'space-around', padding: 24 },
  titleCard: {
    alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 20, padding: 32,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', textAlign: 'center' },
  date: { fontSize: 13, color: '#999' },
  controls: { gap: 8 },
  slider: { width: '100%', height: 40 },
  times: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  timeText: { fontSize: 12, color: '#888', fontVariant: ['tabular-nums'] },
  buttons: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 40, marginTop: 16 },
  skipBtn: { alignItems: 'center' },
  skipLabel: { fontSize: 11, color: '#555', marginTop: 2 },
  playBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#e53935', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#e53935', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
});
