import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal, Pressable, ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRecordingsStore } from '../store/RecordingsStore';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useVoiceCommands } from '../hooks/useVoiceCommands';
import { Recording } from '../types/Recording';
import { RootStackParamList } from './types';

type Props = NativeStackScreenProps<RootStackParamList, 'List'>;

export default function RecordingListScreen({ navigation }: Props) {
  const { recordings, newFileUri, addRecording, deleteRecording, renameRecording } = useRecordingsStore();
  const recorder = useAudioRecorder();
  const [renameTarget, setRenameTarget] = useState<Recording | null>(null);
  const [renameText, setRenameText] = useState('');

  // ── Voice commands ──────────────────────────────────────────────────────────
  const handleVoiceCommand = useCallback(
    async (cmd: import('../hooks/useVoiceCommands').VoiceCommand) => {
      switch (cmd) {
        case 'startRecording':
          if (recorder.state === 'idle') {
            const uri = newFileUri();
            await recorder.start(uri);
          }
          break;
        case 'stopRecording':
          if (recorder.state !== 'idle') {
            await recorder.stop(addRecording);
          }
          break;
        case 'pause':
          await recorder.pause();
          break;
        case 'resume':
          await recorder.resume();
          break;
        case 'playLast':
          if (recordings.length > 0) {
            navigation.navigate('Playback', { recording: recordings[0] });
          }
          break;
      }
    },
    [recorder, recordings, newFileUri, addRecording, navigation]
  );

  useVoiceCommands(handleVoiceCommand);

  // ── Record button ────────────────────────────────────────────────────────────
  async function handleRecordPress() {
    if (recorder.state === 'idle') {
      const uri = newFileUri();
      await recorder.start(uri);
    } else {
      await recorder.stop(addRecording);
    }
  }

  // ── Row actions ──────────────────────────────────────────────────────────────
  function confirmDelete(recording: Recording) {
    Alert.alert('Delete Recording', `Delete "${recording.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteRecording(recording.id) },
    ]);
  }

  function openRename(recording: Recording) {
    setRenameTarget(recording);
    setRenameText(recording.title);
  }

  async function submitRename() {
    if (renameTarget && renameText.trim()) {
      await renameRecording(renameTarget.id, renameText.trim());
    }
    setRenameTarget(null);
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function renderItem({ item }: ListRenderItemInfo<Recording>) {
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('Playback', { recording: item })}
        activeOpacity={0.7}
      >
        <Ionicons name="mic" size={20} color="#e53935" style={styles.rowIcon} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.rowMeta}>
            {new Date(item.createdAt).toLocaleDateString()}  ·  {formatDuration(item.duration)}
          </Text>
        </View>
        <TouchableOpacity onPress={() => openRename(item)} style={styles.rowAction}>
          <Ionicons name="pencil-outline" size={18} color="#888" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => confirmDelete(item)} style={styles.rowAction}>
          <Ionicons name="trash-outline" size={18} color="#e53935" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  const isRecording = recorder.state !== 'idle';

  return (
    <View style={styles.container}>
      {/* Voice-command status banner */}
      <View style={styles.voiceBanner}>
        <Ionicons name="volume-medium-outline" size={14} color="#555" />
        <Text style={styles.voiceBannerText}>
          Listening · say "record", "stop", "pause", "resume", "play last"
        </Text>
      </View>

      {/* Recording timer */}
      {isRecording && (
        <View style={styles.timerBanner}>
          <View style={styles.recDot} />
          <Text style={styles.timerText}>{formatDuration(recorder.elapsed)}</Text>
          {recorder.state === 'recording' && (
            <TouchableOpacity onPress={recorder.pause} style={styles.pauseBtn}>
              <Ionicons name="pause" size={18} color="#fff" />
            </TouchableOpacity>
          )}
          {recorder.state === 'paused' && (
            <TouchableOpacity onPress={recorder.resume} style={styles.pauseBtn}>
              <Ionicons name="play" size={18} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlatList
        data={recordings}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={recordings.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No recordings yet.{'\n'}Tap the button below to start.</Text>
        }
      />

      {/* Record / Stop button */}
      <TouchableOpacity
        style={[styles.recordButton, isRecording && styles.recordButtonActive]}
        onPress={handleRecordPress}
        activeOpacity={0.8}
      >
        {isRecording
          ? <View style={styles.stopShape} />
          : <View style={styles.startShape} />}
      </TouchableOpacity>

      {/* Rename modal */}
      <Modal transparent visible={!!renameTarget} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setRenameTarget(null)}>
          <Pressable style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename Recording</Text>
            <TextInput
              style={styles.modalInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              onSubmitEditing={submitRename}
              returnKeyType="done"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setRenameTarget(null)} style={styles.modalBtnCancel}>
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitRename} style={styles.modalBtnSave}>
                <Text style={styles.modalBtnSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  voiceBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fffde7', paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
  },
  voiceBannerText: { fontSize: 11, color: '#555' },
  timerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#e53935', paddingHorizontal: 20, paddingVertical: 10,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  timerText: { color: '#fff', fontVariant: ['tabular-nums'], fontSize: 16, flex: 1 },
  pauseBtn: { padding: 4 },
  list: { paddingVertical: 8 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText: { textAlign: 'center', color: '#999', fontSize: 15, lineHeight: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', marginHorizontal: 12, marginVertical: 5,
    borderRadius: 12, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  rowIcon: { marginRight: 12 },
  rowText: { flex: 1, marginRight: 8 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  rowMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  rowAction: { padding: 6 },
  recordButton: {
    position: 'absolute', bottom: 36, alignSelf: 'center',
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#e53935', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#e53935', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  recordButtonActive: { backgroundColor: '#b71c1c' },
  startShape: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff' },
  stopShape: { width: 24, height: 24, borderRadius: 4, backgroundColor: '#fff' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 32 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  modalInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    padding: 10, fontSize: 15, marginBottom: 20,
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalBtnCancel: { padding: 10 },
  modalBtnCancelText: { color: '#888', fontSize: 15 },
  modalBtnSave: { backgroundColor: '#e53935', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  modalBtnSaveText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
