# Privacy Policy — Google Meet Recorder

**Last Updated:** March 30, 2026

## Overview

Google Meet Recorder is a Chrome browser extension that allows users to record Google Meet sessions locally on their device. We are committed to protecting your privacy and being transparent about our data practices.

## Data Collection

**We do NOT collect, store, transmit, or share any personal data.**

This extension operates entirely on your local device. No data is sent to any external server, cloud service, or third party.

## What the Extension Accesses

| Data | Purpose | Stored Where |
|---|---|---|
| Google Meet tab audio/video | To record the meeting | Locally on your device |
| Microphone audio | To capture your voice in the recording | Locally on your device |
| Meeting captions (if enabled) | To generate a text transcript | Locally on your device |
| Extension settings | To save your preferences (quality, auto-start, etc.) | Chrome's local storage (on your device) |
| Recording history | To show past recording metadata | Chrome's local storage (on your device) |
| Recorded video files | To allow re-download from history | Browser's IndexedDB (on your device, auto-deleted after 7 days) |

## Data Storage

- All recordings are saved **locally on your device** as `.webm` files.
- Recording metadata (filename, date, duration, size) is stored in Chrome's local storage.
- Video blobs are temporarily stored in the browser's IndexedDB for up to **7 days** to allow re-download, after which they are automatically deleted.
- No data is uploaded to any server or cloud service.

## Data Sharing

**We do NOT share any data with third parties.** Since no data leaves your device, there is nothing to share.

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

**Email:** [your-email@example.com]

---

*This extension is not affiliated with, endorsed by, or sponsored by Google.*
