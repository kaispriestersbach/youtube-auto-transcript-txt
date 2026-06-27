# Changelog

## 0.1.9

- Add a client-side fallback that replays YouTube `api/timedtext` URLs created by the player during caption initialization.
- Keep permissions unchanged while covering player-generated timedtext URLs that contain runtime-only parameters such as `pot`, `xorb`, `xobt`, or `xovt`.

## 0.1.8

- Detect newer `variant=gemini` auto-transcript tracks that YouTube exposes but does not provide to browser extensions.
- Show a specific unsupported-state message when YouTube's own transcript panel also returns no segments.
- Avoid the misleading manual transcript-panel retry hint for these empty Gemini transcript responses.

## 0.1.7

- Add Chrome extension icons in 16, 32, 48, and 128 px sizes.
- Add toolbar and extension listing icon declarations.
- Keep permissions limited to `activeTab`, `scripting`, and `https://www.youtube.com/*`.

## 0.1.6

- Prime YouTube's own captions module before transcript fetch attempts.
- Add clearer failure messaging for empty YouTube transcript responses.

## 0.1.5

- Document the `variant=gemini` empty transcript limitation.
- Improve user-facing fallback guidance.
