const langConfig = {
  fr: {
    code: "fr",
    placeholder: "Écrivez votre message ici...",
    replyInstruction: "Parle en français.",
    welcomeLine1: "Je suis Yélé, votre",
    welcomeLine2: "guide culturel IA",
    welcomeDesc: "Je réponds à toutes vos questions sur<br>la Côte d'Ivoire instantanément.",
    startBtn: "Commencer la discussion",
  },
  en: {
    code: "en",
    placeholder: "Type your message here...",
    replyInstruction: "Speak in English.",
    welcomeLine1: "I'm Yélé, your",
    welcomeLine2: "AI cultural guide",
    welcomeDesc: "I answer all your questions about<br>Côte d'Ivoire instantly, reliably, and securely.",
    startBtn: "Start the conversation",
  },
  zh: {
    code: "zh-CN",
    placeholder: "在此输入您的消息...",
    replyInstruction: "请说中文。",
    welcomeLine1: "我是Yélé，您的",
    welcomeLine2: "AI文化向导",
    welcomeDesc: "我即时、可靠地回答您关于<br>科特迪瓦的所有问题。",
    startBtn: "开始对话",
  },
};

let selectedLanguage = "fr";
let sessionInfo = null;
let sessionToken = null;
let room = null;
let mediaStream = null;
let webSocket = null;
let conversationHistory = [];
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let isContinuousMode = false;
let audioStream = null;
let silenceTimeout = null;
let audioContext = null;
let analyser = null;
let isSpeaking = false;

const mediaElement = document.getElementById("mediaElement");
const taskInput = document.getElementById("taskInput");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const closeBtn = document.getElementById("closeBtn");
const micBtn = document.getElementById("micBtn");
const talkBtn = document.getElementById("talkBtn");
const startWelcomeBtn = document.getElementById("startWelcomeBtn");

window.setLanguage = function(lang, btn) {
  selectedLanguage = lang;
  const cfg = langConfig[lang];

  // Sync boutons actifs sur tous les sélecteurs
  document.querySelectorAll(".lang-btn").forEach(b => {
    b.classList.toggle("active", b.textContent.trim() === btn.textContent.trim());
  });

  // Traduire la page d'accueil
  document.getElementById("welcomeLine1").textContent = cfg.welcomeLine1;
  document.getElementById("welcomeLine2").textContent = cfg.welcomeLine2;
  document.getElementById("welcomeDesc").innerHTML = cfg.welcomeDesc;
  document.getElementById("startWelcomeBtn").textContent = cfg.startBtn;

  // Traduire le placeholder du champ texte
  taskInput.placeholder = cfg.placeholder;
};

function updateStatus(message, isConnected = false) {
  if (isConnected) {
    statusDot.classList.add("connected");
    statusText.textContent = "Connected";
  } else {
    statusDot.classList.remove("connected");
    statusText.textContent = "Disconnected";
  }
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

function speakViaLiveKit(text) {
  if (!room || !sessionInfo) return;
  room.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({
      event_type: "avatar.speak_text",
      session_id: sessionInfo.session_id,
      text,
    })),
    { reliable: true, topic: "agent-control" }
  );
}

function interruptAvatar() {
  if (!room || !sessionInfo) return;
  try {
    room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({
        event_type: "avatar.interrupt",
        session_id: sessionInfo.session_id,
      })),
      { reliable: true, topic: "agent-control" }
    );
  } catch (e) {
    console.warn("Could not interrupt avatar:", e);
  }
}

async function getSessionToken() {
  const resp = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: langConfig[selectedLanguage].code }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => null);
    console.error("Token error:", JSON.stringify(err));
    throw new Error(`Token failed: ${resp.status}`);
  }
  const json = await resp.json();
  sessionToken = json.data?.session_token;
  if (!sessionToken) throw new Error("No session_token in response");
  updateStatus("Session token obtained");
}

async function createNewSession() {
  await getSessionToken();

  const resp = await fetch("/api/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_token: sessionToken }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    console.error("Session start error:", JSON.stringify(data));
    throw new Error(`Session start failed: ${resp.status}`);
  }
  sessionInfo = data.data;

  room = new LivekitClient.Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: LivekitClient.VideoPresets.h720.resolution },
  });

  room.on(LivekitClient.RoomEvent.DataReceived, (msg) => {
    console.log("Room data:", JSON.parse(new TextDecoder().decode(msg)));
  });

  mediaStream = new MediaStream();
  room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === "video") {
      mediaStream.addTrack(track.mediaStreamTrack);
      mediaElement.srcObject = mediaStream;
      mediaElement.play().catch(console.error);
      updateStatus("Video ready");
    } else if (track.kind === "audio") {
      // Audio via un élément séparé pour contourner les restrictions autoplay
      const audioEl = track.attach();
      audioEl.volume = 1.0;
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);
      audioEl.play().catch(console.error);
      updateStatus("Media stream ready");
    }
  });

  room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach(el => el.remove());
    if (track.kind === "video" && track.mediaStreamTrack) {
      mediaStream.removeTrack(track.mediaStreamTrack);
    }
  });

  room.on(LivekitClient.RoomEvent.Disconnected, (reason) => {
    updateStatus(`Room disconnected: ${reason}`, false);
  });

  await room.prepareConnection(sessionInfo.livekit_url, sessionInfo.livekit_client_token);
  updateStatus("Session created");
}

async function startStreamingSession() {
  await room.connect(sessionInfo.livekit_url, sessionInfo.livekit_client_token);
  updateStatus("Connected", true);

  document.getElementById("welcomeScreen").style.display = "none";
  document.getElementById("sessionScreen").style.display = "flex";

  // Sync la langue sélectionnée sur l'écran de session
  document.querySelectorAll(".lang-btn").forEach(b => {
    const lang = b.getAttribute("onclick").match(/'(\w+)'/)?.[1];
    b.classList.toggle("active", lang === selectedLanguage);
  });

  micBtn.disabled = false;
  talkBtn.disabled = false;
  taskInput.disabled = false;
  taskInput.placeholder = langConfig[selectedLanguage].placeholder;
  taskInput.focus();
}

async function closeSession() {
  // Toujours réinitialiser l'écran d'accueil
  document.getElementById("sessionScreen").style.display = "none";
  document.getElementById("welcomeScreen").style.display = "flex";

  const btn = document.getElementById("startWelcomeBtn");
  btn.disabled = false;
  btn.textContent = langConfig[selectedLanguage].startBtn;

  micBtn.disabled = true;
  talkBtn.disabled = true;
  taskInput.disabled = true;
  mediaElement.srcObject = null;

  if (sessionInfo) {
    await fetch("/api/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: sessionToken, session_id: sessionInfo.session_id }),
    }).catch(console.error);
  }

  if (webSocket) webSocket.close();
  if (room) room.disconnect();

  sessionInfo = null;
  sessionToken = null;
  room = null;
  mediaStream = null;
  conversationHistory = [];

  updateStatus("Session closed", false);
}

async function sendToOpenAIStreaming(userMessage, onChunk) {
  conversationHistory.push({ role: "user", content: userMessage });

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationHistory, language: selectedLanguage }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim() || line.trim() === "data: [DONE]") continue;
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              fullResponse += content;
              if (onChunk) onChunk(content, fullResponse);
            }
          } catch (e) {}
        }
      }
    }

    conversationHistory.push({ role: "assistant", content: fullResponse });
    return fullResponse;
  } catch (error) {
    console.error("Chat error:", error);
    updateStatus("Error communicating with AI", false);
    return null;
  }
}

async function sendTextFast(text) {
  if (!sessionInfo) { updateStatus("No active session", false); return; }

  updateStatus("AI is thinking...");
  let sentenceBuffer = "";
  let chunkCount = 0;
  const sentenceEnders = /[.!?。！？]/;

  await sendToOpenAIStreaming(text + " " + langConfig[selectedLanguage].replyInstruction, (chunk) => {
    sentenceBuffer += chunk;
    if (sentenceEnders.test(chunk)) {
      const sentence = sentenceBuffer.trim();
      if (sentence.length > 0) {
        speakViaLiveKit(sentence);
        console.log(`✅ Chunk ${++chunkCount} sent`);
        updateStatus(`Avatar speaking (chunk ${chunkCount})`);
        sentenceBuffer = "";
      }
    }
  });

  if (sentenceBuffer.trim().length > 0) {
    speakViaLiveKit(sentenceBuffer.trim());
  }
}

async function transcribeAudio(audioBlob) {
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
  formData.append("language", langConfig[selectedLanguage].code);

  try {
    const resp = await fetch("/api/transcribe", { method: "POST", body: formData });
    const data = await resp.json();
    if (data.text) return data.text;
    throw new Error("No transcription received");
  } catch (error) {
    console.error("Transcription error:", error);
    updateStatus("Error transcribing audio", false);
    return null;
  }
}

function detectSilence() {
  if (!analyser || !isContinuousMode) return;

  const dataArray = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(dataArray);

  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const n = (dataArray[i] - 128) / 128;
    sum += n * n;
  }
  const rms = Math.sqrt(sum / dataArray.length);

  const freqData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqData);
  const vStart = Math.floor(300 / (audioContext.sampleRate / analyser.fftSize));
  const vEnd = Math.floor(3400 / (audioContext.sampleRate / analyser.fftSize));
  let voiceEnergy = 0;
  for (let i = vStart; i < vEnd && i < freqData.length; i++) voiceEnergy += freqData[i];
  voiceEnergy /= (vEnd - vStart);

  const isSpeechDetected = rms > 0.05 && voiceEnergy > 55;

  if (isSpeechDetected) {
    if (!isSpeaking) {
      interruptAvatar();
      setTimeout(() => {
        if (isContinuousMode && !isSpeaking && !isRecording) {
          isSpeaking = true;
          startRecordingSegment();
        }
      }, 350);
    }
    if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }
  } else if (isSpeaking && !silenceTimeout) {
    silenceTimeout = setTimeout(() => {
      if (isRecording) stopRecordingSegment();
      isSpeaking = false;
      silenceTimeout = null;
    }, 1200);
  }

  if (isContinuousMode) requestAnimationFrame(detectSilence);
}

function startRecordingSegment() {
  if (!audioStream) return;
  audioChunks = [];
  mediaRecorder = new MediaRecorder(audioStream);
  mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
  mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    if (audioBlob.size > 1000) {
      updateStatus("Processing...");
      const transcription = await transcribeAudio(audioBlob);
      if (transcription?.trim()) {
        taskInput.value = transcription;
        sendTextFast(transcription);
      }
    }
  };
  mediaRecorder.start();
  isRecording = true;
}

function stopRecordingSegment() {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    isRecording = false;
  }
}

async function toggleRecording() {
  if (!isContinuousMode) {
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 },
      });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      audioContext.createMediaStreamSource(audioStream).connect(analyser);
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      isContinuousMode = true;
      micBtn.classList.add("recording");
      updateStatus("Listening...");
      detectSilence();
    } catch (e) {
      console.error("Mic error:", e);
      updateStatus("Could not access microphone", false);
    }
  } else {
    isContinuousMode = false;
    isSpeaking = false;
    if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }
    if (isRecording && mediaRecorder) { mediaRecorder.stop(); isRecording = false; }
    if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; }
    if (audioContext) { audioContext.close(); audioContext = null; analyser = null; }
    micBtn.classList.remove("recording");
    updateStatus("Listening stopped");
  }
}

window.startSession = async function startSession() {
  startWelcomeBtn.disabled = true;
  startWelcomeBtn.textContent = "Connexion en cours...";
  try {
    await createNewSession();
    await startStreamingSession();
  } catch (error) {
    updateStatus("Error: " + error.message, false);
    startWelcomeBtn.disabled = false;
    startWelcomeBtn.textContent = "Commencer la discussion";
  }
}

// Event listeners
taskInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 200) + "px";
});

taskInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (this.value.trim()) talkBtn.click();
  }
});

startWelcomeBtn.addEventListener("click", startSession);

closeBtn.addEventListener("click", closeSession);
micBtn.addEventListener("click", toggleRecording);

talkBtn.addEventListener("click", async () => {
  const text = taskInput.value.trim();
  if (text) {
    taskInput.value = "";
    taskInput.style.height = "auto";
    await sendTextFast(text);
  }
});