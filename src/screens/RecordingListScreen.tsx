import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal, Pressable, ListRenderItemInfo, ScrollView, AppState,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { useRecordingsStore } from '../store/RecordingsStore';
import { useVoiceCommands } from '../hooks/useVoiceCommands';
import type { SpeechLocale } from '../hooks/useVoiceCommands';
import { useRecordingSession } from '../hooks/useRecordingSession';
import { Recording } from '../types/Recording';
import { RootStackParamList } from './types';

type Props = NativeStackScreenProps<RootStackParamList, 'List'>;
const LANGUAGE_KEY = '@voice_memos_language';

function formatTitle(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function RecordingListScreen({ navigation }: Props) {
  const isFocused = useIsFocused();
  const { recordings, addRecording, deleteRecording, renameRecording } = useRecordingsStore();
  const [speechLocale, setSpeechLocale] = useState<SpeechLocale>('el-GR');
  const session = useRecordingSession(speechLocale);
  const [renameTarget, setRenameTarget] = useState<Recording | null>(null);
  const [renameText, setRenameText] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [debugLog, setDebugLog] = useState<{ text: string; status: string; ts: number }[]>([]);

  const addDebug = useCallback((text: string, status: string) => {
    setDebugLog((prev) => [{ text, status, ts: Date.now() }, ...prev].slice(0, 20));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_KEY)
      .then((value) => {
        if (value === 'en-US' || value === 'el-GR') {
          setSpeechLocale(value);
        }
      })
      .catch(() => {});
  }, []);

  const selectLanguage = useCallback((locale: SpeechLocale) => {
    setSpeechLocale(locale);
    AsyncStorage.setItem(LANGUAGE_KEY, locale).catch(() => {});
  }, []);

  const handleLanguageCommand = useCallback((nextLocale: SpeechLocale) => {
    if (savingRef.current || session.state !== 'idle') return;
    selectLanguage(nextLocale);
  }, [session.state, selectLanguage]);

  // ── Stop + save ────────────────────────────────────────────────────────────
  const stopAndSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const { segmentUris, duration, transcript } = await session.stop();
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
      savingRef.current = false;
      setSaving(false);
    }
  }, [session.stop, addRecording]);

  const stopAndSaveRef = useRef(stopAndSave);
  stopAndSaveRef.current = stopAndSave;

  // Auto-save if app goes background while recording.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (
        (nextState === 'inactive' || nextState === 'background') &&
        session.state === 'recording' &&
        !savingRef.current
      ) {
        stopAndSaveRef.current();
      }
    });
    return () => sub.remove();
  }, [session.state]);

  // ── Start recording (voice command trigger) ────────────────────────────────
  const handleStart = useCallback(() => {
    if (session.state !== 'idle' || savingRef.current) return;
    session.start(() => stopAndSaveRef.current());
  }, [session.state, session.start]);

  // ── Idle voice command listener ────────────────────────────────────────────
  useVoiceCommands(
    handleStart,
    isFocused && session.state === 'idle' && !saving,
    speechLocale,
    handleLanguageCommand,
    addDebug,
  );

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

  const isRecording = session.state === 'recording';
  const languageLabel = speechLocale === 'el-GR' ? 'Greek' : 'English';
  const buildNumber = process.env.EXPO_PUBLIC_BUILD_NUMBER;
  const versionLabel = buildNumber ? `v1.0 (build ${buildNumber})` : 'dev';

  return (
    <View style={styles.container}>
      {/* Voice-command status banner (idle only) */}
      {!isRecording && !saving && (
        <View style={styles.voiceBanner}>
          <Ionicons name="volume-medium-outline" size={14} color="#555" />
          <Text style={styles.voiceBannerText}>
            Listening ({languageLabel}) • say "English" or "Greek"
          </Text>
          <View style={styles.langSwitch}>
            <TouchableOpacity
              style={[styles.langBtn, speechLocale === 'en-US' && styles.langBtnActive]}
              onPress={() => selectLanguage('en-US')}
            >
              <Text style={[styles.langText, speechLocale === 'en-US' && styles.langTextActive]}>EN</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langBtn, speechLocale === 'el-GR' && styles.langBtnActive]}
              onPress={() => selectLanguage('el-GR')}
            >
              <Text style={[styles.langText, speechLocale === 'el-GR' && styles.langTextActive]}>EL</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.versionText}>{versionLabel}</Text>
        </View>
      )}

      {/* Debug panel — shows raw STT output while idle */}
      {!isRecording && debugLog.length > 0 && (
        <View style={styles.debugPanel}>
          <Text style={styles.debugTitle}>🛠 STT debug log</Text>
          {debugLog.map((entry) => (
            <Text key={entry.ts} style={styles.debugEntry} numberOfLines={1}>
              <Text style={styles.debugStatus}>[{entry.status}]</Text>
              {entry.text ? ` ${entry.text}` : ''}
            </Text>
          ))}
        </View>
      )}

      {/* Recording banner: timer + stop button */}
      {isRecording && (
        <View style={styles.timerBanner}>
          <View style={styles.recDot} />
          <Text style={styles.timerText}>{formatDuration(session.elapsed)}</Text>
          <TouchableOpacity onPress={stopAndSave} style={styles.stopBtn} disabled={saving}>
            <View style={styles.stopShape} />
          </TouchableOpacity>
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
              {session.liveTranscript || 'Transcribing…'}
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
          <Text style={styles.emptyText}>No recordings yet.{"\n"}Say the start command in your selected language.</Text>
        }
      />

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
  voiceBannerText: { fontSize: 11, color: '#555', flex: 1 },
  langSwitch: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    marginRight: 8,
  },
  langBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  langBtnActive: {
    backgroundColor: '#1573ff',
    borderRadius: 8,
  },
  langText: { fontSize: 11, color: '#666', fontWeight: '600' },
  langTextActive: { color: '#fff' },
  versionText: { fontSize: 10, color: '#aaa' },
  timerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#e53935', paddingHorizontal: 20, paddingVertical: 10,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  timerText: { color: '#fff', fontVariant: ['tabular-nums'], fontSize: 16, flex: 1 },
  stopBtn: { padding: 6 },
  debugPanel: {
    backgroundColor: '#1a1a2e', paddingHorizontal: 12, paddingVertical: 8,
    maxHeight: 140,
  },
  debugTitle: { color: '#aaa', fontSize: 10, marginBottom: 4, fontWeight: '600' },
  debugEntry: { color: '#eee', fontSize: 11, lineHeight: 17 },
  debugStatus: { color: '#4fc3f7', fontWeight: '700' },
  stopShape: { width: 22, height: 22, borderRadius: 4, backgroundColor: '#fff' },
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
