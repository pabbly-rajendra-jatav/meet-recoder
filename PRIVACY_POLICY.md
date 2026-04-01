# Privacy Policy — Meet Recorder

**Last Updated:** April 1, 2026

## Overview

Meet Recorder is a Chrome browser extension that allows users to record Google Meet sessions locally on their device, with optional AI-powered transcription. We are committed to protecting your privacy and being transparent about our data practices.

## Data Collection

**We do NOT collect, store, or share any personal data on our own servers.**

This extension operates primarily on your local device. The only exception is the optional transcription feature, which sends audio data to OpenAI's Whisper API if you enable it and provide your own API key (see "Transcription Service" section below).

## What the Extension Accesses

| Data | Purpose | Stored Where |
|---|---|---|
| Google Meet tab audio/video | To record the meeting | Locally on your device |
| Microphone audio | To capture your voice in the recording | Locally on your device |
| Microphone audio (for transcription) | To generate a text transcript via OpenAI Whisper API (only if enabled) | Sent to OpenAI, not stored by us |
| Extension settings | To save your preferences (quality, auto-start, etc.) | Chrome's local storage (on your device) |
| Recording history | To show past recording metadata | Chrome's local storage (on your device) |
| Recorded video files | To allow re-download from history | Browser's IndexedDB (on your device, auto-deleted after 7 days) |

## Data Storage

- All recordings are saved **locally on your device** as `.webm` files.
- Recording metadata (filename, date, duration, size) is stored in Chrome's local storage.
- Video blobs are temporarily stored in the browser's IndexedDB for up to **7 days** to allow re-download, after which they are automatically deleted.
- No data is uploaded to any server or cloud service.

## Transcription Service (Optional)

If you enable the **Auto Transcribe** feature and provide your own OpenAI API key:

- Your recorded audio is sent to **OpenAI's Whisper API** for speech-to-text transcription.
- This is the **only** scenario where data leaves your device.
- The API key is stored locally in Chrome's storage — we never see or store it.
- The transcribed text is saved locally on your device.
- OpenAI's data handling is governed by their own [Privacy Policy](https://openai.com/privacy) and [API Data Usage Policy](https://openai.com/policies/api-data-usage-policies).
- **If you do not enable transcription, no data ever leaves your device.**

## Data Sharing

**We do NOT share any data with third parties.** The only external communication is the optional transcription feature described above, which is initiated by the user and uses the user's own API key.

## Permissions Used

| Permission | Why It's Needed |
|---|---|
| `activeTab` | To access the current Google Meet tab for recording |
| `tabCapture` | To capture audio and video from the Google Meet tab |
| `offscreen` | To process and record audio/video in the background |
| `downloads` | To save the recorded file to your device |
| `storage` | To save your extension settings and recording history |
| `tabs` | To detect when you are on a Google Meet page |
| `host_permissions` (meet.google.com) | To interact with Google Meet pages for recording, captions, and UI indicators |

## Auto-Consent Notification

If enabled, the extension can automatically post a message in the Google Meet chat to notify other participants that the meeting is being recorded. This message is sent within Google Meet's own chat — no external service is involved.

## Children's Privacy

This extension is not directed at children under the age of 13. We do not knowingly collect any information from children.

## Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be reflected in the "Last Updated" date above.

## Contact

If you have any questions about this Privacy Policy, please contact:

**Email:** rajendra.jatav@pabbly.com

---

*This extension is not affiliated with, endorsed by, or sponsored by Google.*
