// ─── OpenAI Whisper Transcription ───────────────────────────────
// Transcribes audio using OpenAI's Whisper API.
// Supports Hindi, English, Hinglish and auto language detection.

const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB OpenAI limit

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  language: string;
}

/** Transcribe a recording blob via OpenAI Whisper */
export async function transcribeRecording(
  blob: Blob,
  apiKey: string
): Promise<TranscriptResult> {
  console.log('[Meet Recorder] Blob size:', (blob.size / 1024 / 1024).toFixed(1), 'MB, type:', blob.type);

  if (blob.size > MAX_FILE_SIZE) {
    throw new Error(`Recording too large (${(blob.size / 1024 / 1024).toFixed(0)} MB). Max 25 MB. Use lower quality for longer recordings.`);
  }

  const formData = new FormData();
  formData.append('file', blob, 'recording.webm');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('prompt', 'This audio contains conversation in Hindi, English, and Hinglish (mixed Hindi-English). Transcribe exactly as spoken, keeping Hindi in Devanagari script and English in Latin script.');

  console.log('[Meet Recorder] Sending to OpenAI Whisper API...');

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  return {
    text: data.text || '',
    segments: (data.segments || []).map((s: any) => ({
      start: s.start || 0,
      end: s.end || 0,
      text: s.text || '',
    })),
    language: data.language || 'unknown',
  };
}

/** Format transcript result into readable text */
export function formatTranscript(result: TranscriptResult): string {
  const lines: string[] = [];
  lines.push(`Language: ${result.language}`);
  lines.push('─'.repeat(50));
  lines.push('');

  if (result.segments.length > 0) {
    for (const seg of result.segments) {
      const startTime = formatTime(seg.start);
      const endTime = formatTime(seg.end);
      lines.push(`[${startTime} → ${endTime}]  ${seg.text.trim()}`);
    }
  } else {
    lines.push(result.text);
  }

  return lines.join('\n');
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
