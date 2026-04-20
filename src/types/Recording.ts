export interface Recording {
  id: string;
  title: string;
  fileUri: string;       // first segment URI (used as display/playback primary)
  segmentUris: string[]; // all segments in order, for sequential playback
  createdAt: string;     // ISO string
  duration: number;      // total seconds
  transcript?: string;   // accumulated Groq transcript
}
