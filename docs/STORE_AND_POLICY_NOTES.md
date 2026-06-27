# Store And Policy Notes

This extension is designed for private or team use and may be suitable for unlisted distribution. Public Chrome Web Store distribution should be evaluated carefully because YouTube does not expose a stable public transcript export API.

The implementation is intentionally conservative from a Chrome extension security perspective:

- narrow host permission
- no remote code
- no third-party transcript service
- no analytics
- no persistent storage

The YouTube-side limitation is different: some transcript tracks are visible in player metadata but return empty timedtext responses to browser extension fetches. The extension should never claim guaranteed transcript export for every video.
