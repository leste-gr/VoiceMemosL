import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Recording } from '../types/Recording';

const STORAGE_KEY = '@voice_memos_recordings';
const DRAFT_STORAGE_KEY = '@voice_memos_recording_draft';
const RECORDINGS_DIR = FileSystem.documentDirectory + 'recordings/';

interface RecordingsStore {
  recordings: Recording[];
  materializeSegment: (sourceUri: string, recordingId: string, segmentIndex: number) => Promise<string>;
  addRecording: (recording: Recording) => Promise<void>;
  saveDraftRecording: (recording: Recording) => Promise<void>;
  clearDraftRecording: () => Promise<void>;
  deleteRecording: (id: string) => Promise<void>;
  renameRecording: (id: string, newTitle: string) => Promise<void>;
}

const RecordingsContext = createContext<RecordingsStore | null>(null);

export function RecordingsProvider({ children }: { children: React.ReactNode }) {
  const [recordings, setRecordings] = useState<Recording[]>([]);

  const ensureRecordingsDir = useCallback(async () => {
    const info = await FileSystem.getInfoAsync(RECORDINGS_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
    }
  }, []);

  const sanitizeRecording = useCallback(async (recording: Recording): Promise<Recording | null> => {
    try {
      const uris = recording.segmentUris?.length ? recording.segmentUris : [recording.fileUri];
      const existing: string[] = [];
      for (const uri of uris) {
        if (!uri) continue;
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists) existing.push(uri);
      }
      if (!existing.length) return null;

      return {
        ...recording,
        fileUri: existing[0],
        segmentUris: existing,
      };
    } catch {
      return null;
    }
  }, []);

  // Ensure recordings directory exists and load saved data
  useEffect(() => {
    async function init() {
      await ensureRecordingsDir();
      await load();
    }
    init();
  }, [ensureRecordingsDir]);

  async function load() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const saved: Recording[] = raw ? JSON.parse(raw) : [];
      const checked = await Promise.all(
        saved.map((recording) => sanitizeRecording(recording))
      );

      const valid = checked.filter((r): r is Recording => r !== null);
      const rawDraft = await AsyncStorage.getItem(DRAFT_STORAGE_KEY);
      const draft = rawDraft ? await sanitizeRecording(JSON.parse(rawDraft) as Recording) : null;
      const next = draft
        ? [
            { ...draft, title: draft.title.startsWith('Recovered ') ? draft.title : `Recovered ${draft.title}` },
            ...valid.filter((recording) => recording.id !== draft.id),
          ]
        : valid;

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (draft) {
        await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
      }
      setRecordings(next);
    } catch {}
  }

  async function persist(next: Recording[]) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setRecordings(next);
  }

  const materializeSegment = useCallback(async (sourceUri: string, recordingId: string, segmentIndex: number) => {
    await ensureRecordingsDir();
    const destinationUri = `${RECORDINGS_DIR}${recordingId}-${segmentIndex}.m4a`;

    if (sourceUri === destinationUri) {
      return destinationUri;
    }

    const existing = await FileSystem.getInfoAsync(destinationUri);
    if (existing.exists) {
      await FileSystem.deleteAsync(destinationUri, { idempotent: true });
    }

    await FileSystem.copyAsync({ from: sourceUri, to: destinationUri });
    await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
    return destinationUri;
  }, [ensureRecordingsDir]);

  const addRecording = useCallback(async (recording: Recording) => {
    let next: Recording[] = [];
    setRecordings((prev) => {
      next = [recording, ...prev.filter((item) => item.id !== recording.id)];
      return next;
    });
    await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const saveDraftRecording = useCallback(async (recording: Recording) => {
    await AsyncStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(recording));
  }, []);

  const clearDraftRecording = useCallback(async () => {
    await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
  }, []);

  const deleteRecording = useCallback(async (id: string) => {
    let next: Recording[] = [];
    setRecordings((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target) {
        const uris = target.segmentUris?.length ? target.segmentUris : [target.fileUri];
        uris.forEach((uri) => FileSystem.deleteAsync(uri, { idempotent: true }));
      }
      next = prev.filter((r) => r.id !== id);
      return next;
    });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const renameRecording = useCallback(async (id: string, newTitle: string) => {
    let next: Recording[] = [];
    setRecordings((prev) => {
      next = prev.map((r) => (r.id === id ? { ...r, title: newTitle } : r));
      return next;
    });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  return (
    <RecordingsContext.Provider value={{
      recordings,
      materializeSegment,
      addRecording,
      saveDraftRecording,
      clearDraftRecording,
      deleteRecording,
      renameRecording,
    }}>
      {children}
    </RecordingsContext.Provider>
  );
}

export function useRecordingsStore(): RecordingsStore {
  const ctx = useContext(RecordingsContext);
  if (!ctx) throw new Error('useRecordingsStore must be used within RecordingsProvider');
  return ctx;
}
