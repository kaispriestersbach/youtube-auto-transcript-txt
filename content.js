(() => {
  "use strict";

  if (window.__ytAutoTranscriptTxtContentScriptLoaded) return;
  window.__ytAutoTranscriptTxtContentScriptLoaded = true;

  const MESSAGE_TYPE = "YTAT_SAVE_AS_TXT";
  const TOAST_ID = "yt-auto-transcript-txt-toast";
  const STYLE_ID = "yt-auto-transcript-txt-style";

  let activeDownload = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) return false;

    runDownload()
      .then((result) => sendResponse(result))
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : String(error);
        showToast(messageText);
        console.error("[YouTube Auto Transcript TXT]", error);
        sendResponse({ ok: false, error: messageText });
      });

    return true;
  });

  async function runDownload() {
    if (activeDownload) return activeDownload;
    activeDownload = downloadTranscript().finally(() => {
      activeDownload = null;
    });
    return activeDownload;
  }

  async function downloadTranscript() {
    const videoId = getVideoId();
    if (!videoId) throw new Error("Kein YouTube-Video erkannt.");

    showToast("Auto-Transkript wird geladen ...");

    const title = getVisibleTitle(videoId);
    const playerResponse = await loadPlayerResponse(videoId);
    const track = selectAutoTrack(playerResponse);
    if (!track) {
      throw new Error("Für dieses Video wurde kein Auto-Transkript gefunden.");
    }

    let cues = await fetchTranscriptCues(track);
    if (cues.length === 0) {
      cues = await fetchTranscriptCuesFromInnertube(videoId);
    }
    if (cues.length === 0) {
      showToast("YouTube-Transkriptpanel wird geöffnet ...");
      cues = await fetchTranscriptCuesFromPanel();
    }
    const body = cuesToPlainText(cues);
    if (!body.trim()) {
      throw new Error("YouTube hat das Transkript nicht direkt freigegeben. Oeffne im Videotext einmal 'Transkript anzeigen' und klicke dann erneut auf das Extension-Icon.");
    }

    const filename = `${safeFilename(title)}.${track.languageCode || "auto"}.auto-transcript.txt`;
    triggerTextDownload(filename, body);
    showToast("TXT-Transkript wurde lokal erstellt.");
    return { ok: true, filename };
  }

  function getVideoId() {
    const url = new URL(location.href);
    const watchId = url.searchParams.get("v");
    if (watchId) return watchId;
    const shortsMatch = location.pathname.match(/^\/shorts\/([^/?#]+)/);
    return shortsMatch ? shortsMatch[1] : "";
  }

  function getVisibleTitle(videoId) {
    const selectors = [
      "h1.ytd-watch-metadata yt-formatted-string",
      "h1 yt-formatted-string",
      "ytd-watch-metadata h1",
      "yt-formatted-string.ytd-video-primary-info-renderer"
    ];
    for (const selector of selectors) {
      const text = document.querySelector(selector)?.textContent?.trim();
      if (text) return text;
    }
    const cleaned = document.title.replace(/\s+-\s+YouTube\s*$/i, "").trim();
    return cleaned || videoId || "youtube-transcript";
  }

  async function loadPlayerResponse(videoId) {
    const fromDom = readPlayerResponseFromHtml(document.documentElement.innerHTML);
    if (fromDom?.captions) return fromDom;

    const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
      credentials: "include"
    });
    if (!response.ok) {
      throw new Error(`YouTube-Seite konnte nicht gelesen werden (${response.status}).`);
    }
    const html = await response.text();
    const fromFetch = readPlayerResponseFromHtml(html);
    if (fromFetch?.captions) return fromFetch;

    throw new Error("YouTube-Playerdaten enthalten keine Transkriptspuren.");
  }

  function readPlayerResponseFromHtml(html) {
    const markers = [
      "var ytInitialPlayerResponse =",
      "ytInitialPlayerResponse ="
    ];

    for (const marker of markers) {
      const markerIndex = html.indexOf(marker);
      if (markerIndex === -1) continue;
      const objectStart = html.indexOf("{", markerIndex + marker.length);
      if (objectStart === -1) continue;
      const json = readBalancedObject(html, objectStart);
      if (!json) continue;
      try {
        return JSON.parse(json);
      } catch {
        continue;
      }
    }
    return null;
  }

  function readBalancedObject(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
    return "";
  }

  function selectAutoTrack(playerResponse) {
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    return tracks.find((track) => track.kind === "asr" && track.baseUrl) || null;
  }

  async function fetchTranscriptCuesFromInnertube(videoId) {
    const pageHtml = document.documentElement.innerHTML;
    const apiKey = extractYtConfigString(pageHtml, "INNERTUBE_API_KEY");
    const context = extractYtConfigObject(pageHtml, "INNERTUBE_CONTEXT");
    const params = extractTranscriptParams(pageHtml, videoId);
    if (!apiKey || !context || !params) return [];

    const endpoint = `/youtubei/v1/get_transcript?prettyPrint=false&key=${encodeURIComponent(apiKey)}`;
    const client = context.client || {};
    const headers = {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": "1",
      "X-YouTube-Client-Version": String(client.clientVersion || "")
    };

    for (const candidateParams of uniqueValues([params, safeDecodeURIComponent(params)])) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ context, params: candidateParams })
        });
        if (!response.ok) {
          console.warn("[YouTube Auto Transcript TXT] get_transcript failed", response.status);
          continue;
        }
        const data = await response.json();
        const cues = extractTranscriptCuesFromInnertubeResponse(data);
        if (cues.length > 0) return cues;
      } catch (error) {
        console.warn("[YouTube Auto Transcript TXT] get_transcript threw", error);
      }
    }

    return [];
  }

  function extractYtConfigString(html, key) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = html.match(new RegExp(`"${escapedKey}"\\s*:\\s*"([^"]+)"`));
    return match ? decodeJsonString(match[1]) : "";
  }

  function extractYtConfigObject(html, key) {
    const keyIndex = html.indexOf(`"${key}"`);
    if (keyIndex === -1) return null;
    const objectStart = html.indexOf("{", keyIndex);
    if (objectStart === -1) return null;
    const json = readBalancedObject(html, objectStart);
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function extractTranscriptParams(html, videoId) {
    const initialData = readInitialDataFromHtml(html);
    const fromData = findTranscriptParamsInValue(initialData, videoId);
    if (fromData) return fromData;

    const directMatch = html.match(/"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/);
    return directMatch ? decodeJsonString(directMatch[1]) : "";
  }

  function readInitialDataFromHtml(html) {
    const markers = [
      "var ytInitialData =",
      "ytInitialData =",
      "window[\"ytInitialData\"] ="
    ];
    for (const marker of markers) {
      const markerIndex = html.indexOf(marker);
      if (markerIndex === -1) continue;
      const objectStart = html.indexOf("{", markerIndex + marker.length);
      if (objectStart === -1) continue;
      const json = readBalancedObject(html, objectStart);
      if (!json) continue;
      try {
        return JSON.parse(json);
      } catch {
        continue;
      }
    }
    return null;
  }

  function findTranscriptParamsInValue(value, videoId) {
    let fallback = "";
    const seen = new Set();
    const stack = [value];

    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);

      if (current.getTranscriptEndpoint?.params) {
        const params = String(current.getTranscriptEndpoint.params);
        const decoded = decodeTranscriptParamsForMatching(params);
        if (decoded.includes(videoId)) return params;
        fallback ||= params;
      }

      if (Array.isArray(current)) {
        for (const item of current) stack.push(item);
      } else {
        for (const item of Object.values(current)) stack.push(item);
      }
    }

    return fallback;
  }

  function decodeTranscriptParamsForMatching(value) {
    try {
      return atob(safeDecodeURIComponent(value).replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      return "";
    }
  }

  function extractTranscriptCuesFromInnertubeResponse(data) {
    const cues = [];
    const seen = new Set();
    const stack = [{ value: data, inheritedStartMs: 0 }];

    while (stack.length) {
      const { value, inheritedStartMs } = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);

      const group = value.transcriptCueGroupRenderer;
      if (group) {
        const groupStartMs = parseYoutubeTimeText(textFromRuns(group.formattedStartOffset)) ?? inheritedStartMs;
        stack.push({ value: group.cues || [], inheritedStartMs: groupStartMs });
        continue;
      }

      const cueRenderer = value.transcriptCueRenderer || value.transcriptSegmentRenderer;
      if (cueRenderer) {
        const cue = cueFromTranscriptRenderer(cueRenderer, inheritedStartMs);
        if (cue.text) cues.push(cue);
      }

      if (Array.isArray(value)) {
        for (const item of value) stack.push({ value: item, inheritedStartMs });
      } else {
        for (const item of Object.values(value)) stack.push({ value: item, inheritedStartMs });
      }
    }

    return mergeDuplicateCues(cues.reverse());
  }

  function cueFromTranscriptRenderer(renderer, fallbackStartMs) {
    const text =
      textFromRuns(renderer.cue) ||
      textFromRuns(renderer.snippet) ||
      textFromRuns(renderer.text) ||
      textFromRuns(renderer.line) ||
      "";
    const startMs =
      numericMs(renderer.startOffsetMs) ??
      numericMs(renderer.startMs) ??
      numericMs(renderer.startTimeMs) ??
      parseYoutubeTimeText(textFromRuns(renderer.startTimeText)) ??
      fallbackStartMs;
    return { startMs, text: cleanCueText(text) };
  }

  function textFromRuns(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value.simpleText === "string") return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map((run) => run.text || "").join("");
    if (Array.isArray(value)) return value.map(textFromRuns).filter(Boolean).join(" ");
    return "";
  }

  function numericMs(value) {
    const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseYoutubeTimeText(value) {
    const match = value.match(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/);
    if (!match) return null;
    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    return ((hours * 60 + minutes) * 60 + seconds) * 1000;
  }

  function decodeJsonString(value) {
    try {
      return JSON.parse(`"${value.replace(/"/g, "\\\"")}"`);
    } catch {
      return value;
    }
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
  }

  async function fetchTranscriptCues(track) {
    const formats = ["json3", "srv3", "vtt", ""];
    let lastError = null;

    for (const format of formats) {
      const url = buildCaptionUrl(track, format);
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) {
          lastError = new Error(`Transkript konnte nicht geladen werden (${response.status}).`);
          continue;
        }

        const text = await response.text();
        const cues = parseTranscriptPayload(text, format);
        if (cues.length > 0) return cues;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (lastError) {
      console.warn("[YouTube Auto Transcript TXT] timedtext fallback needed:", lastError);
    }
    return [];
  }

  function buildCaptionUrl(track, format) {
    const url = new URL(track.baseUrl);
    if (format) url.searchParams.set("fmt", format);
    else url.searchParams.delete("fmt");
    if (track.languageCode) url.searchParams.set("lang", track.languageCode);
    if (track.kind === "asr") url.searchParams.set("kind", "asr");
    return url.toString();
  }

  function parseTranscriptPayload(text, requestedFormat) {
    const trimmed = text.trim();
    if (!trimmed) return [];

    if (requestedFormat === "json3" || trimmed.startsWith("{")) {
      try {
        return parseJson3(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }

    if (requestedFormat === "vtt" || /^WEBVTT/i.test(trimmed)) {
      return parseVtt(trimmed);
    }

    return parseXmlTranscript(trimmed);
  }

  function parseJson3(data) {
    const cues = [];
    const events = Array.isArray(data?.events) ? data.events : [];
    for (const event of events) {
      if (event?.aAppend === 1 || !Array.isArray(event?.segs)) continue;
      const text = cleanCueText(event.segs.map((segment) => segment?.utf8 || "").join(""));
      if (!text) continue;
      cues.push({
        startMs: Number.isFinite(event.tStartMs) ? event.tStartMs : 0,
        text
      });
    }
    return mergeDuplicateCues(cues);
  }

  function parseXmlTranscript(xmlText) {
    const parsed = new DOMParser().parseFromString(xmlText, "text/xml");
    const textNodes = [...parsed.querySelectorAll("text")];
    if (textNodes.length > 0) {
      return textNodes
        .map((node) => ({
          startMs: Math.round(Number.parseFloat(node.getAttribute("start") || "0") * 1000),
          text: cleanCueText(node.textContent || "")
        }))
        .filter((cue) => cue.text);
    }

    const pNodes = [...parsed.querySelectorAll("p")];
    return pNodes
      .map((node) => ({
        startMs: parseSrv3Start(node.getAttribute("t")),
        text: cleanCueText(node.textContent || "")
      }))
      .filter((cue) => cue.text);
  }

  function parseSrv3Start(value) {
    const parsed = Number.parseFloat(value || "0");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseVtt(vttText) {
    const cues = [];
    const blocks = vttText
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    for (const block of blocks) {
      if (/^WEBVTT/i.test(block) || /^NOTE\b/i.test(block)) continue;
      const lines = block.split("\n").filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex === -1) continue;
      const text = cleanCueText(lines.slice(timingIndex + 1).join(" "));
      if (!text) continue;
      cues.push({ startMs: parseVttStart(lines[timingIndex]), text });
    }
    return mergeDuplicateCues(cues);
  }

  function parseVttStart(line) {
    const start = line.split("-->")[0]?.trim() || "";
    const parts = start.split(":").map((part) => Number.parseFloat(part.replace(",", ".")));
    if (parts.some((part) => !Number.isFinite(part))) return 0;
    if (parts.length === 3) return Math.round(((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000);
    if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000);
    return Math.round(parts[0] * 1000);
  }

  function cleanCueText(value) {
    return decodeEntities(value)
      .replace(/<[^>]+>/g, " ")
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function decodeEntities(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function mergeDuplicateCues(cues) {
    const merged = [];
    for (const cue of cues) {
      const previous = merged[merged.length - 1];
      if (previous && previous.text === cue.text && Math.abs(previous.startMs - cue.startMs) < 1000) {
        continue;
      }
      merged.push(cue);
    }
    return merged;
  }

  async function fetchTranscriptCuesFromPanel() {
    const existing = scrapeVisibleTranscript();
    if (existing.length > 0) return existing;

    await revealDescription();
    const button = findTranscriptButton();
    if (!button) {
      showToast("Kein sichtbarer YouTube-Button 'Transkript anzeigen' gefunden.");
      return [];
    }

    await clickElement(button);
    const cues = await waitForTranscriptSegments(12000);
    if (cues.length === 0) {
      showToast("YouTube blockiert das automatische Oeffnen. Bitte 'Transkript anzeigen' manuell anklicken und danach das Extension-Icon erneut klicken.");
    }
    return cues;
  }

  async function revealDescription() {
    const candidates = [
      "ytd-watch-metadata #description-inline-expander #expand",
      "ytd-watch-metadata ytd-text-inline-expander #expand",
      "ytd-watch-metadata tp-yt-paper-button#expand",
      "ytd-watch-metadata button[aria-label*='more' i]",
      "ytd-watch-metadata button[aria-label*='mehr' i]"
    ];

    for (const selector of candidates) {
      const element = document.querySelector(selector);
      if (element) {
        await clickElement(element);
        await delay(400);
      }
    }
  }

  function findTranscriptButton() {
    const known = [
      "ytd-video-description-transcript-section-renderer button",
      "ytd-video-description-transcript-section-renderer yt-button-shape button",
      "button[aria-label*='transcript' i]",
      "button[aria-label*='transkript' i]"
    ];

    for (const selector of known) {
      const element = document.querySelector(selector);
      if (element && hasUsableBox(element)) return element;
    }

    const textPattern = /\b(show transcript|transcript|transkript|transkription|mitschrift|abschrift)\b/i;
    const candidates = [
      ...document.querySelectorAll("button, a, tp-yt-paper-button, yt-button-shape, ytd-button-renderer")
    ];

    return candidates.find((element) => {
      if (!hasUsableBox(element)) return false;
      return textPattern.test(normalizeUiText(element.textContent || ""));
    }) || null;
  }

  async function waitForTranscriptSegments(timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const cues = scrapeVisibleTranscript();
      if (cues.length > 0) return cues;
      await delay(250);
    }
    return [];
  }

  function scrapeVisibleTranscript() {
    const segmentSelectors = [
      "ytd-transcript-segment-renderer",
      "yt-transcript-segment-renderer",
      "ytd-transcript-body-renderer [class*='segment']",
      "ytd-transcript-search-panel-renderer [class*='segment']"
    ];

    const segments = [
      ...new Set(segmentSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]))
    ];

    const cues = segments
      .map((segment) => ({
        startMs: parseVisibleTimestamp(segment.textContent || ""),
        text: extractVisibleSegmentText(segment)
      }))
      .filter((cue) => cue.text && !looksLikeTimestampOnly(cue.text));

    return mergeDuplicateCues(cues);
  }

  function extractVisibleSegmentText(segment) {
    const preferred = segment.querySelector(
      ".segment-text, yt-formatted-string.segment-text, [class*='segment-text'], #content-text"
    );
    const raw = preferred?.textContent || segment.textContent || "";
    return cleanCueText(raw.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " "));
  }

  function parseVisibleTimestamp(value) {
    const match = value.match(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/);
    if (!match) return 0;
    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    return ((hours * 60 + minutes) * 60 + seconds) * 1000;
  }

  function looksLikeTimestampOnly(value) {
    return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value.trim());
  }

  function normalizeUiText(value) {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
  }

  async function clickElement(element) {
    element.scrollIntoView?.({ block: "center", inline: "nearest" });
    await delay(100);
    element.click();
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }

  function hasUsableBox(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function cuesToPlainText(cues) {
    return `${cues.map((cue) => cue.text).join("\n")}\n`;
  }

  function triggerTextDownload(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function safeFilename(value) {
    return value
      .normalize("NFKD")
      .replace(/[^\w\s.-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120)
      .replace(/[ .]+$/g, "") || "youtube-transcript";
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${TOAST_ID} {
        background: rgba(15, 15, 15, 0.92);
        border-radius: 8px;
        bottom: 24px;
        color: #fff;
        font: 400 13px/18px Roboto, Arial, sans-serif;
        left: 50%;
        max-width: min(460px, calc(100vw - 32px));
        padding: 10px 14px;
        position: fixed;
        transform: translateX(-50%);
        z-index: 2147483647;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function showToast(message) {
    ensureStyle();
    document.getElementById(TOAST_ID)?.remove();
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.textContent = message;
    document.documentElement.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }
})();
