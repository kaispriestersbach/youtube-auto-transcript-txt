# Security

## Supported Version

Only the latest version in the repository is supported.

## Reporting Issues

Please open a GitHub issue for security-relevant bugs that do not expose private user data. If a report includes sensitive details, avoid posting secrets, tokens, private URLs, or personal transcripts in public issues.

## Permission Model

The extension uses:

- `activeTab`
- `scripting`
- `https://www.youtube.com/*`

It does not use:

- `identity`
- `webRequest`
- `storage`
- `downloads`
- `<all_urls>`
- remote code execution
- `eval` or `new Function`

## Scope

This project is a browser-side utility for local transcript export. It is not affiliated with YouTube, Google, or DownSub.
