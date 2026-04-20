export interface Recording {
  id: string;
  title: string;
  fileUri: string;
  createdAt: string; // ISO string
  duration: number;  // seconds
}
