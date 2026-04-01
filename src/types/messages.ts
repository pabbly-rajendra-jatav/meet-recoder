// ─── Recording Quality ────────────────────────────────────────────
export type RecordingQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityConfig {
  video: boolean;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  width: number;
  height: number;
  label: string;
}

export const QUALITY_PRESETS: Record<RecordingQuality, QualityConfig> = {
  low: {
    video: false,
    videoBitsPerSecond: 0,
    audioBitsPerSecond: 128_000,
    width: 0,
    height: 0,
    label: 'Low (Audio only, ~30 MB/hr)',
  },
  medium: {
    video: true,
    videoBitsPerSecond: 1_000_000,
    audioBitsPerSecond: 128_000,
    width: 854,
    height: 480,
    label: 'Medium (480p)',
  },
  high: {
    video: true,
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
    width: 1280,
    height: 720,
    label: 'High (720p)',
  },
  ultra: {
    video: true,
    videoBitsPerSecond: 5_000_000,
    audioBitsPerSecond: 192_000,
    width: 1920,
    height: 1080,
    label: 'Ultra (1080p)',
  },
};

// ─── Message Types ────────────────────────────────────────────────
export type MessageType =
  | 'START_RECORDING'
  | 'STOP_RECORDING'
  | 'PAUSE_RECORDING'
  | 'RESUME_RECORDING'
  | 'RECORDING_STARTED'
  | 'RECORDING_STARTED_FROM_CONTENT'
  | 'RECORDING_STOPPED'
  | 'RECORDING_STATUS'
  | 'GET_STATUS'
  | 'GET_CONTENT_STATUS'
  | 'MEETING_JOINED'
  | 'RECORDING_DATA'
  | 'RECORDING_ERROR'
  | 'CAPTION_DATA'
  | 'MEETING_ENDED'
  | 'SEND_CONSENT_NOTIFICATION'
  | 'UPDATE_TIMER'
  | 'UPDATE_FILE_SIZE'
  | 'AUTO_START_RECORDING'
  | 'DOWNLOAD_TRANSCRIPT'
  | 'MIC_AUDIO_DATA'
  | 'MERGE_MIC_AUDIO'
  | 'START_CONTENT_RECORDING'
  | 'CONTENT_RECORDING_STARTED'
  | 'CONTENT_RECORDING_DONE'
  | 'RECORDING_STOPPED_BY_CONTENT'
  | 'SAVE_RECORDING_META';

export interface ExtensionMessage {
  type: MessageType;
  payload?: any;
}

export interface StartRecordingPayload {
  quality: RecordingQuality;
  tabId: number;
  streamId: string;
  meetingId: string;
  includeMic: boolean;
}

export interface RecordingStatusPayload {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  pausedDuration: number;
  fileSize: number;
  quality: RecordingQuality;
  meetingId?: string;
}

export interface CaptionEntry {
  speaker: string;
  text: string;
  timestamp: number;
}

// ─── Storage Types ────────────────────────────────────────────────
export type TranscriptionProvider = 'openai' | 'groq';

export interface ExtensionSettings {
  defaultQuality: RecordingQuality;
  autoConsent: boolean;
  autoStart: boolean;
  consentMessage: string;
  transcriptionProvider: TranscriptionProvider;
  groqApiKey: string;
  autoTranscribe: boolean;
}

export interface RecordingHistoryEntry {
  id: string;
  meetingId: string;
  filename: string;
  date: string;
  duration: number;
  fileSize: number;
  quality: RecordingQuality;
  hasTranscript: boolean;
  savedToStore: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  defaultQuality: 'medium',
  autoConsent: false,
  autoStart: false,
  consentMessage: '📹 Recording started by {user name}. This meeting is being recorded.',
  transcriptionProvider: 'groq',
  groqApiKey: '',
  autoTranscribe: false,
};
