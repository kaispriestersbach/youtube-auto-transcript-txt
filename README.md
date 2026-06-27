# YouTube Auto Transcript TXT

A small Manifest V3 Chrome extension that saves YouTube auto-generated transcripts as local `.txt` files.

The extension is intentionally narrow:

- no backend
- no account
- no analytics or tracking
- no DownSub or other third-party service
- no remote JavaScript
- no `identity`, `webRequest`, `storage`, or `downloads` permission

## How It Works

1. Open a YouTube video.
2. Click the extension icon.
3. The extension briefly primes YouTube's own captions module.
4. It reads the current page's caption track metadata.
5. It fetches transcript data from YouTube in the current browser session.
6. If YouTube's player created a richer timedtext URL for captions, the extension retries that exact URL locally.
7. It creates a local `.txt` file with a Blob download.

The transcript text is not sent to any non-YouTube service.

## Install From Source

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this repository folder.
6. Open a YouTube video and click the extension icon.

## Permissions

```json
{
  "permissions": ["activeTab", "scripting"],
  "host_permissions": ["https://www.youtube.com/*"]
}
```

`activeTab` and `scripting` are used only after the extension icon is clicked. The YouTube host permission is scoped to YouTube pages.

## Known Limitation

YouTube does not provide a stable public transcript API for browser extensions. Some newer auto transcripts, especially `variant=gemini` tracks, can expose a track but return empty timedtext responses. In those cases the extension does not download an empty file.

Version 0.1.9 also tries to reuse timedtext URLs that the YouTube player itself created during caption initialization. If YouTube's own player request or transcript panel contains visible/readable segments, the extension can read those locally. If YouTube's player request, transcript panel, and `get_transcript` endpoint all return no segments or `FAILED_PRECONDITION`, a purely client-side TXT export is currently not possible for that video.

## Development Checks

```sh
node --check background.js
node --check content.js
jq . manifest.json
```

## License

MIT
