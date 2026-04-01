import {
  ExtensionMessage,
  RecordingStatusPayload,
  RecordingQuality,
  DEFAULT_SETTINGS,
  RecordingHistoryEntry,
  ExtensionSettings,
} from '../types/messages';
import { getRecording } from '../utils/videoStore';
import { transcribeRecording, formatTranscript } from '../utils/transcribe';

// ─── State ────────────────────────────────────────────────────────
let isRecording = false;
let recordingTabId: number | null = null;
let recorderTabId: number | null = null;
let recorderWindowId: number | null = null;
let recordingStartTime = 0;
let currentFileSize = 0;
let currentQuality: RecordingQuality = 'medium';
let currentMeetingId = '';
let micAudioBase64: string | null = null;
let useRecorderTab = false; // true = recorder tab, false = offscreen
let isPaused = false;
let pausedAt = 0;
let totalPausedDuration = 0;

// ─── Badge ───────────────────────────────────────────────────────
function updateBadge(recording: boolean): void {
  chrome.action.setBadgeText({ text: recording ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: recording ? '#e53e3e' : '#4a5568' });
}

function resetState(): void {
  isRecording = false;
  isPaused = false;
  pausedAt = 0;
  totalPausedDuration = 0;
  recordingTabId = null;
  recorderTabId = null;
  recorderWindowId = null;
  recordingStartTime = 0;
  currentFileSize = 0;
  useRecorderTab = false;
  updateBadge(false);
}

// ─── Offscreen Document ──────────────────────────────────────────
async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Recording Google Meet audio/video with microphone',
  });
}

async function closeOffscreenDocument(): Promise<void> {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (contexts.length > 0) await chrome.offscreen.closeDocument();
  } catch { /* ignore */ }
}

// ─── Check if mic permission was already granted ────────────────
async function hasMicPermission(): Promise<boolean> {
  const stored = await chrome.storage.local.get('micPermissionGranted');
  return !!stored.micPermissionGranted;
}

// ─── Start Recording ────────────────────────────────────────────
async function startRecording(meetTabId: number, quality: RecordingQuality, meetingId: string): Promise<void> {
  if (isRecording) throw new Error('Already recording');

  const micGranted = await hasMicPermission();

  if (micGranted) {
    // Mic permission exists — use offscreen (no tab needed!)
    await startViaOffscreen(meetTabId, quality, meetingId);
  } else {
    // First time — need recorder tab for mic permission
    await startViaRecorderTab(meetTabId, quality, meetingId);
  }
}

// ─── Start via Offscreen (no extra tab) ─────────────────────────
async function startViaOffscreen(meetTabId: number, quality: RecordingQuality, meetingId: string): Promise<void> {
  useRecorderTab = false;

  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: meetTabId }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });

  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    type: 'START_RECORDING',
    payload: { quality, tabId: meetTabId, streamId, meetingId, includeMic: true },
  });

  if (response?.error) throw new Error(response.error);

  isRecording = true;
  recordingTabId = meetTabId;
  recordingStartTime = Date.now();
  currentFileSize = 0;
  currentQuality = quality;
  currentMeetingId = meetingId;
  micAudioBase64 = null;
  updateBadge(true);

  // Notify content script
  try { chrome.tabs.sendMessage(meetTabId, { type: 'RECORDING_STARTED' }); } catch { /* ignore */ }
  await sendConsentNotification(meetTabId);
}

// ─── Start via Recorder Tab (first time, for mic permission) ────
async function startViaRecorderTab(meetTabId: number, quality: RecordingQuality, meetingId: string): Promise<void> {
  useRecorderTab = true;

  // Open recorder in separate minimized window
  const win = await chrome.windows.create({
    url: 'recorder.html',
    type: 'popup',
    width: 400,
    height: 200,
    top: 0,
    left: 0,
    focused: true, // Must be focused initially for getUserMedia
  });

  if (!win.id || !win.tabs?.[0]?.id) throw new Error('Failed to create recorder window');
  recorderTabId = win.tabs[0].id;
  recorderWindowId = win.id;

  // Wait for page to load
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));

  // Get stream ID
  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId(
      { targetTabId: meetTabId, consumerTabId: recorderTabId! },
      (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      }
    );
  });

  // Send start command to recorder
  const response = await chrome.tabs.sendMessage(recorderTabId, {
    type: 'START_RECORDING',
    payload: { quality, tabId: meetTabId, streamId, meetingId, includeMic: true },
  });

  if (response?.error) {
    chrome.windows.remove(win.id).catch(() => {});
    throw new Error(response.error);
  }

  // Minimize recorder window and focus back to Meet
  try {
    await chrome.windows.update(win.id, { state: 'minimized' });
    const meetTab = await chrome.tabs.get(meetTabId);
    if (meetTab.windowId) await chrome.windows.update(meetTab.windowId, { focused: true });
  } catch { /* ignore */ }

  isRecording = true;
  recordingTabId = meetTabId;
  recordingStartTime = Date.now();
  currentFileSize = 0;
  currentQuality = quality;
  currentMeetingId = meetingId;
  micAudioBase64 = null;
  updateBadge(true);

  // Notify content script
  try { chrome.tabs.sendMessage(meetTabId, { type: 'RECORDING_STARTED' }); } catch { /* ignore */ }
  await sendConsentNotification(meetTabId);
}

// ─── Consent Notification ───────────────────────────────────────
async function sendConsentNotification(meetTabId: number): Promise<void> {
  const stored = await chrome.storage.local.get('settings');
  const settings = stored.settings || DEFAULT_SETTINGS;
  if (settings.autoConsent) {
    try {
      chrome.tabs.sendMessage(meetTabId, {
        type: 'SEND_CONSENT_NOTIFICATION',
        payload: { message: settings.consentMessage },
      });
    } catch { /* ignore */ }
  }
}

// ─── Pause/Resume Recording ─────────────────────────────────────
async function pauseRecording(): Promise<void> {
  if (!isRecording || isPaused) return;

  if (useRecorderTab && recorderTabId) {
    try { await chrome.tabs.sendMessage(recorderTabId, { type: 'PAUSE_RECORDING' }); } catch { /* ignore */ }
  } else {
    try { await chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' }); } catch { /* ignore */ }
  }

  isPaused = true;
  pausedAt = Date.now();
  chrome.action.setBadgeText({ text: '⏸' });
  chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });

  if (recordingTabId) {
    try { chrome.tabs.sendMessage(recordingTabId, { type: 'PAUSE_RECORDING' }); } catch { /* ignore */ }
  }
}

async function resumeRecording(): Promise<void> {
  if (!isRecording || !isPaused) return;

  if (useRecorderTab && recorderTabId) {
    try { await chrome.tabs.sendMessage(recorderTabId, { type: 'RESUME_RECORDING' }); } catch { /* ignore */ }
  } else {
    try { await chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' }); } catch { /* ignore */ }
  }

  totalPausedDuration += Date.now() - pausedAt;
  isPaused = false;
  pausedAt = 0;
  updateBadge(true);

  if (recordingTabId) {
    try { chrome.tabs.sendMessage(recordingTabId, { type: 'RESUME_RECORDING' }); } catch { /* ignore */ }
  }
}

// ─── Stop Recording ─────────────────────────────────────────────
async function stopRecording(): Promise<void> {
  if (!isRecording) return;

  if (useRecorderTab && recorderTabId) {
    try { await chrome.tabs.sendMessage(recorderTabId, { type: 'STOP_RECORDING' }); } catch { /* ignore */ }
  } else {
    try { await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }); } catch { resetState(); }
  }

  if (recordingTabId) {
    try { chrome.tabs.sendMessage(recordingTabId, { type: 'RECORDING_STOPPED' }); } catch { /* ignore */ }
  }
}

// ─── Save Recording Metadata ────────────────────────────────────
async function saveRecordingMetadata(data: { fileSize: number; filename: string; meetingId: string; recordingId?: string; micCaptured?: boolean }): Promise<void> {
  const meetId = data.meetingId || currentMeetingId || 'unknown';
  const recId = data.recordingId || `rec_${Date.now()}`;

  // If mic was captured, remember for future (skip recorder tab next time)
  if (data.micCaptured) {
    await chrome.storage.local.set({ micPermissionGranted: true });
    console.log('[Meet Recorder] Mic permission saved for future recordings');
  }

  const historyEntry: RecordingHistoryEntry = {
    id: recId,
    meetingId: meetId,
    filename: data.filename,
    date: new Date().toISOString(),
    duration: Date.now() - recordingStartTime,
    fileSize: data.fileSize,
    quality: currentQuality,
    hasTranscript: false,
    savedToStore: !!data.recordingId,
  };

  const stored = await chrome.storage.local.get('recordingHistory');
  const history: RecordingHistoryEntry[] = stored.recordingHistory || [];
  history.unshift(historyEntry);
  if (history.length > 100) history.length = 100;
  await chrome.storage.local.set({ recordingHistory: history });

  resetState();
  if (!useRecorderTab) {
    setTimeout(() => closeOffscreenDocument(), 5000);
  }

  // Auto-transcribe
  if (data.recordingId) {
    autoTranscribe(recId, data.filename);
  }
}

// ─── Auto Transcribe ────────────────────────────────────────────
async function autoTranscribe(recordingId: string, filename: string): Promise<void> {
  try {
    const settingsStored = await chrome.storage.local.get('settings');
    const settings: ExtensionSettings = settingsStored.settings || DEFAULT_SETTINGS;

    if (!settings.autoTranscribe || !settings.groqApiKey) {
      micAudioBase64 = null;
      return;
    }

    if (!micAudioBase64) {
      await new Promise((r) => setTimeout(r, 3000));
    }

    const record = await getRecording(recordingId);
    let mainTranscript = '';
    if (record) {
      try {
        console.log('[Meet Recorder] Transcribing recording:', (record.blob.size / 1024 / 1024).toFixed(1), 'MB');
        const result = await transcribeRecording(record.blob, settings.groqApiKey);
        mainTranscript = formatTranscript(result);
        console.log('[Meet Recorder] Transcript done, language:', result.language);
      } catch (err: any) {
        console.warn('[Meet Recorder] Transcription failed:', err?.message);
      }
    }

    // Also transcribe mic separately if main transcript missed user's voice
    let micTranscript = '';
    if (micAudioBase64) {
      try {
        const binaryStr = atob(micAudioBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const micBlob = new Blob([bytes], { type: 'audio/webm' });
        const micResult = await transcribeRecording(micBlob, settings.groqApiKey);
        micTranscript = formatTranscript(micResult);
      } catch { /* ignore */ }
    }

    micAudioBase64 = null;

    // Combine transcripts
    let finalTranscript = '';
    if (mainTranscript && micTranscript) {
      finalTranscript = '═══ Meeting Recording ═══\n' + mainTranscript + '\n\n═══ Your Voice (Mic) ═══\n' + micTranscript;
    } else {
      finalTranscript = mainTranscript || micTranscript;
    }
    if (!finalTranscript) return;

    const b64 = btoa(unescape(encodeURIComponent(finalTranscript)));
    chrome.downloads.download({
      url: 'data:text/plain;base64,' + b64,
      filename: filename.replace('.webm', '-transcript.txt'),
      saveAs: false,
    });

    const histStored = await chrome.storage.local.get('recordingHistory');
    const history: RecordingHistoryEntry[] = histStored.recordingHistory || [];
    const entry = history.find((h) => h.id === recordingId);
    if (entry) {
      entry.hasTranscript = true;
      await chrome.storage.local.set({ recordingHistory: history });
    }

    console.log('[Meet Recorder] Transcript downloaded!');
  } catch (err: any) {
    console.error('[Meet Recorder] Transcription failed:', err?.message || err);
    micAudioBase64 = null;
  }
}

// ─── Message Handler ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  const isFromContentScript = sender.tab?.id != null;
  const isFromRecorderOrOffscreen = sender.url?.includes('recorder.html') || sender.url?.includes('offscreen.html');

  switch (message.type) {
    case 'GET_STATUS': {
      const currentPausedDuration = isPaused
        ? totalPausedDuration + (Date.now() - pausedAt)
        : totalPausedDuration;
      sendResponse({
        isRecording,
        isPaused,
        duration: isRecording ? Date.now() - recordingStartTime - currentPausedDuration : 0,
        pausedDuration: currentPausedDuration,
        fileSize: currentFileSize,
        quality: currentQuality,
        meetingId: currentMeetingId,
      } as RecordingStatusPayload);
      return false;
    }

    case 'START_RECORDING': {
      if (isFromRecorderOrOffscreen) return false; // Don't re-handle
      const { quality, meetingId } = message.payload;
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0];
        if (!tab?.id || !tab.url?.includes('meet.google.com')) {
          sendResponse({ error: 'Please open a Google Meet tab first.' });
          return;
        }
        try {
          await startRecording(tab.id, quality, meetingId);
          sendResponse({ success: true });
        } catch (err: any) {
          sendResponse({ error: err.message });
        }
      });
      return true;
    }

    case 'STOP_RECORDING': {
      if (!isFromRecorderOrOffscreen) {
        stopRecording().then(() => sendResponse({ success: true }));
        return true;
      }
      return false;
    }

    case 'PAUSE_RECORDING': {
      if (!isFromRecorderOrOffscreen) {
        pauseRecording().then(() => sendResponse({ success: true }));
        return true;
      }
      return false;
    }

    case 'RESUME_RECORDING': {
      if (!isFromRecorderOrOffscreen) {
        resumeRecording().then(() => sendResponse({ success: true }));
        return true;
      }
      return false;
    }

    case 'RECORDING_STOPPED': {
      if (isFromRecorderOrOffscreen) {
        saveRecordingMetadata(message.payload);
      }
      return false;
    }

    case 'UPDATE_FILE_SIZE': {
      currentFileSize = message.payload?.fileSize || 0;
      return false;
    }

    case 'MIC_AUDIO_DATA': {
      if (message.payload?.data) {
        micAudioBase64 = message.payload.data;
        console.log('[Meet Recorder] Received mic audio:', (message.payload.size / 1024).toFixed(0), 'KB');
      }
      return false;
    }

    case 'AUTO_START_RECORDING': {
      if (isRecording || !isFromContentScript || !sender.tab?.id) return false;
      const tabId = sender.tab.id;
      (async () => {
        try {
          const stored = await chrome.storage.local.get('settings');
          const settings = stored.settings || DEFAULT_SETTINGS;
          const quality: RecordingQuality = settings.defaultQuality || 'medium';
          const mid = message.payload?.meetingId || 'unknown';
          await startRecording(tabId, quality, mid);
        } catch (err: any) {
          console.error('[Meet Recorder] Auto-start failed:', err.message);
        }
      })();
      return false;
    }

    case 'MEETING_ENDED': {
      if (isRecording && isFromContentScript && sender.tab?.id === recordingTabId) {
        stopRecording();
      }
      return false;
    }

    case 'RECORDING_ERROR': {
      resetState();
      if (recorderTabId) chrome.tabs.remove(recorderTabId).catch(() => {});
      closeOffscreenDocument();
      return false;
    }
  }
});

// ─── Tab handlers ────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  if (isRecording && tabId === recordingTabId) stopRecording();
  if (isRecording && tabId === recorderTabId) {
    resetState();
    if (recordingTabId) {
      try { chrome.tabs.sendMessage(recordingTabId, { type: 'RECORDING_STOPPED' }); } catch { /* ignore */ }
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (isRecording && tabId === recordingTabId && changeInfo.url && !changeInfo.url.includes('meet.google.com')) {
    stopRecording();
  }
});

// ─── Install ─────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('settings');
  if (!stored.settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  updateBadge(false);
});
