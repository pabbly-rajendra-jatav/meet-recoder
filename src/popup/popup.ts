import './popup.css';
import { RecordingStatusPayload, QUALITY_PRESETS, RecordingQuality, ExtensionMessage } from '../types/messages';

// ─── DOM Elements ────────────────────────────────────────────────
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
const recordBtnText = document.getElementById('record-btn-text') as HTMLSpanElement;
const recordIcon = document.getElementById('record-icon') as unknown as SVGElement;
const statusBadge = document.getElementById('status-badge') as HTMLSpanElement;
const timerEl = document.getElementById('timer') as HTMLSpanElement;
const fileSizeEl = document.getElementById('file-size') as HTMLSpanElement;
const currentQualityEl = document.getElementById('current-quality') as HTMLSpanElement;
const qualitySelector = document.getElementById('quality-selector') as HTMLDivElement;
const qualitySelect = document.getElementById('quality') as HTMLSelectElement;
const recordingInfo = document.getElementById('recording-info') as HTMLDivElement;
const notOnMeet = document.getElementById('not-on-meet') as HTMLDivElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;

let isRecording = false;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let recordingStartTime = 0;

// ─── Formatting Helpers ──────────────────────────────────────────
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── UI State Management ─────────────────────────────────────────
function updateUI(status: RecordingStatusPayload): void {
  isRecording = status.isRecording;

  if (isRecording) {
    recordingStartTime = Date.now() - status.duration;

    // Show recording state
    statusBadge.textContent = 'Recording';
    statusBadge.className = 'badge badge-recording';
    recordBtnText.textContent = 'Stop Recording';
    recordBtn.className = 'btn btn-stop';
    recordIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2"/>';

    qualitySelector.style.display = 'none';
    recordingInfo.style.display = 'block';
    notOnMeet.style.display = 'none';

    currentQualityEl.textContent = QUALITY_PRESETS[status.quality].label;
    fileSizeEl.textContent = formatFileSize(status.fileSize);

    startTimer();
  } else {
    // Show idle state
    statusBadge.textContent = 'Ready';
    statusBadge.className = 'badge badge-idle';
    recordBtnText.textContent = 'Start Recording';
    recordBtn.className = 'btn btn-start';
    recordIcon.innerHTML = '<circle cx="12" cy="12" r="8"/>';

    qualitySelector.style.display = 'block';
    recordingInfo.style.display = 'none';

    stopTimer();
  }
}

// ─── Timer ───────────────────────────────────────────────────────
function startTimer(): void {
  stopTimer();
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - recordingStartTime;
    timerEl.textContent = formatDuration(elapsed);
  }, 1000);
  // Update immediately
  timerEl.textContent = formatDuration(Date.now() - recordingStartTime);
}

function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerEl.textContent = '00:00:00';
}

// ─── Check if on Google Meet Tab ─────────────────────────────────
async function checkMeetTab(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const onMeet = !!tab?.url?.includes('meet.google.com/');
      resolve(onMeet);
    });
  });
}

// ─── Extract Meeting ID from URL ─────────────────────────────────
async function getMeetingId(): Promise<string> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const match = tab?.url?.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
      resolve(match ? match[1] : 'unknown');
    });
  });
}

// ─── Record Button Handler ───────────────────────────────────────
recordBtn.addEventListener('click', async () => {
  recordBtn.disabled = true;

  try {
    if (isRecording) {
      // Stop recording
      const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' } as ExtensionMessage);
      if (response?.error) {
        console.error('Stop error:', response.error);
      }
    } else {
      // Get mic permission from popup first — this grants permission
      // to the entire extension origin (including recorder window)
      recordBtnText.textContent = 'Requesting mic...';
      try {
        const tempMic = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempMic.getTracks().forEach((t) => t.stop());
      } catch {
        // Mic denied — recording will only have remote audio
      }

      recordBtnText.textContent = 'Starting...';

      const quality = qualitySelect.value as RecordingQuality;
      const meetingId = await getMeetingId();

      const response = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        payload: { quality, meetingId },
      } as ExtensionMessage);

      if (response?.error) {
        alert(response.error);
      }
    }
  } catch (err: any) {
    console.error('Action error:', err);
    alert(err.message || 'An error occurred');
  }

  // Refresh status after a brief delay
  setTimeout(refreshStatus, 500);
  recordBtn.disabled = false;
});

// ─── Settings Button ─────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ─── Refresh Status ──────────────────────────────────────────────
async function refreshStatus(): Promise<void> {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' } as ExtensionMessage);
    if (status) {
      updateUI(status as RecordingStatusPayload);
    }
  } catch (err) {
    console.warn('Could not get status:', err);
  }
}

// ─── Load saved quality preference ───────────────────────────────
async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get('settings');
  if (stored.settings?.defaultQuality) {
    qualitySelect.value = stored.settings.defaultQuality;
  }
}

// ─── Periodic status polling ─────────────────────────────────────
let statusInterval: ReturnType<typeof setInterval> | null = null;

function startStatusPolling(): void {
  statusInterval = setInterval(async () => {
    if (isRecording) {
      try {
        const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' } as ExtensionMessage);
        if (status) {
          fileSizeEl.textContent = formatFileSize((status as RecordingStatusPayload).fileSize);
        }
      } catch {
        // ignore
      }
    }
  }, 2000);
}

// ─── Initialize ──────────────────────────────────────────────────
async function init(): Promise<void> {
  await loadSettings();

  const onMeet = await checkMeetTab();
  if (!onMeet && !isRecording) {
    notOnMeet.style.display = 'flex';
    recordBtn.disabled = true;
  }

  await refreshStatus();
  startStatusPolling();
}

init();
