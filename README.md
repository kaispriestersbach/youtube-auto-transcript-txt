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
6. It creates a local `.txt` file with a Blob download.

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

YouTube does not provide a stable public transcript API for browser extensions. Some newer auto transcripts, especially `variant=gemini` tracks, can expose a track but return empty timedtext responses. In those cases the extension shows an instruction instead of downloading an empty file.

If YouTube's own transcript panel is already open and visible, the extension can also read visible transcript segment text from the page.

## Development Checks

```sh
node --check background.js
node --check content.js
jq . manifest.json
```

## License

MIT
