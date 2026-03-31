import { ExtensionMessage } from '../types/messages';

// ─── State ───────────────────────────────────────────────────────
let meetingActive = false;
let meetingCheckInterval: ReturnType<typeof setInterval> | null = null;
let meetingJoinCheckInterval: ReturnType<typeof setInterval> | null = null;
let wasInMeeting = false;
let isCurrentlyRecording = false;
let recordingStartTime = 0;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let autoStartTriggered = false;

// ─── Extract Meeting ID ──────────────────────────────────────────
function getMeetingId(): string {
  const match = window.location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
  return match ? match[1] : 'unknown';
}

// ─── Recording Indicator ────────────────────────────────────────
function showRecordingIndicator(): void {
  removeRecordingIndicator();
  recordingStartTime = Date.now();

  const indicator = document.createElement('div');
  indicator.id = 'meet-recorder-indicator';
  indicator.innerHTML = `
    <style>
      @keyframes meetRecSlideIn {
        from { opacity: 0; transform: translateX(80px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes meetRecPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      #meet-rec-stop-pill:hover { background: rgba(0,0,0,0.5) !important; }
    </style>
    <div style="
      position: fixed; top: 20px; right: 20px; z-index: 999999;
      background: #1e293b; color: #fff; border-radius: 20px;
      padding: 8px 16px; box-shadow: 0 4px 16px rgba(30,41,59,0.4);
      font-family: 'Segoe UI', -apple-system, sans-serif;
      font-size: 13px; font-weight: 600;
      display: flex; align-items: center; gap: 8px;
      animation: meetRecSlideIn 0.4s ease-out;
    ">
      <div style="
        width: 8px; height: 8px; border-radius: 50%;
        background: #ef4444; animation: meetRecPulse 1.5s ease-in-out infinite;
      "></div>
      <span id="meet-rec-timer">REC 00:00</span>
      <button id="meet-rec-stop-pill" style="
        margin-left: 6px; padding: 4px 10px; border: none; border-radius: 12px;
        background: rgba(0,0,0,0.3); color: #fff; font-size: 11px; font-weight: 600;
        cursor: pointer; font-family: inherit;
      ">Stop</button>
    </div>
  `;

  document.body.appendChild(indicator);

  document.getElementById('meet-rec-stop-pill')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' } as ExtensionMessage);
  });

  const timerEl = document.getElementById('meet-rec-timer');
  timerInterval = setInterval(() => {
    if (!isCurrentlyRecording) { if (timerInterval) clearInterval(timerInterval); return; }
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const sec = String(elapsed % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `REC ${min}:${sec}`;
  }, 1000);
}

function removeRecordingIndicator(): void {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const indicator = document.getElementById('meet-recorder-indicator');
  if (indicator) indicator.remove();
}

// ─── Meeting End Detection ───────────────────────────────────────
const MEETING_CONTROL_SELECTORS = [
  'button[aria-label*="microphone" i]',
  'button[aria-label*="camera" i]',
  'button[aria-label*="mic" i]',
  'button[aria-label*="video" i]',
  '[data-is-muted]',
  'button[data-tooltip*="microphone" i]',
  'button[data-tooltip*="camera" i]',
].join(', ');

const POST_MEETING_SELECTORS = [
  'button[aria-label*="Rejoin" i]',
  'button[aria-label*="Return to home" i]',
  'a[aria-label*="Return to home" i]',
  '[data-call-ended]',
].join(', ');

function hasMeetingControls(): boolean {
  return !!document.querySelector(MEETING_CONTROL_SELECTORS);
}

function checkMeetingEnd(): void {
  if (!!document.querySelector(POST_MEETING_SELECTORS)) { onMeetingEnded(); return; }

  const bodyText = document.body.innerText || '';
  const endIndicators = [
    'You left the meeting', 'You\'ve left the meeting',
    'The meeting has ended', 'You were removed from the meeting',
    'Meeting ended for everyone', 'Return to home screen',
    'You\'ve been removed', 'The call ended',
  ];
  for (const indicator of endIndicators) {
    if (bodyText.includes(indicator) && !hasMeetingControls()) { onMeetingEnded(); return; }
  }

  const hasControls = hasMeetingControls();
  if (wasInMeeting && !hasControls) { onMeetingEnded(); return; }
  if (hasControls) wasInMeeting = true;
}

function onMeetingEnded(): void {
  if (!meetingActive && !isCurrentlyRecording) return;
  meetingActive = false; wasInMeeting = false;

  if (isCurrentlyRecording) {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' } as ExtensionMessage);
  }
  chrome.runtime.sendMessage({ type: 'MEETING_ENDED' } as ExtensionMessage);
  isCurrentlyRecording = false;
  removeRecordingIndicator();
  if (meetingCheckInterval) { clearInterval(meetingCheckInterval); meetingCheckInterval = null; }
}

function startMeetingEndDetection(): void {
  if (meetingCheckInterval) return;
  wasInMeeting = true; meetingActive = true;
  meetingCheckInterval = setInterval(checkMeetingEnd, 1500);
}

// ─── Leave Button Detection ────────────────────────────────────
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target || !isCurrentlyRecording) return;
  const btn = target.closest(
    'button[aria-label*="Leave" i], button[aria-label*="hang up" i], ' +
    'button[aria-label*="end call" i], button[aria-label*="leave call" i], ' +
    'button[data-tooltip*="Leave" i], button[data-tooltip*="hang up" i]'
  );
  if (btn) {
    setTimeout(() => { if (!hasMeetingControls()) onMeetingEnded(); }, 2000);
  }
}, true);

// ─── Auto-Start Detection ──────────────────────────────────────
function startMeetingJoinDetection(): void {
  if (meetingJoinCheckInterval) return;
  meetingJoinCheckInterval = setInterval(async () => {
    const hasControls = !!document.querySelector(
      'button[aria-label*="microphone" i], button[aria-label*="camera" i], [data-is-muted]'
    );
    if (hasControls && !autoStartTriggered && !isCurrentlyRecording) {
      autoStartTriggered = true;
      if (meetingJoinCheckInterval) { clearInterval(meetingJoinCheckInterval); meetingJoinCheckInterval = null; }
      try {
        const stored = await chrome.storage.local.get('settings');
        if (stored.settings?.autoStart) {
          chrome.runtime.sendMessage({
            type: 'AUTO_START_RECORDING',
            payload: { meetingId: getMeetingId() },
          } as ExtensionMessage);
        }
      } catch { /* ignore */ }
    }
  }, 2000);
}

startMeetingJoinDetection();

// ─── Consent Notification ──────────────────────────────────────
function sendConsentNotification(message: string): void {
  setTimeout(() => {
    try {
      const chatBtn = document.querySelector('button[aria-label*="chat" i]') as HTMLElement | null;
      if (chatBtn) {
        chatBtn.click();
        setTimeout(() => {
          const input = document.querySelector('textarea[aria-label*="Send a message" i], textarea[aria-label*="Everyone" i]') as HTMLTextAreaElement | null;
          if (input) {
            input.focus(); input.value = message;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(() => {
              const send = document.querySelector('button[aria-label*="Send" i]') as HTMLElement | null;
              if (send) send.click();
            }, 300);
          }
        }, 500);
      }
    } catch { /* ignore */ }
  }, 1000);
}

// ─── Message Listener ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'SEND_CONSENT_NOTIFICATION':
      sendConsentNotification(message.payload.message);
      sendResponse({ success: true });
      return false;

    case 'RECORDING_STARTED':
      isCurrentlyRecording = true;
      showRecordingIndicator();
      startMeetingEndDetection();
      sendResponse({ success: true });
      return false;

    case 'RECORDING_STOPPED':
      isCurrentlyRecording = false;
      removeRecordingIndicator();
      meetingActive = false; wasInMeeting = false;
      if (meetingCheckInterval) { clearInterval(meetingCheckInterval); meetingCheckInterval = null; }
      sendResponse({ success: true });
      return false;
  }
});
