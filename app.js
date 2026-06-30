const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const APP_VERSION = "v1.1.3";
const BUILD_MODEL = `${APP_VERSION} / GPT-5 Codex`;
const CAPTION_HOLD_MS = 1800;
const REPEAT_HOLD_MS = 5000;
const SILENCE_THRESHOLD = 0.012;

const state = {
  listening: false,
  language: localStorage.getItem("listen-large-language") || "auto",
  size: localStorage.getItem("listen-large-size") || "huge",
  theme: localStorage.getItem("listen-large-theme") || "white",
  engine: localStorage.getItem("listen-large-engine") || "browser",
  relayUrl: localStorage.getItem("listen-large-relay-url") || "",
  settingsUnlocked: localStorage.getItem("listen-large-settings-unlocked") === "1",
  currentCaption: "",
  lastCaption: "",
  currentLang: "",
  history: [],
  recognition: null,
  mediaRecorder: null,
  stream: null,
  chunkTimer: null,
  wakeLock: null,
  audioContext: null,
  analyser: null,
  meterFrame: null,
  meterLevel: 0,
  segmentPeak: 0,
  repeatTimer: null,
  titleTaps: []
};

const els = {
  listenButton: document.querySelector("#listenButton"),
  listenLabel: document.querySelector("#listenLabel"),
  statusStrip: document.querySelector("#statusStrip"),
  statusText: document.querySelector("#statusText"),
  transcript: document.querySelector("#transcript"),
  buildBadge: document.querySelector("#buildBadge"),
  captionStage: document.querySelector(".caption-stage"),
  brandButton: document.querySelector("#brandButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  engineSelect: document.querySelector("#engineSelect"),
  relayUrl: document.querySelector("#relayUrl"),
  languageSelect: document.querySelector("#languageSelect"),
  sizeSelect: document.querySelector("#sizeSelect"),
  themeSelect: document.querySelector("#themeSelect"),
  saveSettings: document.querySelector("#saveSettings"),
  historyButton: document.querySelector("#historyButton"),
  repeatButton: document.querySelector("#repeatButton"),
  historyDialog: document.querySelector("#historyDialog"),
  historyList: document.querySelector("#historyList"),
  clearHistoryButton: document.querySelector("#clearHistoryButton")
};

function setStatus(text, tone = "active") {
  els.statusText.textContent = text;
  els.statusStrip.classList.toggle("idle", tone === "idle");
  els.statusStrip.classList.toggle("error", tone === "error");
}

function setCaption(text, sourceLang = "", placeholder = false) {
  state.currentCaption = text;
  state.currentLang = sourceLang;
  els.transcript.textContent = text || (state.listening ? "Listening..." : "Stopped");
  els.transcript.classList.toggle("placeholder", placeholder || !text);
  els.transcript.classList.toggle("lang-th", sourceLang === "th");
  els.transcript.classList.toggle("lang-en", sourceLang === "en");
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

function mobileNeedsRelay() {
  return !SpeechRecognition && state.engine !== "relay";
}

function showMobileRelayPrompt() {
  setStatus("Use relay mode", "error");
  setCaption("Tap title 5 times, choose relay mode", "", true);
}

function browserRecognitionLanguage() {
  if (state.language === "auto") return navigator.language?.startsWith("th") ? "th-TH" : "en-US";
  return state.language;
}

function setSize(size) {
  state.size = size;
  localStorage.setItem("listen-large-size", size);
  const map = {
    large: "clamp(2.55rem, 7.2vw, 4.8rem)",
    huge: "clamp(3.05rem, 8.4vw, 5.6rem)",
    max: "clamp(3.5rem, 9.6vw, 6.4rem)"
  };
  document.documentElement.style.setProperty("--font-size-transcript", map[size] || map.huge);
}

function setTheme(theme) {
  state.theme = theme;
  localStorage.setItem("listen-large-theme", theme);
  document.documentElement.dataset.theme = theme;
}

function unlockSettings(open = false) {
  state.settingsUnlocked = true;
  localStorage.setItem("listen-large-settings-unlocked", "1");
  els.settingsButton.hidden = false;
  if (open) els.settingsDialog.showModal();
}

function inferSourceLanguage(text, language) {
  if (language) {
    const normalized = String(language).toLowerCase();
    if (normalized.startsWith("th") || normalized.includes("thai")) return "th";
    if (normalized.startsWith("en") || normalized.includes("english")) return "en";
  }
  return /[\u0E00-\u0E7F]/.test(text) ? "th" : "en";
}

function addCaption(text, sourceLang = "") {
  const clean = text.trim();
  if (!clean) return;
  window.clearTimeout(state.repeatTimer);
  const lang = inferSourceLanguage(clean, sourceLang);
  state.lastCaption = clean;
  state.history.push({ text: clean, lang, time: Date.now() });
  state.history = state.history.filter((item) => Date.now() - item.time <= 2 * 60 * 60 * 1000).slice(-240);
  setCaption(clean, lang);
  pulseCaption();
  window.setTimeout(() => {
    if (state.currentCaption === clean && state.listening) setCaption("Listening...", "", true);
  }, CAPTION_HOLD_MS);
}

function createBrowserRecognizer() {
  if (!SpeechRecognition) return null;
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = browserRecognitionLanguage();

  recognition.onstart = () => setStatus("Listening...");
  recognition.onerror = (event) => {
    const message = event.error === "not-allowed" ? "Microphone blocked" : "Speech error";
    setStatus(message, "error");
  };
  recognition.onend = () => {
    if (state.listening && state.engine === "browser") {
      window.setTimeout(() => {
        try {
          recognition.start();
        } catch {
          setStatus("Listening paused", "error");
        }
      }, 250);
    }
  };
  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) finalText += result[0].transcript;
      else interimText += result[0].transcript;
    }
    if (finalText.trim()) addCaption(finalText, browserRecognitionLanguage());
    else if (interimText.trim()) setCaption(interimText.trim(), inferSourceLanguage(interimText, browserRecognitionLanguage()));
  };
  return recognition;
}

async function startBrowserListening() {
  state.recognition = createBrowserRecognizer();
  if (!state.recognition) {
    setStatus("Use relay mode", "error");
    setCaption("Open settings and choose relay mode", "", true);
    return false;
  }
  try {
    navigator.mediaDevices?.getUserMedia?.({ audio: true })
      ?.then((stream) => {
        state.stream = stream;
        startMeter(stream);
      })
      .catch(() => {});
    state.recognition.start();
    return true;
  } catch {
    setStatus("Tap Start", "error");
    setCaption("Tap Start to allow the microphone", "", true);
    return false;
  }
}

function getMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  return options.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function startMeter(stream) {
  stopMeter();
  if (!AudioContextClass) return;
  state.audioContext = new AudioContextClass();
  const source = state.audioContext.createMediaStreamSource(stream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 1024;
  source.connect(state.analyser);
  const data = new Uint8Array(state.analyser.fftSize);
  const tick = () => {
    state.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    state.meterLevel = Math.sqrt(sum / data.length);
    state.segmentPeak = Math.max(state.segmentPeak, state.meterLevel);
    document.documentElement.style.setProperty("--meter", String(Math.min(1, state.meterLevel * 9)));
    state.meterFrame = requestAnimationFrame(tick);
  };
  tick();
}

function stopMeter() {
  if (state.meterFrame) cancelAnimationFrame(state.meterFrame);
  state.meterFrame = null;
  state.analyser = null;
  state.audioContext?.close().catch(() => {});
  state.audioContext = null;
  state.meterLevel = 0;
  state.segmentPeak = 0;
  document.documentElement.style.setProperty("--meter", "0");
}

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

async function sendAudioChunk(blob) {
  if (!blob.size || !state.relayUrl) return;
  if (state.segmentPeak < SILENCE_THRESHOLD) {
    setStatus("Listening...");
    return;
  }

  const form = new FormData();
  form.append("audio", blob, "speech.webm");

  const response = await fetch(state.relayUrl.replace(/\/$/, "") + "/transcribe", {
    method: "POST",
    body: form
  });

  if (!response.ok) throw new Error("Relay transcription failed");
  const data = await response.json();
  if (data.text) addCaption(data.text, data.language || data.detected_language || data.source_language);
}

async function startRelayListening() {
  if (!state.relayUrl) {
    setStatus("Add relay URL", "error");
    setCaption("Add relay URL in settings", "", true);
    return false;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    startMeter(state.stream);
    const mimeType = getMimeType();
    state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
    let chunks = [];

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: state.mediaRecorder?.mimeType || "audio/webm" });
      chunks = [];
      if (!state.listening) {
        setStatus("Stopped", "idle");
        return;
      }
      try {
        setStatus("Transcribing...");
        await sendAudioChunk(blob);
        if (state.listening) startRelaySegment();
        else setStatus("Stopped", "idle");
      } catch {
        setStatus("Relay error", "error");
        if (state.listening) startRelaySegment();
      }
    };

    startRelaySegment();
    return true;
  } catch {
    setStatus("Tap Start", "error");
    setCaption("Tap Start to allow the microphone", "", true);
    return false;
  }
}

function startRelaySegment() {
  if (!state.mediaRecorder || !state.listening || state.mediaRecorder.state !== "inactive") return;
  state.segmentPeak = 0;
  state.mediaRecorder.start();
  setStatus("Listening...");
  state.chunkTimer = window.setTimeout(() => {
    if (state.mediaRecorder?.state === "recording") state.mediaRecorder.stop();
  }, 6500);
}

async function startListening() {
  if (state.listening) return;
  if (mobileNeedsRelay()) {
    showMobileRelayPrompt();
    updateListeningUi();
    return;
  }
  state.listening = true;
  updateListeningUi();
  setCaption("Listening...", "", true);
  await requestWakeLock();
  const started = state.engine === "relay" ? await startRelayListening() : await startBrowserListening();
  if (!started) {
    state.listening = false;
    updateListeningUi();
  }
}

async function stopListening() {
  state.listening = false;
  updateListeningUi();
  window.clearTimeout(state.chunkTimer);
  window.clearTimeout(state.repeatTimer);
  if (state.recognition) {
    state.recognition.onend = null;
    state.recognition.stop();
    state.recognition = null;
  }
  if (state.mediaRecorder?.state === "recording") state.mediaRecorder.stop();
  state.mediaRecorder = null;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  stopMeter();
  await releaseWakeLock();
  setCaption("Stopped", "", true);
  if (!els.statusStrip.classList.contains("error")) setStatus("Stopped", "idle");
}

function saveSettings() {
  const wasListening = state.listening;
  state.engine = els.engineSelect.value;
  state.relayUrl = els.relayUrl.value.trim();
  state.language = els.languageSelect.value;
  localStorage.setItem("listen-large-engine", state.engine);
  localStorage.setItem("listen-large-relay-url", state.relayUrl);
  localStorage.setItem("listen-large-language", state.language);
  setSize(els.sizeSelect.value);
  setTheme(els.themeSelect.value);
  if (wasListening) {
    stopListening().then(startListening);
  }
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
    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(item.time);
    row.append(time, item.text);
    els.historyList.append(row);
  }
}

function showRepeat() {
  const cutoff = Date.now() - 30000;
  const text = state.history.filter((item) => item.time >= cutoff).map((item) => item.text).join(" ");
  if (!text) return;
  setCaption(text, "");
  window.clearTimeout(state.repeatTimer);
  state.repeatTimer = window.setTimeout(() => {
    setCaption(state.lastCaption || "Listening...", state.currentLang, !state.lastCaption);
  }, REPEAT_HOLD_MS);
}

els.listenButton.addEventListener("click", () => {
  if (state.listening) stopListening();
  else startListening();
});

els.repeatButton.addEventListener("click", showRepeat);
els.historyButton.addEventListener("click", () => {
  renderHistory();
  els.historyDialog.showModal();
});
els.clearHistoryButton.addEventListener("click", () => {
  state.history = [];
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
  if (document.visibilityState === "visible" && state.listening && !state.wakeLock) requestWakeLock();
});

window.addEventListener("beforeunload", stopListening);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

if (new URLSearchParams(location.search).get("settings") === "1") unlockSettings(true);
else if (state.settingsUnlocked) unlockSettings(false);

els.engineSelect.value = state.engine;
els.relayUrl.value = state.relayUrl;
els.languageSelect.value = state.language;
els.sizeSelect.value = state.size;
els.themeSelect.value = state.theme;
els.buildBadge.textContent = BUILD_MODEL;
setSize(state.size);
setTheme(state.theme);
if (mobileNeedsRelay()) showMobileRelayPrompt();
else {
  setStatus("Starting...");
  setCaption("Listening...", "", true);
}
updateListeningUi();
window.setTimeout(startListening, 300);
