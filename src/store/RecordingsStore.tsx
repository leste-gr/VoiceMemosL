import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Recording } from '../types/Recording';

const STORAGE_KEY = '@voice_memos_recordings';
const RECORDINGS_DIR = FileSystem.documentDirectory + 'recordings/';

interface RecordingsStore {
  recordings: Recording[];
  newFileUri: () => string;
  addRecording: (recording: Recording) => Promise<void>;
  deleteRecording: (id: string) => Promise<void>;
  renameRecording: (id: string, newTitle: string) => Promise<void>;
}

const RecordingsContext = createContext<RecordingsStore | null>(null);

export function RecordingsProvider({ children }: { children: React.ReactNode }) {
  const [recordings, setRecordings] = useState<Recording[]>([]);

  // Ensure recordings directory exists and load saved data
  useEffect(() => {
    async function init() {
      const info = await FileSystem.getInfoAsync(RECORDINGS_DIR);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
      }
      await load();
    }
    init();
  }, []);

  async function load() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved: Recording[] = JSON.parse(raw);
      // Filter out records whose file no longer exists
      const valid = await Promise.all(
        saved.map(async (r) => {
          const info = await FileSystem.getInfoAsync(r.fileUri);
          return info.exists ? r : null;
        })
      );
      setRecordings(valid.filter((r): r is Recording => r !== null));
    } catch {}
  }

  async function persist(next: Recording[]) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setRecordings(next);
  }

  function newFileUri(): string {
    return RECORDINGS_DIR + `${Date.now()}.m4a`;
  }

  const addRecording = useCallback(async (recording: Recording) => {
    setRecordings((prev) => {
      const next = [recording, ...prev];
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteRecording = useCallback(async (id: string) => {
    setRecordings((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target) {
        // Delete all segment files (or the single file for legacy recordings)
        const uris = target.segmentUris?.length ? target.segmentUris : [target.fileUri];
        uris.forEach((uri) => FileSystem.deleteAsync(uri, { idempotent: true }));
      }
      const next = prev.filter((r) => r.id !== id);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const renameRecording = useCallback(async (id: string, newTitle: string) => {
    setRecordings((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, title: newTitle } : r));
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <RecordingsContext.Provider value={{ recordings, newFileUri, addRecording, deleteRecording, renameRecording }}>
      {children}
    </RecordingsContext.Provider>
  );
}

export function useRecordingsStore(): RecordingsStore {
  const ctx = useContext(RecordingsContext);
  if (!ctx) throw new Error('useRecordingsStore must be used within RecordingsProvider');
  return ctx;
}
