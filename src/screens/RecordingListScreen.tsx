import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal, Pressable, ListRenderItemInfo, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { useRecordingsStore } from '../store/RecordingsStore';
import { useAudioRecorder, formatTitle } from '../hooks/useAudioRecorder';
import { useVoiceCommands } from '../hooks/useVoiceCommands';
import { useRecordingTranscript } from '../hooks/useRecordingTranscript';
import { Recording } from '../types/Recording';
import { RootStackParamList } from './types';

type Props = NativeStackScreenProps<RootStackParamList, 'List'>;

export default function RecordingListScreen({ navigation }: Props) {
  const isFocused = useIsFocused();
  const { recordings, addRecording, deleteRecording, renameRecording } = useRecordingsStore();
  const recorder = useAudioRecorder();
  const [renameTarget, setRenameTarget] = useState<Recording | null>(null);
  const [renameText, setRenameText] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [saving, setSaving] = useState(false);

  // Ref-based interlock — flipped synchronously before any await, so commands
  // from in-flight Groq calls that arrive after stop are ignored.
  const isActiveRecordingRef = useRef(false);
  const isSavingRef = useRef(false);

  // Keeps segment URIs collected during a recording session
  const sessionSegmentsRef = useRef<string[]>([]);

  // ── Transcript + command detection ─────────────────────────────────────────
  type TranscriptCmd = import('../hooks/useRecordingTranscript').TranscriptCommand;

  // Stable callback — safe to pass to useRecordingTranscript without triggering
  // re-subscriptions. Dispatches via ref so it always sees the latest handlers.
  const transcriptCmdRef = useRef<(cmd: TranscriptCmd) => void>(() => {});
  const handleTranscriptCommand = useCallback(
    (cmd: TranscriptCmd) => {
      console.log('[CMD] handleTranscriptCommand called, cmd=', cmd, 'isActive=', isActiveRecordingRef.current);
      // Ignore commands that arrive after recording has already been stopped
      if (!isActiveRecordingRef.current) {
        console.log('[CMD] ignored — recording not active');
        return;
      }
      transcriptCmdRef.current(cmd);
    },
    [],
  );

  const { processSegment, waitForPending, reset: resetTranscript, enable: enableTranscript, getTranscript } =
    useRecordingTranscript(handleTranscriptCommand);

  // ── Stop + save ────────────────────────────────────────────────────────────
  // Uses only stable refs for the guard — no dependency on React state closures.
  const stopAndSave = useCallback(async () => {
    console.log('[StopSave] called, isActive=', isActiveRecordingRef.current, 'isSaving=', isSavingRef.current);
    if (!isActiveRecordingRef.current || isSavingRef.current) {
      console.log('[StopSave] guard blocked — returning early');
      return;
    }
    // Flip interlocks synchronously BEFORE any await.
    // isActiveRecordingRef=false gates handleTranscriptCommand so no new commands fire.
    isActiveRecordingRef.current = false;
    isSavingRef.current = true;
    setSaving(true);
    // NOTE: do NOT call resetTranscript() here — it would wipe both the transcript
    // and pendingRef, so getTranscript() would return '' and waitForPending() would
    // skip in-flight Groq calls that still need to finish before we save.
    try {
      const { segmentUris, duration } = await recorder.stop();
      // Wait for all in-flight Groq calls to settle (transcript still accumulates,
      // but commands are blocked by isActiveRecordingRef=false above).
      await waitForPending();
      const transcript = getTranscript();
      console.log('[StopSave] segments:', segmentUris.length, 'transcript length:', transcript.length);
      const now = new Date();
      const recording: Recording = {
        id: now.getTime().toString(),
        title: formatTitle(now),
        fileUri: segmentUris[0] ?? '',
        segmentUris,
        createdAt: now.toISOString(),
        duration,
        transcript: transcript || undefined,
      };
      await addRecording(recording);
    } catch (e) {
      console.warn('[RecordingList] stopAndSave error:', e);
    } finally {
      resetTranscript(); // clear for next session (in finally so it always runs)
      setLiveTranscript('');
      sessionSegmentsRef.current = [];
      isSavingRef.current = false;
      setSaving(false);
    }
  }, [recorder.stop, waitForPending, getTranscript, addRecording, resetTranscript]);

  // Update the dispatch ref every render so pause/resume always use latest state.
  transcriptCmdRef.current = (cmd: TranscriptCmd) => {
    console.log('[CMD] transcriptCmdRef dispatching:', cmd);
    if (cmd === 'stopRecording') {
      stopAndSave();
    } else if (cmd === 'pause') {
      recorder.pause();
    } else if (cmd === 'resume') {
      recorder.resume();
    }
  };

  // ── Segment callback (called by recorder every ~5 s) ──────────────────────
  const handleSegment = useCallback(
    (uri: string, _segDuration: number) => {
      processSegment(uri).then((full) => setLiveTranscript(full));
    },
    [processSegment],
  );

  // ── Idle voice command (start / resume recording) ──────────────────────────
  useVoiceCommands(
    useCallback(() => { handleRecordPress(); }, []),
    isFocused && recorder.state === 'idle' && !saving,
    useCallback(() => { recorder.resume(); }, [recorder.resume]),
    isFocused && recorder.state === 'paused',
  );

  // ── Record button ──────────────────────────────────────────────────────────
  async function handleRecordPress() {
    if (recorder.state === 'idle' && !isSavingRef.current) {
      sessionSegmentsRef.current = [];
      isActiveRecordingRef.current = true;
      enableTranscript();
      await recorder.start(handleSegment);
    } else if (recorder.state === 'paused') {
      await recorder.resume();
    } else if (isActiveRecordingRef.current) {
      await stopAndSave();
    }
  }

  // ── Row actions ────────────────────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
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
      {/* Voice-command status banner (idle only) */}
      {!isRecording && !saving && (
        <View style={styles.voiceBanner}>
          <Ionicons name="volume-medium-outline" size={14} color="#555" />
          <Text style={styles.voiceBannerText}>
            Listening · say "record" or "start recording"
          </Text>
        </View>
      )}

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
        </View>
      )}

      {/* Live transcript while recording */}
      {isRecording && (
        <View style={styles.transcriptBox}>
          <Text style={styles.transcriptLabel}>
            <Ionicons name="text-outline" size={11} color="#888" /> Live transcript
          </Text>
          <ScrollView style={styles.transcriptScroll}>
            <Text style={styles.transcriptText}>
              {liveTranscript || 'Transcribing…'}
            </Text>
          </ScrollView>
        </View>
      )}

      {/* Saving indicator */}
      {saving && (
        <View style={styles.savingBanner}>
          <Text style={styles.savingText}>Saving…</Text>
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

      {/* Record / Stop / Resume button */}
      <TouchableOpacity
        style={[
          styles.recordButton,
          recorder.state === 'recording' && styles.recordButtonActive,
          recorder.state === 'paused' && styles.recordButtonPaused,
        ]}
        onPress={handleRecordPress}
        activeOpacity={0.8}
        disabled={saving}
      >
        {recorder.state === 'recording'
          ? <View style={styles.stopShape} />
          : recorder.state === 'paused'
            ? <Ionicons name="play" size={28} color="#fff" />
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
  transcriptBox: {
    backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6, maxHeight: 100,
  },
  transcriptLabel: { fontSize: 10, color: '#888', marginBottom: 4 },
  transcriptScroll: { flexGrow: 0 },
  transcriptText: { fontSize: 13, color: '#333', lineHeight: 18 },
  savingBanner: {
    backgroundColor: '#e8f5e9', padding: 10, alignItems: 'center',
  },
  savingText: { color: '#388e3c', fontSize: 13, fontWeight: '600' },
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
  recordButtonPaused: { backgroundColor: '#e65100' },
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
