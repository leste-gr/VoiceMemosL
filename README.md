# VoiceMemosL

A hands-free voice memo app built with **React Native + Expo Go** — designed for use while driving. Record, transcribe, and replay your thoughts without touching your phone.

---

## Features

- **Hands-free recording** — say *"record"* or *"start recording"* to begin
- **Voice-controlled stop** — say *"stop"*, *"stop recording"*, or *"end recording"* to finish
- **Pause / Resume by voice** — say *"pause"* or *"resume"* at any time
- **Live transcription** — every 5 seconds of audio is transcribed in real time via Groq Whisper
- **Full transcript saved** — each memo stores its complete transcript, viewable on playback
- **Sequential segment playback** — recordings are stored as short segments and played back seamlessly end-to-end
- **Rename & delete** recordings from the list
- **Works in Expo Go** — no EAS build required, no native modules

---

## How it works

### Recording
Audio is recorded in rolling **5-second segments**. Each completed segment is immediately sent to the [Groq Whisper API](https://console.groq.com/) for transcription. The transcript accumulates in real time and is shown on screen.

### Voice command detection
Because the recording itself is being transcribed, there is no second microphone or audio session conflict. Commands are detected directly from the live transcript:

| What you say | Action |
|---|---|
| *"record"* / *"start recording"* | Start a new recording (when idle) |
| *"stop"* / *"stop recording"* / *"end recording"* | Stop and save |
| *"pause"* / *"pause recording"* | Pause |
| *"resume"* / *"continue"* | Resume |

When **idle**, a background 4-second mic loop listens for a start command (the only time a second audio session is needed, since the recorder is not running).

### Playback
Segments are played back sequentially. The saved transcript is displayed below the player.

---

## Tech stack

| | |
|---|---|
| Framework | React Native + Expo SDK 54 |
| Language | TypeScript |
| Audio | `expo-av` |
| Speech-to-text | [Groq Whisper](https://console.groq.com/) (`whisper-large-v3-turbo`) |
| Storage | `expo-file-system` + `@react-native-async-storage/async-storage` |
| Navigation | `@react-navigation/native-stack` |

---

## Project structure

```
src/
  hooks/
    useAudioRecorder.ts       # Segment-based recording loop (5s chunks)
    useAudioPlayer.ts         # Sequential multi-segment playback
    useRecordingTranscript.ts # Groq STT per segment + command detection
    useVoiceCommands.ts       # Idle "start recording" listener
  screens/
    RecordingListScreen.tsx   # Main screen: list, record button, live transcript
    PlaybackScreen.tsx        # Playback with slider and transcript view
    types.ts                  # Navigation param types
  store/
    RecordingsStore.tsx       # AsyncStorage + FileSystem persistence
  types/
    Recording.ts              # Recording data model
```

---

## Getting started

### Prerequisites
- Node.js 18+
- Expo Go installed on your iPhone or Android device
- A free [Groq API key](https://console.groq.com/)

### Setup

```bash
git clone https://github.com/leste-gr/VoiceMemosL.git
cd VoiceMemosL
npm install --legacy-peer-deps
```

Create a `.env` file in the project root:

```
EXPO_PUBLIC_GROQ_API_KEY=your_groq_api_key_here
```

### Run

```bash
npx expo start --clear
```

Scan the QR code with Expo Go on your device.

---

## Notes

- Tested on **iOS** via Expo Go. Android should work but is less tested.
- Whisper transcription adds a small delay (~1–2 s per segment depending on network). Commands are detected after the segment that contains them is returned.
- The 5-second segment length is configurable via `SEGMENT_MS` in `useAudioRecorder.ts`.
