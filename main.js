// === FULL UPDATED main.js WITH CONTINUOUS IDLE ===

const App = {
    state: {
        queuedVid: null,
        isSleeping: false,
    },

    elements: {},

    async init() {
        this.cacheElements();
        this.setupIdleVideo();
        this.startIdleLoop();
    },

    cacheElements() {
        this.elements.mainVideo = document.getElementById("myVideo");
        this.elements.idleVideo = document.getElementById("idleVideo");
    },

    // =========================
    // 🎬 IDLE VIDEO (ALWAYS RUNNING)
    // =========================

    startIdleLoop() {
        const idle = this.elements.idleVideo;
        if (!idle) return;

        idle.loop = true;
        idle.muted = true;

        idle.play().catch(err => {
            console.error("Idle autoplay failed:", err);
        });
    },

    // =========================
    // 🎬 PLAY OVERLAY VIDEO
    // =========================

    async playVideoNow(videoUrl) {
        const vid = this.changeVid(videoUrl);
        if (!vid) return;

        vid.style.opacity = "1";

        try {
            await vid.play();
        } catch (err) {
            console.error("Error playing video:", err);
            vid.style.opacity = "0";
            return;
        }

        vid.onended = () => {
            vid.pause();
            vid.currentTime = 0;
            vid.style.opacity = "0";
        };
    },

    // =========================
    // 🎬 VIDEO SETUP
    // =========================

    changeVid(url) {
        const vid = this.elements.mainVideo;
        if (!vid) return null;

        vid.src = url;
        vid.load();
        vid.currentTime = 0;
        vid.muted = false;

        return vid;
    },

    // =========================
    // 🔁 QUEUED VIDEO HANDLING
    // =========================

    setupIdleVideo() {
        const idle = this.elements.idleVideo;
        if (!idle) return;

        idle.onended = async () => {
            if (this.state.isSleeping) return;

            if (this.state.queuedVid) {
                const url = this.state.queuedVid;
                this.state.queuedVid = null;

                const vid = this.changeVid(url);
                if (!vid) return;

                vid.style.opacity = "1";

                try {
                    await vid.play();
                } catch (err) {
                    console.error("Error playing queued video:", err);
                    vid.style.opacity = "0";
                    return;
                }

                vid.onended = () => {
                    vid.pause();
                    vid.currentTime = 0;
                    vid.style.opacity = "0";
                };
            }
        };
    },

    // =========================
    // 🔁 SWITCH BACK (NO RESET)
    // =========================

    switchIdle() {
        const vid = this.elements.mainVideo;

        if (vid) {
            vid.pause();
            vid.currentTime = 0;
            vid.style.opacity = "0";
        }
        // IMPORTANT: DO NOT TOUCH idleVideo
    },

    // =========================
    // ⏸ STOP MEDIA (SAFE)
    // =========================

    stopAllMedia() {
        const vid = this.elements.mainVideo;
        if (vid) {
            vid.pause();
            vid.currentTime = 0;
        }
    }
};

window.App = App;

document.addEventListener("DOMContentLoaded", async () => {
    await App.init();
});