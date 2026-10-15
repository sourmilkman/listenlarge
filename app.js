// Listen Large — free, on-device-browser captions with Thai/English auto-switch.
// No API keys, no relay, no charges: uses the browser's built-in speech recognition only.

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const APP_VERSION = "v1.3.1";
const REPEAT_HOLD_MS = 5000;
const HISTORY_KEY = "listen-large-history";
const HISTORY_MAX_AGE_MS = 2 * 60 * 60 * 1000; // keep 2 hours
const HISTORY_MAX_ITEMS = 240;
const MANUAL_LOCK_MS = 20000; // after a manual tap, auto-switch waits this long
const LOW_CONFIDENCE = 0.35; // below this (when the browser reports one) a result looks garbled
const LOW_CONFIDENCE_STREAK = 2; // this many garbled results in a row → try the other language
const RESTART_DELAY_MS = 300;
// Free Thai→English translation via MyMemory (no key, browser-friendly). 5,000 chars/day per
// network, or 50,000/day when an email is added in caregiver settings. Text only — never audio.
const TRANSLATE_URL = "https://api.mymemory.translated.net/get";
const TRANSLATE_CHUNK = 150; // MyMemory caps a query at ~500 bytes; Thai is 3 bytes per character
// English mode can't hear Thai (it turns Thai into a stray English word), so from English
// we head back to Thai — the "home" mode, which hears both — on either of these signals:
const THIN_MAX_WORDS = 2; // a final result this short in English mode looks like misheard Thai
const THIN_STREAK = 2; // this many short results in a row → back to Thai
const PAUSE_RETURN_MS = 10000; // this long without hearing anything in English mode → back to Thai

const LANGS = {
  "th-TH": { code: "th", label: "ไทย", listening: "กำลังฟัง..." },
  "en-US": { code: "en", label: "EN", listening: "Listening..." }
};

const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable — settings just won't persist */
    }
  }
};

const state = {
  listening: false,
  lang: LANGS[store.get("listen-large-lang", "")] ? store.get("listen-large-lang", "") : "th-TH",
  autoSwitch: store.get("listen-large-auto", "1") === "1",
  translate: store.get("listen-large-translate", "1") === "1",
  translateEmail: store.get("listen-large-translate-email", ""),
  translations: new Map(),
  size: store.get("listen-large-size", "huge"),
  theme: store.get("listen-large-theme", "white"),
  settingsUnlocked: store.get("listen-large-settings-unlocked", "0") === "1",
  currentLang: "",
  lastCaption: "",
  lastCaptionTime: 0,
  history: loadHistory(),
  recognition: null,
  restartTimer: null,
  repeatTimer: null,
  meterTimer: null,
  wakeLock: null,
  manualLockUntil: 0,
  lowConfidenceStreak: 0,
  thinStreak: 0,
  lastHeardAt: 0,
  pauseTimer: null,
  langSource: "auto", // "manual" when chosen with the ไทย / EN button
  fatalError: false,
  titleTaps: []
};

const els = {
  listenButton: document.querySelector("#listenButton"),
  listenLabel: document.querySelector("#listenLabel"),
  langButton: document.querySelector("#langButton"),
  statusStrip: document.querySelector("#statusStrip"),
  statusText: document.querySelector("#statusText"),
  transcript: document.querySelector("#transcript"),
  buildBadge: document.querySelector("#buildBadge"),
  captionStage: document.querySelector(".caption-stage"),
  brandButton: document.querySelector("#brandButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  autoSelect: document.querySelector("#autoSelect"),
  translateSelect: document.querySelector("#translateSelect"),
  translateEmail: document.querySelector("#translateEmail"),
  sizeSelect: document.querySelector("#sizeSelect"),
  themeSelect: document.querySelector("#themeSelect"),
  saveSettings: document.querySelector("#saveSettings"),
  historyButton: document.querySelector("#historyButton"),
  repeatButton: document.querySelector("#repeatButton"),
  historyDialog: document.querySelector("#historyDialog"),
  historyList: document.querySelector("#historyList"),
  clearHistoryButton: document.querySelector("#clearHistoryButton")
};

/* ---------- History ---------- */

function loadHistory() {
  try {
    const items = JSON.parse(store.get(HISTORY_KEY, "[]"));
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item && typeof item.text === "string" && Date.now() - item.time <= HISTORY_MAX_AGE_MS);
  } catch {
    return [];
  }
}

function saveHistory() {
  state.history = state.history
    .filter((item) => Date.now() - item.time <= HISTORY_MAX_AGE_MS)
    .slice(-HISTORY_MAX_ITEMS);
  store.set(HISTORY_KEY, JSON.stringify(state.history));
}

/* ---------- UI helpers ---------- */

function setStatus(text, tone = "active") {
  els.statusText.textContent = text;
  els.statusStrip.classList.toggle("idle", tone === "idle");
  els.statusStrip.classList.toggle("error", tone === "error");
}

function setCaption(text, sourceLang = "", placeholder = false, translation = "") {
  state.currentLang = sourceLang;
  els.transcript.replaceChildren();
  if (translation && !placeholder) {
    const original = document.createElement("span");
    original.className = "caption-original";
    original.lang = sourceLang || "";
    original.textContent = text;
    const english = document.createElement("span");
    english.className = "caption-translation";
    english.lang = "en";
    english.textContent = translation;
    els.transcript.append(original, english);
  } else {
    els.transcript.textContent = text;
  }
  els.transcript.classList.toggle("placeholder", placeholder);
  els.transcript.classList.toggle("lang-th", !placeholder && sourceLang === "th");
  els.transcript.classList.toggle("lang-en", !placeholder && sourceLang === "en");
  els.transcript.lang = sourceLang || "";
}

function pulseCaption() {
  els.captionStage.classList.remove("pulse");
  void els.captionStage.offsetWidth;
  els.captionStage.classList.add("pulse");
}

function updateListeningUi() {
  els.listenButton.classList.toggle("listening", state.listening);
  els.listenLabel.textContent = state.listening ? "Stop" : "Start";
}

function updateLangUi() {
  const info = LANGS[state.lang];
  els.langButton.textContent = info.label;
  els.langButton.dataset.lang = info.code;
  els.langButton.setAttribute("aria-label", `Language: ${info.code === "th" ? "Thai" : "English"}. Tap to switch.`);
}

// No audio capture of our own (iOS can block speech recognition if another mic stream is open),
// so the meter just bounces whenever the recogniser hears speech.
function bumpMeter(level = 0.7) {
  document.documentElement.style.setProperty("--meter", String(level));
  window.clearTimeout(state.meterTimer);
  state.meterTimer = window.setTimeout(() => {
    document.documentElement.style.setProperty("--meter", "0");
  }, 350);
}

function setSize(size) {
  state.size = size;
  store.set("listen-large-size", size);
  const map = {
    large: "clamp(2.55rem, 7.2vw, 4.8rem)",
    huge: "clamp(3.05rem, 8.4vw, 5.6rem)",
    max: "clamp(3.5rem, 9.6vw, 6.4rem)"
  };
  document.documentElement.style.setProperty("--font-size-transcript", map[size] || map.huge);
}

function setTheme(theme) {
  state.theme = theme;
  store.set("listen-large-theme", theme);
  document.documentElement.dataset.theme = theme;
}

function unlockSettings(open = false) {
  state.settingsUnlocked = true;
  store.set("listen-large-settings-unlocked", "1");
  els.settingsButton.hidden = false;
  if (open) els.settingsDialog.showModal();
}

/* ---------- Language detection ---------- */

function scriptCounts(text) {
  return {
    thai: (text.match(/[฀-๿]/g) || []).length,
    latin: (text.match(/[A-Za-z]/g) || []).length
  };
}

function languageOfText(text, fallback) {
  const { thai, latin } = scriptCounts(text);
  if (thai > latin) return "th";
  if (latin > thai) return "en";
  return LANGS[fallback]?.code || "";
}

// Decide which language to listen in next, based on the sentence just heard.
function nextLang(text, confidence, current) {
  const { thai, latin } = scriptCounts(text);

  // 1. Clear script signal: Thai dictation writes English words in English letters.
  if (current === "th-TH" && latin >= 6 && latin > thai * 2) return "en-US";
  if (current === "en-US" && thai > 0) return "th-TH";

  // 2. Thin signal (English mode only): Thai speech comes out as one or two stray English words.
  if (current === "en-US") {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    state.thinStreak = words <= THIN_MAX_WORDS ? state.thinStreak + 1 : 0;
    if (state.thinStreak >= THIN_STREAK) return "th-TH";
  }

  // 3. Garble signal: a run of low-confidence results suggests the wrong language.
  //    Only used when the browser reports a real confidence (Safari sometimes reports 0).
  if (confidence > 0 && confidence < LOW_CONFIDENCE) state.lowConfidenceStreak += 1;
  else state.lowConfidenceStreak = 0;

  if (state.lowConfidenceStreak >= LOW_CONFIDENCE_STREAK) {
    state.lowConfidenceStreak = 0;
    return current === "th-TH" ? "en-US" : "th-TH";
  }
  return current;
}

// Pause signal: after a quiet spell in auto-chosen English, go home to Thai so the next
// speaker is heard whichever language they use. A manual EN choice is left alone.
function checkPauseReturn() {
  if (!state.listening || !state.autoSwitch || state.lang !== "en-US" || state.langSource !== "auto") return;
  if (Date.now() - state.lastHeardAt >= PAUSE_RETURN_MS) switchLanguage("th-TH");
}

function switchLanguage(lang, { manual = false } = {}) {
  if (!LANGS[lang] || lang === state.lang) return;
  state.lang = lang;
  state.lowConfidenceStreak = 0;
  state.thinStreak = 0;
  state.lastHeardAt = Date.now();
  state.langSource = manual ? "manual" : "auto";
  if (manual) state.manualLockUntil = Date.now() + MANUAL_LOCK_MS;
  store.set("listen-large-lang", lang);
  updateLangUi();
  if (state.listening) {
    setStatus(LANGS[lang].listening);
    restartRecognition();
  }
}

/* ---------- Captions ---------- */

function addCaption(text, confidence = 0) {
  const clean = text.trim();
  if (!clean) return;

  // Safari occasionally fires the same final result twice.
  if (clean === state.lastCaption && Date.now() - state.lastCaptionTime < 3000) return;

  window.clearTimeout(state.repeatTimer);
  const lang = languageOfText(clean, state.lang);
  state.lastCaption = clean;
  state.lastCaptionTime = Date.now();
  const item = { text: clean, lang, time: Date.now() };
  state.history.push(item);
  saveHistory();
  setCaption(clean, lang);
  pulseCaption();
  if (lang === "th") translateItem(item);

  if (state.autoSwitch && Date.now() > state.manualLockUntil) {
    switchLanguage(nextLang(clean, confidence, state.lang));
  }
}

/* ---------- Translation (Thai → English) ---------- */

function chunkText(text) {
  const chunks = [];
  let current = "";
  for (const word of text.split(/(\s+)/)) {
    if ((current + word).length > TRANSLATE_CHUNK && current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
    // Thai is often written without spaces, so hard-split any over-long run.
    let piece = word;
    while (piece.length > TRANSLATE_CHUNK) {
      chunks.push(piece.slice(0, TRANSLATE_CHUNK));
      piece = piece.slice(TRANSLATE_CHUNK);
    }
    current += piece;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function translateChunk(text) {
  const params = new URLSearchParams({ q: text, langpair: "th|en" });
  if (state.translateEmail) params.set("de", state.translateEmail);
  const response = await fetch(`${TRANSLATE_URL}?${params}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  // MyMemory reports quota/errors in the body, sometimes with HTTP 200.
  if (Number(data.responseStatus) === 429 || data.quotaFinished) throw new Error("quota");
  if (Number(data.responseStatus) !== 200) throw new Error(String(data.responseDetails || data.responseStatus));
  const out = String(data.responseData?.translatedText || "").trim();
  if (!out || /MYMEMORY WARNING/i.test(out)) throw new Error("quota");
  return out;
}

async function translateText(text) {
  if (state.translations.has(text)) return state.translations.get(text);
  const parts = [];
  for (const chunk of chunkText(text)) parts.push(await translateChunk(chunk));
  const english = parts.join(" ");
  state.translations.set(text, english);
  return english;
}

async function translateItem(item) {
  if (!state.translate || item.translation) return;
  try {
    item.translation = await translateText(item.text);
    saveHistory();
    if (els.statusText.textContent === "Translation limit reached today" && state.listening) {
      setStatus(LANGS[state.lang].listening);
    }
    // Only redraw if this sentence is still the one on screen.
    if (state.lastCaption === item.text && els.transcript.textContent.startsWith(item.text)) {
      setCaption(item.text, item.lang, false, item.translation);
    }
  } catch (error) {
    if (String(error.message).includes("quota") || /LIMIT|QUOTA/i.test(error.message)) {
      setStatus("Translation limit reached today", "error");
    }
    // Otherwise stay quiet: the Thai caption is already showing.
  }
}

/* ---------- Speech recognition ---------- */

function errorMessage(code) {
  switch (code) {
    case "not-allowed":
      return { status: "Microphone blocked", caption: "Allow the microphone for this app in Settings", fatal: true };
    case "service-not-allowed":
      return { status: "Dictation is off", caption: "Turn on Dictation: Settings › General › Keyboard", fatal: true };
    case "language-not-supported":
      return { status: "Language not available", caption: "Turn on Dictation for Thai in Settings › General › Keyboard", fatal: true };
    case "audio-capture":
      return { status: "No microphone", caption: "No microphone found", fatal: true };
    case "network":
      return { status: "No internet", caption: "Speech needs an internet connection", fatal: false };
    default:
      return null; // "no-speech", "aborted" etc. — just keep listening
  }
}

function createRecognizer() {
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = state.lang;

  recognition.onstart = () => setStatus(LANGS[state.lang].listening);
  recognition.onspeechstart = () => bumpMeter(0.5);

  recognition.onerror = (event) => {
    const info = errorMessage(event.error);
    if (!info) return;
    setStatus(info.status, "error");
    if (info.fatal) {
      state.fatalError = true;
      setCaption(info.caption, "", true);
      stopListening({ keepMessage: true });
    }
  };

  recognition.onend = () => {
    // iOS ends sessions on its own every so often — quietly restart while listening.
    if (state.recognition !== recognition) return;
    state.recognition = null;
    if (state.listening && !state.fatalError) scheduleStart();
  };

  recognition.onresult = (event) => {
    bumpMeter();
    state.lastHeardAt = Date.now();
    let finalText = "";
    let finalConfidence = 0;
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) {
        finalText += result[0].transcript;
        finalConfidence = Math.max(finalConfidence, result[0].confidence || 0);
      } else {
        interimText += result[0].transcript;
      }
    }
    if (finalText.trim()) addCaption(finalText, finalConfidence);
    else if (interimText.trim()) setCaption(interimText.trim(), languageOfText(interimText, state.lang));
  };

  return recognition;
}

function startRecognition() {
  if (!state.listening || state.recognition) return;
  const recognition = createRecognizer();
  state.recognition = recognition;
  try {
    recognition.start();
  } catch {
    state.recognition = null;
    scheduleStart();
  }
}

function scheduleStart() {
  window.clearTimeout(state.restartTimer);
  state.restartTimer = window.setTimeout(startRecognition, RESTART_DELAY_MS);
}

function restartRecognition() {
  const recognition = state.recognition;
  if (!recognition) {
    scheduleStart();
    return;
  }
  // Detach first so the old session's onend doesn't race the new one.
  recognition.onend = null;
  recognition.onresult = null;
  recognition.onerror = null;
  state.recognition = null;
  try {
    recognition.abort();
  } catch {
    /* already stopped */
  }
  scheduleStart();
}

/* ---------- Wake lock ---------- */

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || !state.listening) return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
    });
  } catch {
    state.wakeLock = null;
  }
}

async function releaseWakeLock() {
  const lock = state.wakeLock;
  state.wakeLock = null;
  await lock?.release().catch(() => {});
}

/* ---------- Start / stop ---------- */

function showUnsupported() {
  setStatus("Speech not available", "error");
  setCaption("Open this app in Safari (iPad) or Chrome", "", true);
}

async function startListening() {
  if (state.listening) return;
  if (!SpeechRecognition) {
    showUnsupported();
    return;
  }
  state.listening = true;
  state.fatalError = false;
  state.lowConfidenceStreak = 0;
  state.thinStreak = 0;
  state.lastHeardAt = Date.now();
  window.clearInterval(state.pauseTimer);
  state.pauseTimer = window.setInterval(checkPauseReturn, 1000);
  updateListeningUi();
  setCaption(LANGS[state.lang].listening, "", true);
  setStatus(LANGS[state.lang].listening);
  // Start speech synchronously inside the tap — iOS only grants the mic during a user gesture.
  startRecognition();
  requestWakeLock(); // fire-and-forget: never let a slow/denied wake lock block listening
}

async function stopListening({ keepMessage = false } = {}) {
  state.listening = false;
  updateListeningUi();
  window.clearTimeout(state.restartTimer);
  window.clearTimeout(state.repeatTimer);
  window.clearInterval(state.pauseTimer);
  const recognition = state.recognition;
  state.recognition = null;
  if (recognition) {
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      /* already stopped */
    }
  }
  document.documentElement.style.setProperty("--meter", "0");
  await releaseWakeLock();
  if (keepMessage) return;
  setCaption("Stopped", "", true);
  setStatus("Stopped", "idle");
}

/* ---------- Settings, history, repeat ---------- */

function saveSettings() {
  state.autoSwitch = els.autoSelect.value === "1";
  store.set("listen-large-auto", state.autoSwitch ? "1" : "0");
  state.translate = els.translateSelect.value === "1";
  store.set("listen-large-translate", state.translate ? "1" : "0");
  state.translateEmail = els.translateEmail.value.trim();
  store.set("listen-large-translate-email", state.translateEmail);
  setSize(els.sizeSelect.value);
  setTheme(els.themeSelect.value);
}

function renderHistory() {
  els.historyList.replaceChildren();
  if (!state.history.length) {
    const empty = document.createElement("li");
    empty.textContent = "No captions yet.";
    els.historyList.append(empty);
    return;
  }
  for (const item of [...state.history].reverse()) {
    const row = document.createElement("li");
    row.classList.toggle("lang-th", item.lang === "th");
    row.classList.toggle("lang-en", item.lang === "en");
    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(item.time);
    row.append(time, item.text);
    if (item.translation) {
      const english = document.createElement("span");
      english.className = "history-translation";
      english.lang = "en";
      english.textContent = item.translation;
      row.append(english);
    }
    els.historyList.append(row);
  }
}

function showRepeat() {
  const cutoff = Date.now() - 30000;
  const recent = state.history.filter((item) => item.time >= cutoff);
  if (!recent.length) return;
  const text = recent.map((item) => item.text).join(" ");
  const english = recent.map((item) => item.translation || (item.lang === "en" ? item.text : "")).filter(Boolean).join(" ");
  const hasThai = recent.some((item) => item.lang === "th");
  setCaption(text, recent[recent.length - 1].lang, false, hasThai ? english : "");
  window.clearTimeout(state.repeatTimer);
  state.repeatTimer = window.setTimeout(() => {
    const last = state.history[state.history.length - 1];
    if (last) setCaption(last.text, last.lang, false, last.translation || "");
    else setCaption(LANGS[state.lang].listening, "", true);
  }, REPEAT_HOLD_MS);
}

/* ---------- Events ---------- */

els.listenButton.addEventListener("click", () => {
  if (state.listening) stopListening();
  else startListening();
});

els.langButton.addEventListener("click", () => {
  switchLanguage(state.lang === "th-TH" ? "en-US" : "th-TH", { manual: true });
});

els.repeatButton.addEventListener("click", showRepeat);
els.historyButton.addEventListener("click", () => {
  renderHistory();
  els.historyDialog.showModal();
});
els.clearHistoryButton.addEventListener("click", () => {
  state.history = [];
  saveHistory();
  renderHistory();
});

els.brandButton.addEventListener("click", () => {
  const now = Date.now();
  state.titleTaps = [...state.titleTaps.filter((time) => now - time < 2500), now];
  if (state.titleTaps.length >= 5) unlockSettings(true);
});

els.settingsButton.addEventListener("click", () => els.settingsDialog.showModal());
els.saveSettings.addEventListener("click", saveSettings);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.listening) {
    if (!state.wakeLock) requestWakeLock();
    if (!state.recognition) scheduleStart(); // iOS kills recognition when the app is backgrounded
  }
});

window.addEventListener("pagehide", () => stopListening());

if ("serviceWorker" in navigator) {
  // When a new version's service worker takes over, reload once so the new code shows —
  // but never mid-listen (it would cut dad off); wait until listening is stopped.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let pendingReload = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    if (state.listening) pendingReload = true;
    else location.reload();
  });
  els.listenButton.addEventListener("click", () => {
    if (pendingReload && !state.listening) location.reload();
  });
  navigator.serviceWorker
    .register("sw.js", { updateViaCache: "none" })
    .then((registration) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") registration.update().catch(() => {});
      });
    })
    .catch(() => {});
}

/* ---------- Boot ---------- */

if (new URLSearchParams(location.search).get("settings") === "1") unlockSettings(true);
else if (state.settingsUnlocked) unlockSettings(false);

els.autoSelect.value = state.autoSwitch ? "1" : "0";
els.translateSelect.value = state.translate ? "1" : "0";
els.translateEmail.value = state.translateEmail;
els.sizeSelect.value = state.size;
els.themeSelect.value = state.theme;
els.buildBadge.textContent = APP_VERSION;
setSize(state.size);
setTheme(state.theme);
updateLangUi();
updateListeningUi();

if (!SpeechRecognition) showUnsupported();
else {
  setStatus("Tap Start", "idle");
  setCaption("Tap Start to begin", "", true);
}
