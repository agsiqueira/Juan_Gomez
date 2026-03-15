const App = {
    state: {
        numUnfocusedQuestions: 0,
        logData: [],
        queuedVid: null,
        isSending: false,
        isRecording: false,
        mediaRecorder: null,
        audioChunks: [],
        audioContext: null,
        analyser: null,
        sourceNode: null,
        silenceStart: null,
        silenceDetectInterval: null,
        stream: null,
        sessionId: null,
        opioidPromptIntervalId: null,
        interactionStartTime: null,
        foundDiscoveries: new Set(),
        sleepTimeoutId: null,
        isSleeping: false
    },

    config: {
        AWS_videoURL_Base: "https://agsdentistry.s3.us-east-1.amazonaws.com/assets/videos/interaction/",
        ENDPOINT_URL: "https://verg-api-zone.cise.ufl.edu/",
        intentMinId: 1,
        intentMaxId: 150,
        silenceThreshold: 0.2,
        silenceDelay: 2000,
        sttLanguageCode: "en",
        ttsLanguageCode: "es-US",
        ttsVoiceName: "es-US-Chirp3-HD-Iapetus",
        opioidPromptIntervalMs: 3 * 60 * 1000,
        opioidVideoId: 427,
        opioidText: "I'm in pain. Don't bother with the regular stuff; it never works. I need something much stronger. Can I have percocet?",
        teethReactionVideoId: 428,
        totalDiscoveriesTarget: 15,
        sleepVideoFileName: "sleep.mp4",
        sleepAfterMs: 4 * 60 * 1000
    },

    elements: {
        audioPlayer: null,
        chatBox: null,
        userInput: null,
        sendButton: null,
        micButton: null,
        mainVideo: null,
        idleVideo: null,
        question: null,
        reply: null,
        gptAnswer: null,
        focusPopup: null,
        outroIframe: null
    },

    discoveryDefinitions: {},
    answerIndexToDiscovery: {},
    sceneConfig: {},

    async init() {
        this.cacheElements();
        this.initSession();
        this.state.interactionStartTime = Date.now();

        await this.loadDiscoveryMap();

        this.bindEvents();
        this.showMaria();
        this.setupIdleVideo();
        this.startOpioidPromptTimer();
        this.resetSleepTimer();
        setTimeout(() => this.setupSTT(), 1500);
    },

    cacheElements() {
        this.elements.audioPlayer = document.getElementById("myAudio");
        this.elements.chatBox = document.getElementById("chat-box");
        this.elements.userInput = document.getElementById("chatInput");
        this.elements.sendButton = document.getElementById("send-button");
        this.elements.micButton = document.getElementById("mic-button");
        this.elements.mainVideo = document.getElementById("myVideo");
        this.elements.idleVideo = document.getElementById("idleVideo");
        this.elements.question = document.getElementById("question");
        this.elements.reply = document.getElementById("reply");
        this.elements.gptAnswer = document.getElementById("gptAnswer");
        this.elements.focusPopup = document.getElementById("focusPopup");
        this.elements.outroIframe = document.getElementById("outro");
    },

    initSession() {
        let sessionId = sessionStorage.getItem("vh_session_id");
        if (!sessionId) {
            sessionId = crypto.randomUUID();
            sessionStorage.setItem("vh_session_id", sessionId);
        }
        this.state.sessionId = sessionId;
    },

    async loadDiscoveryMap() {
        const response = await fetch("./discoveryMap.json");

        if (!response.ok) {
            throw new Error(`Failed to load discoveryMap.json: HTTP ${response.status}`);
        }

        const data = await response.json();

        this.discoveryDefinitions = data.discoveryDefinitions || {};
        this.answerIndexToDiscovery = data.answerIndexToDiscovery || {};
        this.sceneConfig = data.sceneConfig || {};

        if (data.config?.totalDiscoveriesTarget) {
            this.config.totalDiscoveriesTarget = data.config.totalDiscoveriesTarget;
        }
    },

    getSleepVideoUrl() {
        return this.config.AWS_videoURL_Base + this.config.sleepVideoFileName;
    },

    markUserInteraction() {
        if (this.state.isSleeping) {
            this.wakeUpFromSleep();
        }
        this.resetSleepTimer();
    },

    resetSleepTimer() {
        if (this.state.sleepTimeoutId) {
            clearTimeout(this.state.sleepTimeoutId);
        }

        this.state.sleepTimeoutId = setTimeout(() => {
            this.enterSleepMode();
        }, this.config.sleepAfterMs);
    },

    enterSleepMode() {
        if (this.state.isSleeping) return;

        const mainVideoPlaying =
            this.elements.mainVideo &&
            !this.elements.mainVideo.paused &&
            this.elements.mainVideo.ended === false &&
            this.elements.mainVideo.style.opacity === "1";

        const audioPlaying =
            this.elements.audioPlayer &&
            !this.elements.audioPlayer.paused &&
            this.elements.audioPlayer.ended === false;

        if (mainVideoPlaying || audioPlaying || this.state.isSending || this.state.isRecording) {
            this.resetSleepTimer();
            return;
        }

        this.state.isSleeping = true;

        if (this.state.opioidPromptIntervalId) {
            clearInterval(this.state.opioidPromptIntervalId);
            this.state.opioidPromptIntervalId = null;
        }

        const sleepUrl = this.getSleepVideoUrl();
        const idle = this.elements.idleVideo;
        const vid = this.changeVid(sleepUrl);

        if (!idle || !vid) return;

        this.stopAllMedia();

        idle.pause();
        idle.style.opacity = "0";
        vid.style.opacity = "1";

        vid.onended = async () => {
            if (!this.state.isSleeping) return;

            vid.currentTime = 0;
            try {
                await vid.play();
            } catch (err) {
                console.error("Sleep replay failed:", err);
            }
        };

        vid.play().catch((err) => {
            console.error("Error starting sleep video:", err);
        });
    },

    wakeUpFromSleep() {
        if (!this.state.isSleeping) return;

        this.state.isSleeping = false;
        this.switchIdle();
        this.startOpioidPromptTimer();
    },

    bindEvents() {
        this.elements.sendButton?.addEventListener("click", () => {
            this.markUserInteraction();
            this.sendMessage();
        });

        this.elements.userInput?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.markUserInteraction();
                this.sendMessage();
            }
        });

        const buttons = document.querySelectorAll(".disc_category");
        buttons.forEach((button) => {
            button.addEventListener("click", () => {
                const sceneContent = button.nextElementSibling;
                if (!sceneContent) return;

                sceneContent.style.display =
                    sceneContent.style.display === "block" ? "none" : "block";
            });
        });

        const inspectBtn = document.getElementById("inspectTeethBtn");
        if (inspectBtn) {
            inspectBtn.addEventListener("click", async () => {
                this.markUserInteraction();

                const videoURL = this.getVideoUrlById(this.config.teethReactionVideoId);

                this.state.logData.push([
                    "[SYSTEM ACTION]",
                    "User inspected teeth",
                    "teeth_inspection"
                ]);

                const idle = this.elements.idleVideo;
                const vid = this.changeVid(videoURL);

                if (!idle || !vid) {
                    const popup = document.getElementById("teethPopup");
                    if (popup) popup.style.display = "flex";
                    this.registerDiscovery("pain_tooth_exam");
                    return;
                }

                this.stopAllMedia();

                idle.pause();
                idle.style.opacity = "0";
                vid.style.opacity = "1";

                try {
                    await vid.play();
                } catch (err) {
                    console.error("Error playing teeth inspection reaction video:", err);
                    this.switchIdle();
                    const popup = document.getElementById("teethPopup");
                    if (popup) popup.style.display = "flex";
                    this.registerDiscovery("pain_tooth_exam");
                    return;
                }

                vid.onended = () => {
                    this.switchIdle();

                    const popup = document.getElementById("teethPopup");
                    if (popup) popup.style.display = "flex";

                    this.registerDiscovery("pain_tooth_exam");
                };
            });
        }

        document.querySelectorAll(".close-button").forEach((button) => {
            button.addEventListener("click", () => {
                const popup = button.closest(".popup-overlay");
                if (popup) popup.style.display = "none";
            });
        });
    },

    updateDiscoveriesHeader() {
        const header = document.querySelector("#discoveries .title-wrapper");
        if (header) {
            header.textContent = `Discoveries (${this.state.foundDiscoveries.size}/${this.config.totalDiscoveriesTarget})`;
        }
    },

    getSceneDiscoveryCount(sceneNumber) {
        let count = 0;
        for (const discoveryId of this.state.foundDiscoveries) {
            const discovery = this.discoveryDefinitions[discoveryId];
            if (discovery && discovery.scene === sceneNumber) {
                count += 1;
            }
        }
        return count;
    },

    registerDiscovery(discoveryId) {
        if (!discoveryId) return;
        if (this.state.foundDiscoveries.has(discoveryId)) return;

        const discovery = this.discoveryDefinitions[discoveryId];
        if (!discovery) return;

        this.state.foundDiscoveries.add(discoveryId);

        const sceneInfo = this.sceneConfig[String(discovery.scene)] || this.sceneConfig[discovery.scene];
        if (!sceneInfo) return;

        const listEl = document.getElementById(sceneInfo.listId);
        const headerEl = document.getElementById(sceneInfo.headerId);

        if (listEl) {
            const newDisc = document.createElement("div");
            newDisc.textContent = `- ${discovery.desc}`;
            listEl.prepend(newDisc);
        }

        const sceneCount = this.getSceneDiscoveryCount(discovery.scene);

        if (headerEl) {
            headerEl.textContent = `${sceneInfo.category} (${sceneCount}/${sceneInfo.total})`;
        }

        this.updateDiscoveriesHeader();

        const sceneButton = headerEl?.parentElement;
        if (sceneButton) {
            sceneButton.classList.add("active");
        }

        const sceneContent = sceneButton?.nextElementSibling;
        if (sceneContent) {
            sceneContent.style.display = "block";
        }
    },

    maybeRegisterDiscoveryFromAnswer(answerIndex) {
        const discoveryId = this.answerIndexToDiscovery[String(answerIndex)] ?? this.answerIndexToDiscovery[answerIndex];
        if (discoveryId) {
            this.registerDiscovery(discoveryId);
        }
    },

    setupIdleVideo() {
        const idle = this.elements.idleVideo;
        if (!idle) return;

        idle.onended = async () => {
            if (this.state.isSleeping) return;

            if (this.state.queuedVid) {
                const url = this.state.queuedVid;
                this.state.queuedVid = null;

                const vid = this.changeVid(url);

                idle.style.opacity = "0";
                vid.style.opacity = "1";

                try {
                    await vid.play();
                } catch (err) {
                    console.error("Error playing response video:", err);
                    this.switchIdle();
                    return;
                }

                vid.onended = () => {
                    this.switchIdle();
                };
            } else {
                idle.currentTime = 0;
                idle.play().catch((err) => console.error("Idle replay failed:", err));
            }
        };
    },

    showMaria() {
        if (this.elements.mainVideo) this.elements.mainVideo.style.display = "block";
        if (this.elements.idleVideo) this.elements.idleVideo.style.display = "block";
    },

    switchIdle() {
        const video = this.elements.mainVideo;
        const idle = this.elements.idleVideo;

        if (video) {
            video.pause();
            video.style.opacity = "0";
        }

        if (idle) {
            idle.currentTime = 0;
            idle.style.opacity = "1";
            idle.play().catch((err) => console.error("Idle play failed:", err));
        }
    },

    stopAllMedia() {
        if (this.elements.audioPlayer) {
            this.elements.audioPlayer.pause();
            this.elements.audioPlayer.currentTime = 0;
            this.elements.audioPlayer.onended = null;
        }

        if (this.elements.mainVideo) {
            this.elements.mainVideo.pause();
            this.elements.mainVideo.currentTime = 0;
        }
    },

    changeVid(url) {
        const vid = this.elements.mainVideo;
        if (!vid) return null;

        vid.src = url;
        vid.load();
        vid.muted = false;
        vid.currentTime = 0;
        return vid;
    },

    getElapsedTimeLabel() {
        if (!this.state.interactionStartTime) return "[00:00]";

        const elapsedMs = Date.now() - this.state.interactionStartTime;
        const totalSeconds = Math.floor(elapsedMs / 1000);

        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}]`;
    },

    formatChatMessageWithTime(text) {
        return `${this.getElapsedTimeLabel()} ${text}`;
    },

    appendMessage(text, sender) {
        const div = document.createElement("div");
        div.textContent = this.formatChatMessageWithTime(text);
        div.className = `df-message-bubble ${sender}`;
        this.elements.chatBox?.appendChild(div);
        this.scrollChatToBottom();
        return div;
    },

    scrollChatToBottom() {
        const chatBox = this.elements.chatBox;
        if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
    },

    normalizeReplyId(raw) {
        const id = Number(raw);
        return Number.isInteger(id) ? id : -1;
    },

    isIntentVideo(replyId) {
        return replyId >= this.config.intentMinId && replyId <= this.config.intentMaxId;
    },

    getVideoUrlById(videoId) {
        return this.config.AWS_videoURL_Base + String(videoId).padStart(3, "0") + ".mp4";
    },

    isIdleCurrentlyVisible() {
        const idle = this.elements.idleVideo;
        const main = this.elements.mainVideo;

        if (!idle || !main) return false;

        const idleVisible = idle.style.opacity === "1";
        const mainHidden = main.style.opacity === "0" || main.paused;

        return idleVisible && mainHidden;
    },

    async playVideoNow(videoUrl) {
        const idle = this.elements.idleVideo;
        const vid = this.changeVid(videoUrl);
        if (!idle || !vid) return;

        this.stopAllMedia();

        idle.pause();
        idle.style.opacity = "0";
        vid.style.opacity = "1";

        try {
            await vid.play();
        } catch (err) {
            console.error("Error playing immediate video:", err);
            this.switchIdle();
            return;
        }

        vid.onended = () => {
            this.switchIdle();
        };
    },

    startOpioidPromptTimer() {
        if (this.state.opioidPromptIntervalId) {
            clearInterval(this.state.opioidPromptIntervalId);
        }

        this.state.opioidPromptIntervalId = setInterval(() => {
            this.triggerOpioidPrompt();
        }, this.config.opioidPromptIntervalMs);
    },

    stopOpioidPromptTimer() {
        if (this.state.opioidPromptIntervalId) {
            clearInterval(this.state.opioidPromptIntervalId);
            this.state.opioidPromptIntervalId = null;
        }
    },

    async triggerOpioidPrompt() {
        if (this.state.isSleeping) return;

        const videoUrl = this.getVideoUrlById(this.config.opioidVideoId);

        console.log("Triggering opioid prompt video:", videoUrl);

        this.state.logData.push([
            "[SYSTEM TIMER] Juan opioid request",
            this.config.opioidText,
            this.config.opioidVideoId
        ]);

        this.appendMessage(this.config.opioidText, "bot");
        this.registerDiscovery("opioid_requests_percocet");

        const mainVideoPlaying =
            this.elements.mainVideo &&
            !this.elements.mainVideo.paused &&
            this.elements.mainVideo.ended === false &&
            this.elements.mainVideo.style.opacity === "1";

        const audioPlaying =
            this.elements.audioPlayer &&
            !this.elements.audioPlayer.paused &&
            this.elements.audioPlayer.ended === false;

        if (!mainVideoPlaying && !audioPlaying && this.isIdleCurrentlyVisible()) {
            await this.playVideoNow(videoUrl);
        } else {
            this.state.queuedVid = videoUrl;
        }
    },

    async sendMessage() {
        if (this.state.isSending) return;

        const text = this.elements.userInput?.value.trim();
        if (!text) return;

        if (this.state.isSleeping) {
            this.wakeUpFromSleep();
        }

        this.state.isSending = true;

        this.appendMessage(text, "user");
        const botBubble = this.appendMessage("...", "bot");

        this.elements.userInput.value = "";

        console.log("Input to GPT:", text);

        try {
            const response = await fetch(this.config.ENDPOINT_URL + "JuanGomez/chat_exact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    session_id: this.state.sessionId
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const res = await response.json();
            console.log("GPT Response:", res);

            const replyText = typeof res.answer === "string" && res.answer.trim()
                ? res.answer
                : "Sorry, I could not generate a response.";
            const replyId = this.normalizeReplyId(res.answer_index);

            botBubble.textContent = this.formatChatMessageWithTime(replyText);

            this.maybeRegisterDiscoveryFromAnswer(replyId);

            if (this.isIntentVideo(replyId)) {
                this.state.numUnfocusedQuestions = 0;

                const videoURL = this.getVideoUrlById(replyId);
                console.log("Queueing video:", videoURL);

                this.stopAllMedia();
                this.state.queuedVid = videoURL;
            } else {
                await this.generateTTS(replyText);

                if (this.elements.question) this.elements.question.innerText = text;
                if (this.elements.reply) this.elements.reply.innerText = replyText;
                if (this.elements.gptAnswer) this.elements.gptAnswer.style.display = "flex";

                await this.playAudioReply();
                this.state.numUnfocusedQuestions++;
            }

            this.state.logData.push([text, replyText, replyId]);

            console.log("Num Unfocused Questions:", this.state.numUnfocusedQuestions);
            if (this.state.numUnfocusedQuestions >= 3) {
                this.unfocusedPopUp();
            }
        } catch (error) {
            console.error("Error calling GPT API:", error);
            botBubble.textContent = this.formatChatMessageWithTime("Sorry, there was a connection error. Please try again.");
        } finally {
            this.state.isSending = false;
        }
    },

    unfocusedPopUp() {
        if (this.elements.focusPopup) {
            this.elements.focusPopup.style.display = "flex";
        }
    },

    async generateTTS(gptResponse) {
        const cleanedResponse = String(gptResponse || "").replace(/\([^)]*\)/g, "").trim();

        try {
            const payload = {
                text: cleanedResponse,
                language_code: this.config.ttsLanguageCode,
                voice_name: this.config.ttsVoiceName
            };

            const response = await fetch(this.config.ENDPOINT_URL + "api/googlecloudtts", {
                headers: { "Content-Type": "application/json" },
                method: "POST",
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`TTS HTTP ${response.status}`);
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            this.elements.audioPlayer.src = audioUrl;
        } catch (error) {
            console.error("Error in TTS:", error);
            throw error;
        }
    },

    playAudioReply() {
        return new Promise((resolve, reject) => {
            const audioPlayer = this.elements.audioPlayer;
            if (!audioPlayer) {
                resolve();
                return;
            }

            audioPlayer.onended = () => {
                this.switchIdle();
                resolve();
            };

            audioPlayer.play().catch((err) => {
                console.error("Audio play failed:", err);
                this.switchIdle();
                reject(err);
            });
        });
    },

    getRMS(arr) {
        let sumSquares = 0;
        for (const val of arr) {
            sumSquares += val * val;
        }
        return Math.sqrt(sumSquares / arr.length) / 255;
    },

    setupSTT() {
        const micButton = this.elements.micButton;
        if (!micButton || micButton.dataset.initialized === "true") return;

        micButton.dataset.initialized = "true";

        micButton.addEventListener("click", () => {
            if (!this.state.isRecording) {
                this.markUserInteraction();
                this.startRecording();
            }
        });
    },

    async startRecording() {
        try {
            this.state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.state.mediaRecorder = new MediaRecorder(this.state.stream);
            this.state.audioChunks = [];

            this.state.audioContext = new AudioContext();
            this.state.analyser = this.state.audioContext.createAnalyser();
            this.state.sourceNode = this.state.audioContext.createMediaStreamSource(this.state.stream);
            this.state.sourceNode.connect(this.state.analyser);
            this.state.analyser.fftSize = 512;

            this.state.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.state.audioChunks.push(e.data);
                }
            };

            this.state.mediaRecorder.onstop = async () => {
                try {
                    const mimeType = this.state.mediaRecorder?.mimeType || "audio/webm";
                    const audioBlob = new Blob(this.state.audioChunks, { type: mimeType });
                    this.state.audioChunks = [];

                    const extension = (audioBlob.type.split("/")[1] || "webm").split(";")[0];

                    const formData = new FormData();
                    formData.append("audio", audioBlob, `recording.${extension}`);
                    formData.append("language_code", this.config.sttLanguageCode);

                    const response = await fetch(this.config.ENDPOINT_URL + "api/googlecloudstt", {
                        method: "POST",
                        body: formData
                    });

                    if (!response.ok) {
                        throw new Error(`STT HTTP ${response.status}`);
                    }

                    const result = await response.json();
                    console.log("Server response:", result);

                    const transcript = (result.transcript || "").trim();
                    if (!transcript) {
                        console.warn("No transcript returned.");
                        return;
                    }

                    this.elements.userInput.value = transcript;
                    this.elements.userInput.dispatchEvent(new Event("input", { bubbles: true }));
                    await this.sendMessage();
                } catch (error) {
                    console.error("Error in STT:", error);
                } finally {
                    this.cleanupRecordingResources();
                }
            };

            this.state.mediaRecorder.start();
            this.state.isRecording = true;

            if (this.elements.micButton) {
                this.elements.micButton.innerHTML = "⏳";
                this.elements.micButton.title = "Gravando...";
            }

            this.state.silenceStart = null;
            this.state.silenceDetectInterval = setInterval(() => {
                if (!this.state.analyser) return;

                const arr = new Uint8Array(this.state.analyser.frequencyBinCount);
                this.state.analyser.getByteFrequencyData(arr);

                const rms = this.getRMS(arr);

                if (rms < this.config.silenceThreshold) {
                    if (!this.state.silenceStart) {
                        this.state.silenceStart = Date.now();
                    } else if (Date.now() - this.state.silenceStart > this.config.silenceDelay) {
                        this.stopRecording();
                    }
                } else {
                    this.state.silenceStart = null;
                }
            }, 100);
        } catch (error) {
            console.error("Could not start recording:", error);
            this.cleanupRecordingResources();
        }
    },

    stopRecording() {
        if (this.state.mediaRecorder && this.state.mediaRecorder.state === "recording") {
            this.state.mediaRecorder.stop();
        }
        this.state.isRecording = false;

        if (this.elements.micButton) {
            this.elements.micButton.innerHTML = "🎤";
            this.elements.micButton.title = "Clique para falar";
        }
    },

    cleanupRecordingResources() {
        if (this.state.silenceDetectInterval) {
            clearInterval(this.state.silenceDetectInterval);
            this.state.silenceDetectInterval = null;
        }

        if (this.state.audioContext) {
            this.state.audioContext.close().catch(() => {});
            this.state.audioContext = null;
        }

        this.state.analyser = null;
        this.state.sourceNode = null;
        this.state.silenceStart = null;

        if (this.state.stream) {
            this.state.stream.getTracks().forEach((track) => track.stop());
            this.state.stream = null;
        }

        this.state.mediaRecorder = null;
        this.state.isRecording = false;

        if (this.elements.micButton) {
            this.elements.micButton.innerHTML = "🎤";
            this.elements.micButton.title = "Clique para falar";
        }
    },

    async createLogFile() {
        const formUrl = "https://docs.google.com/forms/d/e/1FAIpQLSfPxO3FT8BRMBOmWop4U7ljOiOE5lnTIb3nqTPvoFwcKqJxxQ/formResponse";
        const fieldIds = {
            question: "entry.413257006",
            answer: "entry.253578126",
            intentId: "entry.329507193"
        };

        for (const row of this.state.logData) {
            try {
                const formData = new FormData();
                formData.append(fieldIds.question, row[0]);
                formData.append(fieldIds.answer, row[1]);
                formData.append(fieldIds.intentId, row[2]);

                await fetch(formUrl, {
                    method: "POST",
                    body: formData,
                    mode: "no-cors"
                });

                console.log("Log sent:", row);
            } catch (error) {
                console.error("Failed to send log row:", row, error);
            }
        }
    },

    async redirectPage() {
        this.stopOpioidPromptTimer();

        if (this.state.sleepTimeoutId) {
            clearTimeout(this.state.sleepTimeoutId);
            this.state.sleepTimeoutId = null;
        }

        await this.createLogFile();

        const outroIframe = this.elements.outroIframe;
        if (!outroIframe) return;

        outroIframe.style.display = "block";

        try {
            const video7 = outroIframe.contentWindow.document.getElementById("myVideo7");
            if (video7) {
                video7.style.display = "block";
                video7.currentTime = 0;
                await video7.play();
            }
        } catch (err) {
            console.log("Video play failed:", err);
        }
    }
};

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await App.init();
    } catch (error) {
        console.error("Failed to initialize app:", error);
    }
});
