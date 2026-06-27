const MESSAGE_TYPE = "YTAT_SAVE_AS_TXT";
const CONTENT_SCRIPT_FILE = "content.js";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !isSupportedYoutubeUrl(tab.url || "")) {
    await flashBadge("YT?");
    return;
  }

  try {
    await ensureContentScript(tab.id);
    await primePlayerCaptions(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPE });
    if (response?.ok) {
      await flashBadge("OK", "#147a2e", 1200);
    } else {
      console.warn("[YouTube Auto Transcript TXT]", response?.error || "Unknown transcript error");
      await flashBadge("ERR");
    }
  } catch (error) {
    console.warn("[YouTube Auto Transcript TXT]", error);
    await flashBadge("ERR");
  }
});

function isSupportedYoutubeUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.hostname === "www.youtube.com" &&
      (url.pathname === "/watch" || url.pathname.startsWith("/shorts/"))
    );
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE]
  });
}

async function primePlayerCaptions(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
        const player = document.querySelector(".html5-video-player");
        try {
          player?.loadModule?.("captions");
        } catch {
          // YouTube exposes this only on some player builds.
        }

        const button = document.querySelector(".ytp-subtitles-button");
        if (!button) return;
        button.click();
        await delay(800);
        button.click();
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
  } catch (error) {
    console.warn("[YouTube Auto Transcript TXT] Caption priming failed", error);
  }
}

async function flashBadge(text, color = "#c00", durationMs = 1800) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
  }, durationMs);
}
