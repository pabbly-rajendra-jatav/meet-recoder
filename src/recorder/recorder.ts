import {
  ExtensionMessage,
  StartRecordingPayload,
  QUALITY_PRESETS,
} from '../types/messages';
import { saveRecording, cleanupOldRecordings } from '../utils/videoStore';

// ─── State ────────────────────────────────────────────────────────
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let tabStream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let currentMeetingId = '';
let startTime = 0;
let timerInterval: ReturnType<typeof setInterval> | null = null;

// Separate mic recording for transcription
let micRecorder: MediaRecorder | null = null;
let micChunks: Blob[] = [];

const timerEl = document.getElementById('timer')!;
const statusEl = document.getElementById('status')!;
const micBtn = document.getElementById('mic-btn') as HTMLButtonElement;

// ─── Mic Capture ────────────────────────────────────────────────
async function tryCaptureMic(): Promise<void> {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    statusEl.textContent = 'Recording (mic ✓)';
    statusEl.className = 'status mic-ok';
    micBtn.style.display = 'none';
    console.log('[Recorder] ✓ Mic captured!');
  } catch (err: any) {
    console.warn('[Recorder] Mic failed:', err?.name, err?.message);
    statusEl.textContent = 'No mic — click button below';
    statusEl.className = 'status mic-fail';
    micBtn.style.display = 'inline-block';
  }
}

// Mic button click handler — user gesture allows permission prompt
micBtn.addEventListener('click', async () => {
  micBtn.textContent = 'Requesting...';
  micBtn.disabled = true;
  await tryCaptureMic();

  // If mic captured and recording is active, add mic to ongoing recording
  if (micStream && mediaRecorder && mediaRecorder.state === 'recording' && tabStream) {
    addMicToRecording();
  }
  micBtn.disabled = false;
  micBtn.textContent = 'Allow Microphone';
});

function addMicToRecording(): void {
  if (!micStream || !tabStream || !mediaRecorder) return;

  // Stop current recorder
  mediaRecorder.onstop = null;
  mediaRecorder.stop();

  // Build new mixed stream
  const tabAudioTracks = tabStream.getAudioTracks();
  const tabVideoTracks = tabStream.getVideoTracks();

  audioContext = new AudioContext();
  audioContext.resume();
  const destination = audioContext.createMediaStreamDestination();

  if (tabAudioTracks.length > 0) {
    const tabSource = audioContext.createMediaStreamSource(new MediaStream(tabAudioTracks));
    tabSource.connect(destination);
  }

  const micSource = audioContext.createMediaStreamSource(micStream);
  const gain = audioContext.createGain();
  gain.gain.value = 2.5;
  micSource.connect(gain);
  gain.connect(destination);

  const mixedAudio = destination.stream.getAudioTracks();
  const newStream = new MediaStream([...tabVideoTracks, ...mixedAudio]);

  // Start new recorder with mixed stream
  const mimeType = mediaRecorder.mimeType;
  mediaRecorder = new MediaRecorder(newStream, { mimeType });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => finishRecording();
  mediaRecorder.onerror = () => {
    chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', payload: { error: 'Recording error' } });
    cleanup();
  };
  mediaRecorder.start(1000);

  // Start separate mic recording for transcription
  const micMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : 'audio/webm';
  micRecorder = new MediaRecorder(micStream, { mimeType: micMime });
  micChunks = [];
  micRecorder.ondataavailable = (e) => { if (e.data.size > 0) micChunks.push(e.data); };
  micRecorder.start(1000);

  console.log('[Recorder] ✓ Mic added to ongoing recording!');
}

// ─── Start Recording ─────────────────────────────────────────────
async function startRecording(payload: StartRecordingPayload): Promise<void> {
  const qualityCfg = QUALITY_PRESETS[payload.quality];
  currentMeetingId = payload.meetingId;

  // 1. Capture tab audio + video via tabCapture stream ID
  const constraints: MediaStreamConstraints = {
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: payload.streamId,
      },
    } as any,
  };

  if (qualityCfg.video) {
    constraints.video = {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: payload.streamId,
        maxWidth: qualityCfg.width,
        maxHeight: qualityCfg.height,
      },
    } as any;
  }

  tabStream = await navigator.mediaDevices.getUserMedia(constraints);
  console.log('[Recorder] Tab stream captured, audio tracks:', tabStream.getAudioTracks().length);

  // 2. Play tab audio back to user (tabCapture mutes the tab)
  try {
    const playbackEl = document.createElement('audio');
    playbackEl.id = 'tab-playback';
    playbackEl.srcObject = new MediaStream(tabStream.getAudioTracks().map((t) => t.clone()));
    playbackEl.volume = 1.0;
    document.body.appendChild(playbackEl);
    await playbackEl.play();
    console.log('[Recorder] Tab audio playback started');
  } catch { /* ignore */ }

  // 3. Capture mic
  await tryCaptureMic();

  // 4. Build combined stream
  const tabVideoTracks = tabStream.getVideoTracks();
  const tabAudioTracks = tabStream.getAudioTracks();
  let finalStream: MediaStream;

  if (micStream && micStream.getAudioTracks().length > 0) {
    // Mix tab audio + mic audio
    audioContext = new AudioContext();
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();

    if (tabAudioTracks.length > 0) {
      const tabSource = audioContext.createMediaStreamSource(new MediaStream(tabAudioTracks));
      tabSource.connect(destination);
    }

    const micSource = audioContext.createMediaStreamSource(micStream);
    const gain = audioContext.createGain();
    gain.gain.value = 2.5;
    micSource.connect(gain);
    gain.connect(destination);

    const mixedAudio = destination.stream.getAudioTracks();

    if (qualityCfg.video) {
      finalStream = new MediaStream([...tabVideoTracks, ...mixedAudio]);
    } else {
      finalStream = destination.stream;
    }

    console.log('[Recorder] ✓ Audio mixed: tab + mic');

    // Start separate mic recording for transcription
    const micMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    micRecorder = new MediaRecorder(micStream, { mimeType: micMime });
    micChunks = [];
    micRecorder.ondataavailable = (e) => { if (e.data.size > 0) micChunks.push(e.data); };
    micRecorder.start(1000);
  } else {
    finalStream = tabStream;
  }

  // 5. Setup MediaRecorder
  const mimeTypes = qualityCfg.video
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm'];

  let selectedMime = '';
  for (const mime of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mime)) { selectedMime = mime; break; }
  }

  const options: MediaRecorderOptions = {};
  if (selectedMime) options.mimeType = selectedMime;
  if (qualityCfg.video) options.videoBitsPerSecond = qualityCfg.videoBitsPerSecond;
  options.audioBitsPerSecond = qualityCfg.audioBitsPerSecond;

  mediaRecorder = new MediaRecorder(finalStream, options);
  recordedChunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onerror = () => {
    chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', payload: { error: 'Recording error' } });
    cleanup();
  };

  mediaRecorder.onstop = () => finishRecording();
  mediaRecorder.start(1000);

  // Start timer
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const sec = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${min}:${sec}`;
  }, 1000);

  // Report to background
  chrome.runtime.sendMessage({
    type: 'UPDATE_FILE_SIZE',
    payload: { fileSize: 0, micCaptured: !!micStream },
  });

  console.log('[Recorder] Recording started!');
}

// ─── Stop Recording ──────────────────────────────────────────────
function stopRecording(): void {
  if (micRecorder && micRecorder.state === 'recording') micRecorder.stop();
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}

// ─── Finish & Download ───────────────────────────────────────────
async function finishRecording(): Promise<void> {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  if (recordedChunks.length === 0) {
    chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', payload: { error: 'No data recorded' } });
    cleanup();
    return;
  }

  statusEl.textContent = 'Saving...';

  const mimeType = recordedChunks[0].type || 'video/webm';
  const blob = new Blob(recordedChunks, { type: mimeType });
  const fileSize = blob.size;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  const meetId = currentMeetingId || 'unknown';
  const filename = `meet-${meetId}-${dateStr}-${timeStr}.webm`;
  const recordingId = `rec_${Date.now()}`;

  // Download video
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 10000);

  // Save to IndexedDB
  try {
    await cleanupOldRecordings();
    await saveRecording(recordingId, blob, filename);
  } catch { /* ignore */ }

  // Send mic audio for transcription (wait for it to complete)
  if (micChunks.length > 0) {
    const micBlob = new Blob(micChunks, { type: 'audio/webm' });
    micChunks = [];
    await new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        chrome.runtime.sendMessage({
          type: 'MIC_AUDIO_DATA',
          payload: { data: base64, size: micBlob.size },
        });
        resolve();
      };
      reader.onerror = () => resolve();
      reader.readAsDataURL(micBlob);
    });
  }

  // Notify background (after mic data is sent)
  chrome.runtime.sendMessage({
    type: 'RECORDING_STOPPED',
    payload: { fileSize, filename, meetingId: meetId, recordingId, micCaptured: !!micStream },
  });

  cleanup();
  statusEl.textContent = 'Transcribing...';

  // Keep window open longer for transcription to start
  setTimeout(() => {
    statusEl.textContent = 'Done!';
    setTimeout(() => window.close(), 1000);
  }, 5000);
}

// ─── Cleanup ─────────────────────────────────────────────────────
function cleanup(): void {
  const playbackEl = document.getElementById('tab-playback') as HTMLAudioElement | null;
  if (playbackEl) { playbackEl.pause(); playbackEl.srcObject = null; playbackEl.remove(); }
  if (tabStream) { tabStream.getTracks().forEach((t) => t.stop()); tabStream = null; }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
  mediaRecorder = null;
  recordedChunks = [];
}

// ─── Message Handler ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'START_RECORDING':
      startRecording(message.payload as StartRecordingPayload)
        .then(() => sendResponse({ success: true }))
        .catch((err: any) => sendResponse({ error: err.message }));
      return true;

    case 'STOP_RECORDING':
      stopRecording();
      sendResponse({ success: true });
      return false;
  }
});
