import './settings.css';
import { ExtensionSettings, DEFAULT_SETTINGS, RecordingHistoryEntry } from '../types/messages';
import { getRecording, deleteRecording, clearAllRecordings, getAllRecordingIds } from '../utils/videoStore';

// ─── DOM Elements ────────────────────────────────────────────────
const defaultQualitySelect = document.getElementById('default-quality') as HTMLSelectElement;
const autoConsentCheckbox = document.getElementById('auto-consent') as HTMLInputElement;
const consentMessageTextarea = document.getElementById('consent-message') as HTMLTextAreaElement;
const consentMessageGroup = document.getElementById('consent-message-group') as HTMLDivElement;
const autoStartCheckbox = document.getElementById('auto-start') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const saveStatus = document.getElementById('save-status') as HTMLSpanElement;
const historyList = document.getElementById('history-list') as HTMLDivElement;
const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLButtonElement;
const autoTranscribeCheckbox = document.getElementById('auto-transcribe') as HTMLInputElement;
const groqApiKeyInput = document.getElementById('groq-api-key') as HTMLInputElement;
const groqKeyGroup = document.getElementById('groq-key-group') as HTMLDivElement;
const saveTranscriptionBtn = document.getElementById('save-transcription-btn') as HTMLButtonElement;
const saveTranscriptionStatus = document.getElementById('save-transcription-status') as HTMLSpanElement;
const testApiBtn = document.getElementById('test-api-btn') as HTMLButtonElement;

// ─── Load Settings ───────────────────────────────────────────────
async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get('settings');
  const settings: ExtensionSettings = stored.settings || DEFAULT_SETTINGS;

  defaultQualitySelect.value = settings.defaultQuality;
  autoConsentCheckbox.checked = settings.autoConsent;
  consentMessageTextarea.value = settings.consentMessage;
  autoStartCheckbox.checked = settings.autoStart;
  autoTranscribeCheckbox.checked = settings.autoTranscribe;
  groqApiKeyInput.value = settings.groqApiKey;

  updateConsentMessageVisibility();
  updateGroqKeyVisibility();
}

// ─── Save Settings ───────────────────────────────────────────────
async function saveSettings(): Promise<void> {
  const stored = await chrome.storage.local.get('settings');
  const existing: ExtensionSettings = stored.settings || DEFAULT_SETTINGS;

  const settings: ExtensionSettings = {
    ...existing,
    defaultQuality: defaultQualitySelect.value as any,
    autoConsent: autoConsentCheckbox.checked,
    autoStart: autoStartCheckbox.checked,
    consentMessage: consentMessageTextarea.value || DEFAULT_SETTINGS.consentMessage,
  };

  await chrome.storage.local.set({ settings });

  saveStatus.textContent = 'Saved!';
  saveStatus.classList.add('visible');
  setTimeout(() => saveStatus.classList.remove('visible'), 2000);
}

// ─── Save Transcription Settings ────────────────────────────────
async function saveTranscriptionSettings(): Promise<void> {
  const stored = await chrome.storage.local.get('settings');
  const existing: ExtensionSettings = stored.settings || DEFAULT_SETTINGS;

  const settings: ExtensionSettings = {
    ...existing,
    autoTranscribe: autoTranscribeCheckbox.checked,
    groqApiKey: groqApiKeyInput.value.trim(),
  };

  if (settings.autoTranscribe && !settings.groqApiKey) {
    alert('Please enter your Groq API key to enable auto-transcription.');
    return;
  }

  await chrome.storage.local.set({ settings });

  saveTranscriptionStatus.textContent = 'Saved!';
  saveTranscriptionStatus.classList.add('visible');
  setTimeout(() => saveTranscriptionStatus.classList.remove('visible'), 2000);
}

// ─── Toggle consent message visibility ───────────────────────────
function updateConsentMessageVisibility(): void {
  consentMessageGroup.style.display = autoConsentCheckbox.checked ? 'block' : 'none';
}

// ─── Toggle Groq API key visibility ─────────────────────────────
function updateGroqKeyVisibility(): void {
  groqKeyGroup.style.display = autoTranscribeCheckbox.checked ? 'block' : 'none';
}

// ─── Format Helpers ──────────────────────────────────────────────
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Load Recording History ──────────────────────────────────────
async function loadHistory(): Promise<void> {
  const stored = await chrome.storage.local.get('recordingHistory');
  const history: RecordingHistoryEntry[] = stored.recordingHistory || [];

  // Get list of IDs actually stored in IndexedDB
  let storedIds: string[] = [];
  try {
    storedIds = await getAllRecordingIds();
  } catch { /* ignore */ }

  if (history.length === 0) {
    historyList.innerHTML = '<p class="empty-state">No recordings yet.</p>';
    return;
  }

  historyList.innerHTML = history
    .map(
      (entry) => {
        const hasVideo = storedIds.includes(entry.id);
        return `
    <div class="history-item">
      <div class="history-item-info">
        <div class="history-item-name">${escapeHtml(entry.filename)}</div>
        <div class="history-item-meta">
          ${formatDate(entry.date)} &middot; ${formatDuration(entry.duration)} &middot; ${formatFileSize(entry.fileSize)}
        </div>
      </div>
      <div class="history-item-actions">
        <span class="quality-badge">${entry.quality}</span>
        ${entry.hasTranscript ? '<span class="transcript-badge">Transcript</span>' : ''}
        ${hasVideo ? `
          <button class="btn-icon btn-download" data-id="${entry.id}" data-filename="${escapeHtml(entry.filename)}" title="Download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button class="btn-icon btn-delete" data-id="${entry.id}" title="Delete saved video">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        ` : '<span class="expired-badge">Expired</span>'}
      </div>
    </div>
  `;
      }
    )
    .join('');

  // Attach download handlers
  historyList.querySelectorAll('.btn-download').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id!;
      const filename = (btn as HTMLElement).dataset.filename!;
      try {
        const record = await getRecording(id);
        if (!record) { alert('Video not found. It may have expired.'); loadHistory(); return; }
        const url = URL.createObjectURL(record.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (err) {
        alert('Failed to download video.');
        console.error(err);
      }
    });
  });

  // Attach delete handlers
  historyList.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id!;
      if (!confirm('Delete this saved video? This cannot be undone.')) return;
      try {
        await deleteRecording(id);
        loadHistory();
      } catch (err) {
        alert('Failed to delete video.');
        console.error(err);
      }
    });
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Clear History ───────────────────────────────────────────────
async function clearHistory(): Promise<void> {
  if (confirm('Are you sure you want to clear all recording history and saved videos?')) {
    await chrome.storage.local.set({ recordingHistory: [] });
    try { await clearAllRecordings(); } catch { /* ignore */ }
    loadHistory();
  }
}

// ─── Test API Key ───────────────────────────────────────────────
async function testApiKey(): Promise<void> {
  const apiKey = groqApiKeyInput.value.trim();
  if (!apiKey) {
    alert('Please enter your Groq API key first.');
    return;
  }

  testApiBtn.disabled = true;
  testApiBtn.textContent = 'Testing...';

  try {
    // Send a tiny silent audio to test the API key
    const ctx = new OfflineAudioContext(1, 16000, 16000); // 1 second of silence
    const buffer = ctx.createBuffer(1, 16000, 16000);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    const rendered = await ctx.startRendering();

    // Encode as WAV
    const wavBlob = audioBufferToWav(rendered);

    const formData = new FormData();
    formData.append('file', wavBlob, 'test.wav');
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (response.ok) {
      alert('API key is working! Transcription will work after recording.');
    } else {
      const err = await response.text();
      alert(`API key test failed (${response.status}): ${err}`);
    }
  } catch (err: any) {
    alert('Test failed: ' + (err?.message || 'Unknown error'));
  }

  testApiBtn.disabled = false;
  testApiBtn.textContent = 'Test API Key';
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numChannels * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);
  const data = buffer.getChannelData(0);

  // WAV header
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, length, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

// ─── Event Listeners ─────────────────────────────────────────────
saveBtn.addEventListener('click', saveSettings);
clearHistoryBtn.addEventListener('click', clearHistory);
autoConsentCheckbox.addEventListener('change', updateConsentMessageVisibility);
saveTranscriptionBtn.addEventListener('click', saveTranscriptionSettings);
autoTranscribeCheckbox.addEventListener('change', updateGroqKeyVisibility);
testApiBtn.addEventListener('click', testApiKey);

// ─── Initialize ──────────────────────────────────────────────────
loadSettings();
loadHistory();
