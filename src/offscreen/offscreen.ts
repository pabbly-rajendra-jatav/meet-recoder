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
let combinedStream: MediaStream | null = null;
let currentMeetingId = '';
let lastRecordingBlob: Blob | null = null;
let lastFilename = '';

// ─── Start Recording ─────────────────────────────────────────────
async function startRecording(payload: StartRecordingPayload): Promise<void> {
  const qualityCfg = QUALITY_PRESETS[payload.quality];
  currentMeetingId = payload.meetingId;

  // 1. Capture tab audio + video
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

  // 2. Play tab audio back to user (tabCapture mutes tab by default)
  try {
    const playbackEl = document.createElement('audio');
    playbackEl.id = 'meet-rec-playback';
    playbackEl.srcObject = new MediaStream(tabStream.getAudioTracks().map((t) => t.clone()));
    playbackEl.volume = 1.0;
    document.body.appendChild(playbackEl);
    await playbackEl.play();
  } catch { /* ignore */ }

  // 3. Capture mic — try multiple approaches with retries
  micStream = null;
  if (payload.includeMic) {
    // Wait for mic permission to propagate from popup
    await new Promise((r) => setTimeout(r, 500));

    // Approach 1: standard getUserMedia
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      console.log('[Meet Recorder] ✓ Mic captured (standard)');
    } catch (e: any) {
      console.warn('[Meet Recorder] Mic approach 1 failed:', e?.message);
    }

    // Approach 2: explicit device
    if (!micStream) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mic = devices.find((d) => d.kind === 'audioinput');
        console.log('[Meet Recorder] Found mic device:', mic?.label || mic?.deviceId || 'none');
        if (mic) {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: mic.deviceId } },
            video: false,
          });
          console.log('[Meet Recorder] ✓ Mic captured (explicit device)');
        }
      } catch (e: any) {
        console.warn('[Meet Recorder] Mic approach 2 failed:', e?.message);
      }
    }

    // Approach 3: retry after longer delay with minimal constraints
    if (!micStream) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        console.log('[Meet Recorder] ✓ Mic captured (retry with minimal constraints)');
      } catch (e: any) {
        console.warn('[Meet Recorder] Mic approach 3 failed:', e?.message);
      }
    }

    if (micStream) {
      console.log('[Meet Recorder] ✓ Mic active tracks:', micStream.getAudioTracks().length);
    } else {
      console.error('[Meet Recorder] ✗ ALL mic approaches failed! Check mic permission in popup.');
    }
  }

  // 4. Build final stream
  const tabVideoTracks = tabStream.getVideoTracks();
  const tabAudioTracks = tabStream.getAudioTracks();

  if (micStream && micStream.getAudioTracks().length > 0) {
    // Mix tab audio + mic audio using AudioContext
    audioContext = new AudioContext();
    await audioContext.resume(); // Critical for offscreen

    const destination = audioContext.createMediaStreamDestination();

    // Tab audio
    if (tabAudioTracks.length > 0) {
      const tabSource = audioContext.createMediaStreamSource(new MediaStream(tabAudioTracks));
      tabSource.connect(destination);
    }

    // Mic audio with strong gain boost for clear voice capture
    const micSource = audioContext.createMediaStreamSource(micStream);
    const gain = audioContext.createGain();
    gain.gain.value = 3.0; // Strong boost so mic voice is clearly captured
    micSource.connect(gain);
    gain.connect(destination);
    console.log('[Meet Recorder] Mic mixed into recording with 3x gain');

    const mixedAudio = destination.stream.getAudioTracks();

    if (qualityCfg.video) {
      combinedStream = new MediaStream([...tabVideoTracks, ...mixedAudio]);
    } else {
      combinedStream = destination.stream;
    }
  } else {
    // No mic — use tab stream directly (at least tab audio will work)
    combinedStream = tabStream;
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

  mediaRecorder = new MediaRecorder(combinedStream, options);
  recordedChunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onerror = (event: any) => {
    chrome.runtime.sendMessage({
      type: 'RECORDING_ERROR',
      payload: { error: event.error?.message || 'Recording error' },
    });
    cleanup();
  };

  mediaRecorder.onstop = () => finishRecording();
  mediaRecorder.start();

  // Report mic status to background
  chrome.runtime.sendMessage({
    type: 'UPDATE_FILE_SIZE',
    payload: { fileSize: 0, micCaptured: !!micStream },
  });
}

// ─── Stop Recording ──────────────────────────────────────────────
function stopRecording(): void {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

// ─── Finish & Download ───────────────────────────────────────────
async function finishRecording(): Promise<void> {
  if (recordedChunks.length === 0) {
    chrome.runtime.sendMessage({
      type: 'RECORDING_ERROR',
      payload: { error: 'No data recorded' },
    });
    cleanup();
    return;
  }

  const mimeType = recordedChunks[0].type || 'video/webm';
  const blob = new Blob(recordedChunks, { type: mimeType });
  const fileSize = blob.size;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  const meetId = currentMeetingId || 'unknown';
  const filename = `meet-${meetId}-${dateStr}-${timeStr}.webm`;
  const recordingId = `rec_${Date.now()}`;

  // Save blob for potential merge with mic audio later
  lastRecordingBlob = blob;
  lastFilename = filename;

  // Save blob to IndexedDB
  try {
    await cleanupOldRecordings();
    await saveRecording(recordingId, blob, filename);
    console.log('[Meet Recorder] Video saved to IndexedDB:', filename);
  } catch (err) {
    console.warn('[Meet Recorder] Failed to save video to IndexedDB:', err);
  }

  // Check if offscreen mic was captured
  const hadMic = !!micStream && micStream.getAudioTracks().length > 0;

  chrome.runtime.sendMessage({
    type: 'RECORDING_STOPPED',
    payload: { fileSize, filename, meetingId: meetId, recordingId, micCaptured: hadMic },
  });

  cleanup();

  if (hadMic) {
    // Mic was in recording already, download immediately
    downloadBlob(blob, filename);
    lastRecordingBlob = null;
    lastFilename = '';
  } else {
    // Wait for mic audio from content script to merge
    console.log('[Meet Recorder] Waiting for mic audio to merge...');
    // Auto-download after 10 sec if no mic audio arrives (fallback)
    setTimeout(() => {
      if (lastRecordingBlob) {
        console.log('[Meet Recorder] No mic audio received, downloading without mic');
        downloadBlob(lastRecordingBlob, lastFilename);
        lastRecordingBlob = null;
        lastFilename = '';
      }
    }, 10000);
  }
}

// ─── Download Helper ────────────────────────────────────────────
function downloadBlob(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 10000);
}

// ─── Merge Mic Audio into Video ─────────────────────────────────
async function mergeAudioWithVideo(videoBlob: Blob, micBase64: string, filename: string): Promise<void> {
  console.log('[Meet Recorder] Starting audio merge...');

  // Decode mic audio from base64
  const binaryStr = atob(micBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const micBlob = new Blob([bytes], { type: 'audio/webm' });

  // Create media elements
  const video = document.createElement('video');
  video.src = URL.createObjectURL(videoBlob);
  video.muted = true;

  const mic = document.createElement('audio');
  mic.src = URL.createObjectURL(micBlob);
  mic.muted = true;

  // Wait for both to load
  await Promise.all([
    new Promise<void>((resolve) => { video.onloadedmetadata = () => resolve(); }),
    new Promise<void>((resolve) => { mic.onloadedmetadata = () => resolve(); }),
  ]);

  // Create AudioContext to mix both
  const ctx = new AudioContext();
  await ctx.resume();

  const dest = ctx.createMediaStreamDestination();

  // Video audio source
  const videoStream: MediaStream = (video as any).captureStream ? (video as any).captureStream() : (video as any).mozCaptureStream();
  if (videoStream.getAudioTracks().length > 0) {
    const videoSource = ctx.createMediaStreamSource(new MediaStream(videoStream.getAudioTracks()));
    videoSource.connect(dest);
  }

  // Mic audio source with gain boost
  const micStream: MediaStream = (mic as any).captureStream ? (mic as any).captureStream() : (mic as any).mozCaptureStream();
  if (micStream.getAudioTracks().length > 0) {
    const micSource = ctx.createMediaStreamSource(new MediaStream(micStream.getAudioTracks()));
    const gain = ctx.createGain();
    gain.gain.value = 2.5;
    micSource.connect(gain);
    gain.connect(dest);
  }

  // Combined stream: video tracks + mixed audio
  const videoTracks = videoStream.getVideoTracks();
  const mixedStream = new MediaStream([...videoTracks, ...dest.stream.getAudioTracks()]);

  // Record merged stream
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus' : 'video/webm';
  const recorder = new MediaRecorder(mixedStream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const mergedFilename = filename.replace('.webm', '-merged.webm');

  recorder.onstop = () => {
    const mergedBlob = new Blob(chunks, { type: mimeType });
    console.log('[Meet Recorder] Merge complete:', (mergedBlob.size / 1024 / 1024).toFixed(1), 'MB');
    downloadBlob(mergedBlob, mergedFilename);

    // Cleanup
    URL.revokeObjectURL(video.src);
    URL.revokeObjectURL(mic.src);
    ctx.close().catch(() => {});
    video.remove();
    mic.remove();
  };

  // Play both and record
  recorder.start();
  video.muted = false;
  video.volume = 0;
  mic.muted = false;
  mic.volume = 0;

  // Speed up playback for faster merge
  video.playbackRate = 4.0;
  mic.playbackRate = 4.0;

  video.play();
  mic.play();

  video.onended = () => {
    if (recorder.state === 'recording') recorder.stop();
  };

  // Safety timeout
  const duration = video.duration || 300;
  setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop();
  }, (duration / 4 + 5) * 1000);

  console.log('[Meet Recorder] Merging... duration:', video.duration?.toFixed(0), 'sec');
}

// ─── Cleanup ─────────────────────────────────────────────────────
function cleanup(): void {
  const playbackEl = document.getElementById('meet-rec-playback') as HTMLAudioElement | null;
  if (playbackEl) { playbackEl.pause(); playbackEl.srcObject = null; playbackEl.remove(); }

  if (tabStream) { tabStream.getTracks().forEach((t) => t.stop()); tabStream = null; }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
  combinedStream = null;
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

    case 'MERGE_MIC_AUDIO':
      if (lastRecordingBlob && message.payload?.data) {
        console.log('[Meet Recorder] Mic audio received, starting merge...');
        mergeAudioWithVideo(lastRecordingBlob, message.payload.data, lastFilename)
          .then(() => {
            lastRecordingBlob = null;
            lastFilename = '';
          })
          .catch((err: any) => {
            console.error('[Meet Recorder] Merge failed:', err?.message);
            // Fallback: download without mic
            if (lastRecordingBlob) downloadBlob(lastRecordingBlob, lastFilename);
            lastRecordingBlob = null;
            lastFilename = '';
          });
      } else if (!lastRecordingBlob) {
        console.warn('[Meet Recorder] No recording blob to merge with');
      }
      sendResponse({ success: true });
      return false;
  }
});
