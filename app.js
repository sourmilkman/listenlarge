const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const state = {
  listening: false,
  language: localStorage.getItem("listen-large-language") || "auto",
  size: localStorage.getItem("listen-large-size") || "large",
  engine: localStorage.getItem("listen-large-engine") || "browser",
  relayUrl: localStorage.getItem("listen-large-relay-url") || "",
  transcript: "",
  interim: "",
  recognition: null,
  mediaRecorder: null,
  stream: null,
  chunkTimer: null
};

const els = {
  listenButton: document.querySelector("#listenButton"),
  listenLabel: document.querySelector("#listenLabel"),
  statusStrip: document.querySelector("#statusStrip"),
  statusText: document.querySelector("#statusText"),
  transcript: document.querySelector("#transcript"),
  clearButton: document.querySelector("#clearButton"),
  languageButtons: [...document.querySelectorAll("[data-language]")],
  sizeButtons: [...document.querySelectorAll("[data-size]")],
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  engineSelect: document.querySelector("#engineSelect"),
  relayUrl: document.querySelector("#relayUrl"),
  saveSettings: document.querySelector("#saveSettings")
};

function setStatus(text, tone = "idle") {
  els.statusText.textContent = text;
  els.statusStrip.classList.toggle("idle", tone === "idle");
  els.statusStrip.classList.toggle("error", tone === "error");
}

function renderTranscript() {
  const text = [state.transcript, state.interim].filter(Boolean).join(state.transcript && state.interim ? " " : "");
  els.transcript.textContent = text || "Tap Start Listening.";
  els.transcript.classList.toggle("placeholder", !text);
  requestAnimationFrame(() => {
    els.transcript.scrollTop = els.transcript.scrollHeight;
  });
}

function updateListeningUi() {
  els.listenButton.classList.toggle("listening", state.listening);
  els.listenLabel.textContent = state.listening ? "Stop Listening" : "Start Listening";
}

function setLanguage(language) {
  state.language = language;
  localStorage.setItem("listen-large-language", language);
  els.languageButtons.forEach((button) => {
    const active = button.dataset.language === language;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  if (state.recognition) state.recognition.lang = browserRecognitionLanguage();
}

function browserRecognitionLanguage() {
  if (state.language === "auto") return navigator.language?.startsWith("th") ? "th-TH" : "en-US";
  return state.language;
}

function setSize(size) {
  state.size = size;
  localStorage.setItem("listen-large-size", size);
  const map = {
    comfortable: "clamp(1.8rem, 7vw, 3.4rem)",
    large: "clamp(2.35rem, 9vw, 5rem)",
    huge: "clamp(3rem, 12vw, 6.8rem)"
  };
  document.documentElement.style.setProperty("--font-size-transcript", map[size]);
  els.sizeButtons.forEach((button) => {
    const active = button.dataset.size === size;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
}

function appendText(text) {
  const clean = text.trim();
  if (!clean) return;
  state.transcript = state.transcript ? `${state.transcript}\n${clean}` : clean;
  state.interim = "";
  renderTranscript();
}

function createBrowserRecognizer() {
  if (!SpeechRecognition) return null;
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = browserRecognitionLanguage();

  recognition.onstart = () => setStatus("Listening...", "active");
  recognition.onerror = (event) => {
    const message = event.error === "not-allowed" ? "Microphone blocked" : "Speech error";
    setStatus(message, "error");
  };
  recognition.onend = () => {
    if (state.listening && state.engine === "browser") {
      try {
        recognition.start();
      } catch {
        setStatus("Tap Start again", "error");
        stopListening();
      }
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
    if (finalText.trim()) appendText(finalText);
    state.interim = interimText.trim();
    renderTranscript();
  };
  return recognition;
}

async function startBrowserListening() {
  state.recognition = createBrowserRecognizer();
  if (!state.recognition) {
    setStatus("Browser mode unavailable", "error");
    return false;
  }
  try {
    state.recognition.start();
    return true;
  } catch {
    setStatus("Could not start", "error");
    return false;
  }
}

function getMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  return options.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

async function sendAudioChunk(blob) {
  if (!blob.size || !state.relayUrl) return;
  const form = new FormData();
  form.append("audio", blob, "speech.webm");
  if (state.language !== "auto") {
    form.append("language", state.language.startsWith("th") ? "th" : "en");
  }

  const response = await fetch(state.relayUrl.replace(/\/$/, "") + "/transcribe", {
    method: "POST",
    body: form
  });

  if (!response.ok) throw new Error("Relay transcription failed");
  const data = await response.json();
  if (data.text) appendText(data.text);
}

async function startRelayListening() {
  if (!state.relayUrl) {
    setStatus("Add relay URL", "error");
    return false;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getMimeType();
    state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
    let chunks = [];

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: state.mediaRecorder?.mimeType || "audio/webm" });
      chunks = [];
      try {
        setStatus("Transcribing...", "active");
        await sendAudioChunk(blob);
        if (state.listening) startRelaySegment();
        else setStatus("Ready", "idle");
      } catch {
        setStatus("Relay error", "error");
        stopListening();
      }
    };

    startRelaySegment();
    return true;
  } catch {
    setStatus("Microphone blocked", "error");
    return false;
  }
}

function startRelaySegment() {
  if (!state.mediaRecorder || !state.listening) return;
  state.mediaRecorder.start();
  setStatus("Listening...", "active");
  state.chunkTimer = window.setTimeout(() => {
    if (state.mediaRecorder?.state === "recording") state.mediaRecorder.stop();
  }, 6500);
}

async function startListening() {
  state.listening = true;
  updateListeningUi();
  const started = state.engine === "relay" ? await startRelayListening() : await startBrowserListening();
  if (!started) {
    state.listening = false;
    updateListeningUi();
  }
}

function stopListening() {
  state.listening = false;
  updateListeningUi();
  window.clearTimeout(state.chunkTimer);
  if (state.recognition) {
    state.recognition.onend = null;
    state.recognition.stop();
    state.recognition = null;
  }
  if (state.mediaRecorder?.state === "recording") state.mediaRecorder.stop();
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.interim = "";
  renderTranscript();
  if (!els.statusStrip.classList.contains("error")) setStatus("Ready", "idle");
}

function saveSettings() {
  state.engine = els.engineSelect.value;
  state.relayUrl = els.relayUrl.value.trim();
  localStorage.setItem("listen-large-engine", state.engine);
  localStorage.setItem("listen-large-relay-url", state.relayUrl);
}

els.listenButton.addEventListener("click", () => {
  if (state.listening) stopListening();
  else startListening();
});

els.languageButtons.forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.language));
});

els.sizeButtons.forEach((button) => {
  button.addEventListener("click", () => setSize(button.dataset.size));
});

els.clearButton.addEventListener("click", () => {
  state.transcript = "";
  state.interim = "";
  renderTranscript();
  setStatus("Ready", "idle");
});

els.settingsButton.addEventListener("click", () => els.settingsDialog.showModal());
els.saveSettings.addEventListener("click", saveSettings);

window.addEventListener("beforeunload", stopListening);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

els.engineSelect.value = state.engine;
els.relayUrl.value = state.relayUrl;
setLanguage(state.language);
setSize(state.size);
setStatus("Ready", "idle");
renderTranscript();
