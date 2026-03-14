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
        sessionId: null
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
        ttsVoiceName: "es-US-Chirp3-HD-Iapetus"
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

    init() {
        this.cacheElements();
        this.initSession();
        this.bindEvents();
        this.showMaria();
        this.setupIdleVideo();
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

    bindEvents() {
        this.elements.sendButton?.addEventListener("click", () => this.sendMessage());

        this.elements.userInput?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.sendMessage();
            }
        });

        const buttons = document.querySelectorAll(".disc_category");
        buttons.forEach(button => {
            button.addEventListener("click", () => {
                const sceneContent = button.nextElementSibling;
                if (!sceneContent) return;

                sceneContent.style.display =
                    sceneContent.style.display === "block" ? "none" : "block";
            });
        });

        document.querySelectorAll(".close-button").forEach(button => {
            button.addEventListener("click", () => {
                const popup = button.closest(".popup-overlay");
                if (popup) popup.style.display = "none";
            });
        });
    },

    setupIdleVideo() {
        const idle = this.elements.idleVideo;
        if (!idle) return;

        idle.onended = async () => {
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
                idle.play().catch(err => console.error("Idle replay failed:", err));
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
            idle.play().catch(err => console.error("Idle play failed:", err));
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

    appendMessage(text, sender) {
        const div = document.createElement("div");
        div.textContent = text;
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

    async sendMessage() {
        if (this.state.isSending) return;

        const text = this.elements.userInput?.value.trim();
        if (!text) return;

        this.state.isSending = true;

        const userBubble = this.appendMessage(text, "user");
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
            const similarity = res.similarity;

            botBubble.textContent = replyText;

            if (this.isIntentVideo(replyId)) {
                this.state.numUnfocusedQuestions = 0;

                const videoId = String(replyId).padStart(3, "0");
                const videoURL = this.config.AWS_videoURL_Base + videoId + ".mp4";
                console.log("Queueing video:", videoURL, "Similarity:", similarity);

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
            botBubble.textContent = "Sorry, there was a connection error. Please try again.";
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

            audioPlayer.play().catch(err => {
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
            this.state.stream.getTracks().forEach(track => track.stop());
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

document.addEventListener("DOMContentLoaded", () => {
    App.init();
});