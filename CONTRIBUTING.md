# Contributing

Contributions are welcome if they keep the extension narrow and privacy-preserving.

## Principles

- Keep permissions minimal.
- Do not add analytics, tracking, or telemetry.
- Do not add a backend dependency.
- Do not add remote JavaScript.
- Prefer readable vanilla JavaScript over build tooling unless tooling becomes clearly necessary.
- Document YouTube behavior changes honestly instead of silently producing empty transcript files.

## Local Checks

```sh
node --check background.js
node --check content.js
jq . manifest.json
```
