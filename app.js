// ============================================================
// SHADOWMARK — Core Game Logic
// ============================================================

const DEBUG_MODE = false; // Set true to show debug panel

// ——— FIREBASE CONFIG ———
// Replace with your Firebase project config
const firebaseConfig = {
    apiKey: "AIzaSyAMdGxGvZxWX9qCXyi4FROjkY7mYuD7P4w",
    authDomain: "secret-assassin-v1.firebaseapp.com",
    projectId: "secret-assassin-v1",
    storageBucket: "secret-assassin-v1.firebasestorage.app",
    messagingSenderId: "946220914680",
    appId: "1:946220914680:web:11ac26113052d2e182680d"
};

// ============================================================
// GLOBALS
// ============================================================

let FB = null; // Firebase SDK (loaded async)
let db = null;
let auth = null;

let currentUser = null;
let currentPlayerName = "";
let roomCode = localStorage.getItem("shadowmark_room") || null;
let roomRef = null;
let playerRef = null;
let unsubPlayers = null;
let unsubRoom = null;
let unsubMe = null;
let currentGameStatus = "lobby";
let aliveFlag = true;
let isDeadLocally = false;
let myTarget = null;
let myAssassinId = null;
let myAssassinTrigger = null;
let myTargetsTrigger = null;
let timerInterval = null;
let endTimestamp = null;
let sensorManager = null;
let motionGranted = false;
let micGranted = false;
let localTriggerCooldown = new Map();

// ============================================================
// TRIGGER DEFINITIONS
// ============================================================

const TRIGGERS = {
    SHAKE_PHONE: {
        id: "SHAKE_PHONE",
        action: "shake their phone violently",
        prompt: "Shake it. Hard.",
        hud: "make them shake their phone"
    },
    PHONE_FACE_DOWN: {
        id: "PHONE_FACE_DOWN",
        action: "place their phone face down",
        prompt: "Lay it face down on a surface.",
        hud: "get them to place their phone face down"
    },
    FLIP_UPSIDE_DOWN: {
        id: "FLIP_UPSIDE_DOWN",
        action: "flip their phone upside down",
        prompt: "Flip your phone completely upside down.",
        hud: "make them flip their phone upside down"
    },
    HOLD_FLAT_3S: {
        id: "HOLD_FLAT_3S",
        action: "hold their phone completely flat for 3 seconds",
        prompt: "Hold it flat. Perfectly level. Don't move.",
        hud: "get them to hold their phone flat for 3 seconds"
    }
};

const TRIGGER_KEYS = Object.keys(TRIGGERS);

// ============================================================
// UTILITIES
// ============================================================

function debugLog(msg) {
    if (!DEBUG_MODE) return;
    console.log("[SHADOWMARK]", msg);
    const panel = document.getElementById("debugLogPanel");
    if (panel) {
        panel.innerHTML += `> ${new Date().toLocaleTimeString()} ${msg}<br>`;
        panel.scrollTop = panel.scrollHeight;
    }
}

function showToast(msg) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
}

function render(html) {
    const root = document.getElementById("appRoot");
    if (root) root.innerHTML = html;
}

function debugPanel() {
    return DEBUG_MODE ? `<div class="debug-panel" id="debugLogPanel"></div>` : '';
}

// ============================================================
// SCREENS
// ============================================================

function showNameInput() {
    render(`
        <div class="screen fade-up">
            <div class="screen-header" style="padding-top: 4rem;">
                <div class="wordmark">SHADOWMARK</div>
                <span class="wordmark-sub">covert elimination protocol</span>
            </div>

            <p class="flavor-text fade-up fade-up-delay-1">
                Every agent needs a name.<br>Choose one you won't mind being remembered by.
            </p>

            <div class="input-group fade-up fade-up-delay-2">
                <span class="label">Codename</span>
                <input type="text" id="playerNameInput" placeholder="e.g. GHOST" maxlength="20" autocomplete="off">
            </div>

            <div class="spacer"></div>
            <button class="btn btn-primary fade-up fade-up-delay-3" id="confirmNameBtn">ENTER THE FIELD</button>
        </div>
    `);

    const input = document.getElementById("playerNameInput");
    const btn = document.getElementById("confirmNameBtn");

    btn?.addEventListener("click", confirmName);
    input?.addEventListener("keypress", e => { if (e.key === "Enter") confirmName(); });
    input?.focus();
}

function confirmName() {
    const name = document.getElementById("playerNameInput")?.value.trim().toUpperCase();
    if (!name) { showToast("You need a name, agent."); return; }
    currentPlayerName = name;
    localStorage.setItem("shadowmark_name", name);
    showHome();
}

function showHome() {
    render(`
        <div class="screen fade-up">
            <div class="screen-header" style="padding-top: 3rem;">
                <div class="wordmark">SHADOWMARK</div>
                <span class="wordmark-sub">welcome back, ${currentPlayerName}</span>
            </div>

            <p class="flavor-text fade-up fade-up-delay-1">
                Your city. Your rules.<br>Someone already has your name on a list.
            </p>

            <div class="fade-up fade-up-delay-2">
                <button class="btn btn-primary" id="createRoomBtn">🔪 OPEN A SAFEHOUSE</button>
            </div>

            <div class="divider fade-up fade-up-delay-3">or infiltrate</div>

            <div class="join-row fade-up fade-up-delay-3">
                <div style="flex:1;">
                    <span class="label">Room Code</span>
                    <input type="text" id="joinCodeInput" placeholder="X7K2MN" maxlength="6" autocomplete="off">
                </div>
                <button class="btn btn-secondary" id="joinRoomBtn">GO</button>
            </div>

            ${debugPanel()}
        </div>
    `);

    document.getElementById("createRoomBtn")?.addEventListener("click", createNewRoom);
    document.getElementById("joinRoomBtn")?.addEventListener("click", () => {
        const code = document.getElementById("joinCodeInput")?.value.trim().toUpperCase();
        if (code) joinRoom(code);
    });
    document.getElementById("joinCodeInput")?.addEventListener("keypress", e => {
        if (e.key === "Enter") {
            const code = e.target.value.trim().toUpperCase();
            if (code) joinRoom(code);
        }
    });
}

// ============================================================
// ROOM CREATION & JOINING
// ============================================================

async function createNewRoom() {
    if (!currentUser) return;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));

    const { doc, setDoc, collection, serverTimestamp } = FB;

    try {
        debugLog("Creating room: " + code);
        await setDoc(doc(db, "rooms", code), {
            hostId: currentUser.uid,
            status: "lobby",
            createdAt: serverTimestamp(),
            aliveCount: 0,
            winnerIds: []
        });
        await joinRoom(code);
    } catch(e) {
        debugLog("Error: " + e.message);
        showToast("Error creating room. Check console.");
    }
}

async function joinRoom(code) {
    if (!code || !currentUser) return;

    const { doc, getDoc, setDoc, updateDoc, collection, serverTimestamp } = FB;

    roomCode = code;
    localStorage.setItem("shadowmark_room", code);
    roomRef = doc(db, "rooms", code);

    const snap = await getDoc(roomRef);
    if (!snap.exists()) { showToast("No safehouse found with that code."); return; }

    const room = snap.data();
    if (room.status === "ended") { showToast("That operation is over."); return; }
    if (room.status === "active") {
        // Attempt rejoin
        const playerDoc = doc(collection(roomRef, "players"), currentUser.uid);
        const existing = await getDoc(playerDoc);
        if (existing.exists() && existing.data().alive) {
            debugLog("Rejoining active game");
            enterActiveGame();
            return;
        }
        showToast("Operation already in progress. You can't join mid-mission.");
        return;
    }

    playerRef = doc(collection(roomRef, "players"), currentUser.uid);
    const existing = await getDoc(playerRef);

    if (!existing.exists()) {
        await setDoc(playerRef, {
            name: currentPlayerName,
            alive: true,
            isHost: (room.hostId === currentUser.uid),
            joinedAt: serverTimestamp(),
            sensorReady: false,
            motionEnabled: false,
            micEnabled: false,
            connected: true,
            lastSeen: serverTimestamp(),
            targetId: null,
            assassinId: null,
            assassinTriggerId: null
        });
    } else {
        await updateDoc(playerRef, { connected: true, lastSeen: serverTimestamp() });
    }

    goToLobby();
}

// ============================================================
// LOBBY
// ============================================================

function goToLobby() {
    if (!roomCode) return;
    renderLobby();
    subscribeLobby();
}

function renderLobby() {
    render(`
        <div class="screen fade-up">
            <div class="room-code-display">
                <div class="room-code-value">${roomCode}</div>
                <div class="room-code-hint">Share this code. Trust no one who asks for it twice.</div>
            </div>

            <h3>AGENTS IN FIELD</h3>
            <div id="lobbyPlayerList" class="player-list" style="margin-top:0.8rem;">
                <p style="color:var(--text-dim); font-family:var(--font-mono); font-size:0.75rem;">Awaiting agents...</p>
            </div>

            <div id="sensorStatusArea" style="margin-bottom:1rem;"></div>

            <button class="btn btn-gold" id="readySensorBtn">📡 ARM YOURSELF</button>
            <button class="btn btn-primary" id="startGameBtn" disabled>▶ UNLEASH CHAOS</button>
            <button class="btn-ghost" id="leaveLobbyBtn">↩ ABORT MISSION</button>

            ${debugPanel()}
        </div>
    `);

    document.getElementById("readySensorBtn")?.addEventListener("click", requestSensorsAndReady);
    document.getElementById("startGameBtn")?.addEventListener("click", startGameTransaction);
    document.getElementById("leaveLobbyBtn")?.addEventListener("click", leaveRoom);
}

function subscribeLobby() {
    if (unsubPlayers) unsubPlayers();
    const { collection, onSnapshot } = FB;

    unsubPlayers = onSnapshot(collection(roomRef, "players"), snap => {
        const players = [];
        snap.forEach(d => players.push({ id: d.id, ...d.data() }));

        const container = document.getElementById("lobbyPlayerList");
        if (container) {
            let html = "";
            players.forEach(p => {
                html += `
                    <div class="player-item">
                        <span class="player-name">${p.name}</span>
                        <div class="player-badges">
                            ${p.isHost ? `<span class="badge badge-host">HOST</span>` : ""}
                            ${p.sensorReady
                                ? `<span class="badge badge-armed">ARMED</span>`
                                : `<span class="badge badge-pending">ARMING</span>`
                            }
                        </div>
                    </div>`;
            });
            container.innerHTML = html;
        }

        const armedCount = players.filter(p => p.sensorReady).length;
        const isHost = players.some(p => p.id === currentUser.uid && p.isHost);
        const startBtn = document.getElementById("startGameBtn");

        if (startBtn) {
            if (isHost && armedCount >= 3 && players.length >= 3) {
                startBtn.disabled = false;
                startBtn.textContent = `▶ UNLEASH CHAOS (${armedCount} ARMED)`;
            } else if (isHost) {
                startBtn.disabled = true;
                startBtn.textContent = `▶ UNLEASH CHAOS (${armedCount}/${players.length} ARMED, NEED 3)`;
            } else {
                startBtn.disabled = true;
                startBtn.textContent = `WAITING FOR HOST...`;
            }
        }

        debugLog(`Players: ${players.length}, Armed: ${armedCount}`);
    });
}

// ============================================================
// SENSORS & CALIBRATION
// ============================================================

async function requestSensorsAndReady() {
    motionGranted = false;
    micGranted = false;

    const area = document.getElementById("sensorStatusArea");
    if (area) area.innerHTML = `
        <div class="sensor-row">
            <div class="sensor-chip" id="chipMotion">
                <span class="sensor-icon">📡</span>
                <span class="sensor-label">Motion</span>
            </div>
            <div class="sensor-chip" id="chipMic">
                <span class="sensor-icon">🎙</span>
                <span class="sensor-label">Mic</span>
            </div>
        </div>`;

    // Motion
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        try {
            await DeviceOrientationEvent.requestPermission();
            motionGranted = true;
        } catch(e) { debugLog("Motion denied: " + e.message); }
    } else {
        motionGranted = true;
    }

    // Mic
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micGranted = true;
        stream.getTracks().forEach(t => t.stop());
    } catch(e) { debugLog("Mic denied: " + e.message); }

    // Update chips
    const chipMotion = document.getElementById("chipMotion");
    const chipMic = document.getElementById("chipMic");
    if (chipMotion) chipMotion.className = `sensor-chip ${motionGranted ? "granted" : "denied"}`;
    if (chipMic) chipMic.className = `sensor-chip ${micGranted ? "granted" : "denied"}`;

    if (!motionGranted) {
        showToast("⚠ Motion sensors unavailable. Some triggers may not work.");
    }

    const { doc, collection, updateDoc } = FB;
    await updateDoc(doc(collection(roomRef, "players"), currentUser.uid), {
        sensorReady: true,
        motionEnabled: motionGranted,
        micEnabled: micGranted
    });

    showToast("Armed and ready. Waiting for the host.");
}

// ============================================================
// START GAME
// ============================================================

async function startGameTransaction() {
    if (!roomRef) return;
    const { collection, getDocs, doc, updateDoc, writeBatch, serverTimestamp, Timestamp } = FB;

    const playersSnap = await getDocs(collection(roomRef, "players"));
    const players = [];
    playersSnap.forEach(d => {
        const data = d.data();
        if (data.alive !== false && data.sensorReady === true) {
            players.push({ id: d.id, data });
        }
    });

    if (players.length < 3) { showToast("Need at least 3 armed agents."); return; }

    // Shuffle
    const shuffled = players.map(p => p.id);
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Assign targets in a circle: A→B, B→C, C→A
    const targetMap = {};
    const assassinMap = {};
    for (let i = 0; i < shuffled.length; i++) {
        targetMap[shuffled[i]] = shuffled[(i + 1) % shuffled.length];
        assassinMap[shuffled[(i + 1) % shuffled.length]] = shuffled[i];
    }

    // Assign triggers (each player's trigger is what their assassin must make THEM do)
    const triggerAssignment = {};
    for (const pid of shuffled) {
        triggerAssignment[pid] = TRIGGER_KEYS[Math.floor(Math.random() * TRIGGER_KEYS.length)];
    }

    const endTime = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
    const batch = writeBatch(db);

    batch.update(roomRef, {
        status: "active",
        startedAt: Timestamp.now(),
        endTime,
        aliveCount: shuffled.length,
        lastUpdated: serverTimestamp()
    });

    for (const pid of shuffled) {
        batch.update(doc(collection(roomRef, "players"), pid), {
            targetId: targetMap[pid],
            assassinId: assassinMap[pid],
            assassinTriggerId: triggerAssignment[pid]
        });
    }

    await batch.commit();
    debugLog("Game started");
    enterActiveGame();
}

// ============================================================
// ACTIVE GAME
// ============================================================

async function enterActiveGame() {
    currentGameStatus = "active";
    const { doc, collection, getDoc } = FB;

    if (!playerRef) {
        playerRef = doc(collection(roomRef, "players"), currentUser.uid);
    }

    // Load my data
    const snap = await getDoc(playerRef);
    if (snap.exists()) {
        const data = snap.data();
        aliveFlag = data.alive;
        isDeadLocally = !aliveFlag;
        myTarget = data.targetId;
        myAssassinId = data.assassinId;
        myAssassinTrigger = data.assassinTriggerId;
    }

    showCalibration();
}

function showCalibration() {
    const steps = [
        { prompt: "SHAKE IT", sub: "As hard as you can. Mean it." },
        { prompt: "FACE DOWN", sub: "Lay it flat on a surface, screen down." },
        { prompt: "FLIP IT", sub: "Turn it completely upside down." },
        { prompt: "HOLD FLAT", sub: "Perfectly level. Like you're hiding a secret." }
    ];

    render(`
        <div class="screen calibration-screen fade-up">
            <h3 style="text-align:center; margin-bottom:0.5rem;">CALIBRATION</h3>
            <p class="flavor-text" style="text-align:center;">
                Before we begin — let's see what you're made of.
            </p>

            <div class="calibration-bar-wrap">
                <div class="calibration-bar-fill" id="calibBar"></div>
            </div>

            <div class="calibration-prompt" id="calibPrompt">${steps[0].prompt}</div>
            <div class="calibration-sub" id="calibSub">${steps[0].sub}</div>
            <div class="calibration-step-count" id="calibCount">1 / ${steps.length}</div>

            <div class="spacer"></div>
            <button class="btn btn-primary" id="calibNextBtn">DONE</button>
            <button class="btn-ghost" id="calibSkipBtn">SKIP CALIBRATION</button>
        </div>
    `);

    let step = 0;

    function advance() {
        step++;
        const bar = document.getElementById("calibBar");
        if (bar) bar.style.width = `${(step / steps.length) * 100}%`;

        if (step >= steps.length) {
            // Done — show mission
            setTimeout(showMission, 300);
            return;
        }

        const prompt = document.getElementById("calibPrompt");
        const sub = document.getElementById("calibSub");
        const count = document.getElementById("calibCount");
        if (prompt) { prompt.style.opacity = "0"; setTimeout(() => { prompt.textContent = steps[step].prompt; prompt.style.opacity = "1"; }, 150); }
        if (sub) sub.textContent = steps[step].sub;
        if (count) count.textContent = `${step + 1} / ${steps.length}`;
    }

    document.getElementById("calibNextBtn")?.addEventListener("click", advance);
    document.getElementById("calibSkipBtn")?.addEventListener("click", showMission);
}

async function showMission() {
    const { doc, collection, getDoc } = FB;

    // Fetch target name
    let targetName = "UNKNOWN";
    let methodText = "---";

    if (myTarget) {
        const targetSnap = await getDoc(doc(collection(roomRef, "players"), myTarget));
        if (targetSnap.exists()) {
            targetName = targetSnap.data().name;
            myTargetsTrigger = targetSnap.data().assassinTriggerId;
            methodText = TRIGGERS[myTargetsTrigger]?.hud || "a specific action";
        }
    }

    render(`
        <div class="screen fade-up">
            <h3 style="margin-bottom: 2rem;">YOUR ORDERS</h3>

            <div class="mission-card">
                <div class="mission-label">TARGET</div>
                <div class="mission-target">${targetName}</div>
                <div class="mission-method-label">METHOD</div>
                <div class="mission-method">${methodText}</div>
                <div class="mission-warning">
                    <p>⚠ Your assassin is already watching you.<br>They know exactly what makes you slip.</p>
                </div>
            </div>

            <p class="flavor-text" style="font-size:0.9rem;">
                Be subtle. Be patient. Be ruthless.<br>
                The clock starts when you do.
            </p>

            <div class="spacer"></div>
            <button class="btn btn-primary" id="startHuntBtn">🔒 I'VE READ THIS. START THE HUNT.</button>
        </div>
    `);

    document.getElementById("startHuntBtn")?.addEventListener("click", () => {
        startSensors();
        showGameHUD();
        subscribeActiveGame();
    });
}

function showGameHUD() {
    render(`
        <div class="screen fade-up">
            <div class="hud">
                <span class="hud-alive" id="aliveCountHUD">👥 --</span>
                <span class="hud-timer" id="timerDisplay">10:00</span>
                <span class="hud-status" id="statusBadge">HUNTING</span>
            </div>

            <div id="eliminatedBanner"></div>

            <div class="mission-card" id="missionCard">
                <div class="mission-label">TARGET</div>
                <div class="mission-target" id="targetName">---</div>
                <div class="mission-method-label">METHOD</div>
                <div class="mission-method" id="missionText">---</div>
            </div>

            <p class="flavor-text" id="flavorLine">
                Stay close. Stay quiet. Wait for your moment.
            </p>

            ${debugPanel()}
        </div>
    `);

    refreshMissionCard();
}

async function refreshMissionCard() {
    const { doc, collection, getDoc } = FB;
    if (!playerRef) return;

    const snap = await getDoc(playerRef);
    if (!snap.exists()) return;
    const data = snap.data();
    myTarget = data.targetId;
    myAssassinId = data.assassinId;
    myAssassinTrigger = data.assassinTriggerId;
    aliveFlag = data.alive;
    isDeadLocally = !aliveFlag;

    if (myTarget) {
        const targetSnap = await getDoc(doc(collection(roomRef, "players"), myTarget));
        if (targetSnap.exists()) {
            myTargetsTrigger = targetSnap.data().assassinTriggerId;
            const el = document.getElementById("targetName");
            const mt = document.getElementById("missionText");
            if (el) el.textContent = targetSnap.data().name;
            if (mt) mt.textContent = TRIGGERS[myTargetsTrigger]?.hud || "---";
        }
    }

    if (!aliveFlag) {
        document.body.classList.add("is-dead");
        const banner = document.getElementById("eliminatedBanner");
        if (banner) banner.innerHTML = `
            <div class="eliminated-banner">
                <p>☠ YOU HAVE BEEN ELIMINATED</p>
            </div>`;
        const statusBadge = document.getElementById("statusBadge");
        if (statusBadge) { statusBadge.textContent = "ELIMINATED"; statusBadge.style.color = "var(--text-dim)"; }
    }
}

// ============================================================
// SUBSCRIPTIONS
// ============================================================

function subscribeActiveGame() {
    if (unsubRoom) unsubRoom();
    if (unsubMe) unsubMe();
    const { onSnapshot, doc, collection } = FB;

    unsubRoom = onSnapshot(roomRef, snap => {
        const data = snap.data();
        if (!data) return;

        if (data.endTime?.toMillis) {
            endTimestamp = data.endTime.toMillis();
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(updateTimer, 1000);
            updateTimer();
        }

        const aliveEl = document.getElementById("aliveCountHUD");
        if (aliveEl && data.aliveCount !== undefined) {
            aliveEl.textContent = `👥 ${data.aliveCount} alive`;
        }

        if (data.status === "ended") {
            handleGameOver(data.winnerIds);
        }
    });

    if (!playerRef) playerRef = doc(collection(roomRef, "players"), currentUser.uid);

    unsubMe = onSnapshot(playerRef, snap => {
        if (!snap.exists()) return;
        const me = snap.data();

        // Was alive, now dead
        if (aliveFlag && me.alive === false && !isDeadLocally) {
            isDeadLocally = true;
            aliveFlag = false;
            if (sensorManager) sensorManager.destroy();
            document.body.classList.add("is-dead");
            showToast("☠ You've been eliminated.");
            refreshMissionCard();
        }

        // Target changed (new assignment after kill)
        if (me.targetId && me.targetId !== myTarget) {
            myTarget = me.targetId;
            myAssassinTrigger = me.assassinTriggerId;
            refreshMissionCard();
            showToast("🎯 Target neutralised. New assignment incoming.");
        }

        aliveFlag = me.alive;
        myTarget = me.targetId;
        myAssassinId = me.assassinId;
        myAssassinTrigger = me.assassinTriggerId;
    });
}

// ============================================================
// TIMER
// ============================================================

function updateTimer() {
    if (!endTimestamp) return;
    const diff = Math.max(0, endTimestamp - Date.now());
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const el = document.getElementById("timerDisplay");
    if (el) {
        el.textContent = `${m}:${s < 10 ? "0" + s : s}`;
        el.classList.toggle("urgent", diff < 60000);
    }
    if (diff <= 0 && currentGameStatus === "active") endGameByTimer();
}

async function endGameByTimer() {
    currentGameStatus = "ended";
    const { doc, getDocs, query, where, updateDoc, collection } = FB;
    const roomSnap = await FB.getDoc(roomRef);
    if (roomSnap.exists() && roomSnap.data().status !== "ended") {
        const aliveQuery = await getDocs(query(collection(roomRef, "players"), where("alive", "==", true)));
        const winners = [];
        aliveQuery.forEach(d => winners.push(d.id));
        await updateDoc(roomRef, { status: "ended", winnerIds: winners });
    }
}

// ============================================================
// SENSORS
// ============================================================

function startSensors() {
    if (sensorManager) sensorManager.destroy();
    sensorManager = new SensorManager();
    sensorManager.init();
}

class SensorManager {
    constructor() {
        this.active = true;
        this.graceEnd = Date.now() + 8000; // 8s grace — read your mission first
        this.flatBuffer = [];
        this.rafId = null;
        this.mediaStream = null;
        this.audioCtx = null;
        this.micAnalyser = null;
        this._onMotion = this._onMotion.bind(this);
        this._onOrientation = this._onOrientation.bind(this);
    }

    async init() {
        if (!aliveFlag || isDeadLocally) return;
        window.addEventListener("devicemotion", this._onMotion);
        window.addEventListener("deviceorientation", this._onOrientation);
        debugLog("Sensors live");
    }

    _onMotion(e) {
        if (!this.active || !aliveFlag || Date.now() < this.graceEnd) return;
        if (!myAssassinTrigger) return;

        const acc = e.accelerationIncludingGravity;
        if (!acc) return;
        const mag = Math.sqrt((acc.x||0)**2 + (acc.y||0)**2 + (acc.z||0)**2);

        if (myAssassinTrigger === "SHAKE_PHONE" && mag > 30) {
            this._triggerFired("SHAKE_PHONE");
        }
    }

    _onOrientation(e) {
        if (!this.active || !aliveFlag || Date.now() < this.graceEnd) return;
        if (!myAssassinTrigger) return;

        const beta = e.beta || 0;
        const gamma = e.gamma || 0;

        if (myAssassinTrigger === "PHONE_FACE_DOWN" && Math.abs(beta) > 140) {
            this._triggerFired("PHONE_FACE_DOWN");
        }

        if (myAssassinTrigger === "FLIP_UPSIDE_DOWN" && beta < -90) {
            this._triggerFired("FLIP_UPSIDE_DOWN");
        }

        if (myAssassinTrigger === "HOLD_FLAT_3S") {
            const isFlat = Math.abs(beta) < 12 && Math.abs(gamma) < 12;
            if (isFlat) {
                this.flatBuffer.push(Date.now());
                this.flatBuffer = this.flatBuffer.filter(t => Date.now() - t < 3100);
                if (this.flatBuffer.length > 10) {
                    this._triggerFired("HOLD_FLAT_3S");
                }
            } else {
                this.flatBuffer = [];
            }
        }
    }

    _triggerFired(triggerId) {
        if (!aliveFlag || isDeadLocally) return;

        const cooldown = localTriggerCooldown.get(triggerId);
        if (cooldown && cooldown > Date.now()) return;
        localTriggerCooldown.set(triggerId, Date.now() + 12000);

        debugLog(`Trigger fired: ${triggerId}`);
        this.showGuessScreen();
    }

    showGuessScreen() {
        // Pause sensors briefly
        this.active = false;

        // Get list of alive suspects (everyone except self)
        // We'll fetch from Firestore
        const { getDocs, query, where, collection } = FB;
        getDocs(query(collection(roomRef, "players"), where("alive", "==", true))).then(snap => {
            const suspects = [];
            snap.forEach(d => {
                if (d.id !== currentUser.uid) suspects.push({ id: d.id, ...d.data() });
            });

            // Overlay the guess screen on top
            const existing = document.getElementById("guessOverlay");
            if (existing) existing.remove();

            const overlay = document.createElement("div");
            overlay.id = "guessOverlay";
            overlay.style.cssText = `
                position: fixed; inset: 0; background: var(--black);
                z-index: 1000; overflow-y: auto; padding: 2rem 1.5rem;
                display: flex; flex-direction: column; max-width: 480px; margin: 0 auto;
            `;

            let suspectsHTML = suspects.map(s => `
                <button class="suspect-btn" data-id="${s.id}" data-name="${s.name}">
                    <span>${s.name}</span>
                    <span class="suspect-arrow">→</span>
                </button>
            `).join("");

            overlay.innerHTML = `
                <div class="guess-header fade-up">
                    <span class="guess-eye">👁</span>
                    <h2>SOMEONE MADE THEIR MOVE</h2>
                    <p class="flavor-text" style="text-align:center;">
                        A move was just detected on your phone.<br>
                        Think carefully. Who's been too close? Too friendly?
                    </p>
                    <h3 style="text-align:center; margin-bottom:1rem;">WHO IS YOUR ASSASSIN?</h3>
                </div>

                <div class="guess-suspects">
                    ${suspectsHTML}
                </div>

                <button class="btn btn-secondary" id="guessTakeHitBtn">
                    Take the hit — I have no idea
                </button>
            `;

            document.body.appendChild(overlay);

            // Suspect buttons
            overlay.querySelectorAll(".suspect-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    const guessedId = btn.dataset.id;
                    const guessedName = btn.dataset.name;
                    overlay.remove();
                    this.resolveGuess(guessedId, guessedName);
                });
            });

            // Take the hit
            document.getElementById("guessTakeHitBtn")?.addEventListener("click", () => {
                overlay.remove();
                this.resolveGuess(null, null);
            });
        });
    }

    async resolveGuess(guessedId, guessedName) {
        // Was the guess correct?
        const correctAssassin = myAssassinId;
        const guessedCorrectly = guessedId === correctAssassin;

        if (guessedId === null) {
            // No guess — take the elimination
            await this._eliminateSelf();
            showGuessResult(false, null);
        } else if (guessedCorrectly) {
            // Correct — eliminate the assassin instead
            await this._eliminatePlayer(correctAssassin);
            showGuessResult(true, guessedName);
        } else {
            // Wrong — self eliminate
            await this._eliminateSelf();
            showGuessResult(false, guessedName);
        }

        // Resume sensors if still alive
        setTimeout(() => { this.active = aliveFlag && !isDeadLocally; }, 2000);
    }

    async _eliminateSelf() {
        if (!aliveFlag || isDeadLocally) return;
        debugLog("Eliminating self");
        await this._runEliminationTransaction(currentUser.uid, true);
    }

    async _eliminatePlayer(playerId) {
        debugLog("Eliminating player: " + playerId);
        await this._runEliminationTransaction(playerId, false);
    }

    async _runEliminationTransaction(victimId, isSelf) {
        const { runTransaction, doc, collection, getDocs, updateDoc } = FB;

        try {
            await runTransaction(db, async transaction => {
                const victimRef = doc(collection(roomRef, "players"), victimId);
                const victimSnap = await transaction.get(victimRef);
                const roomSnap = await transaction.get(roomRef);

                if (!victimSnap.exists() || victimSnap.data().alive === false) return;
                if (roomSnap.data().status !== "active") return;

                const victimData = victimSnap.data();
                const newAliveCount = Math.max(0, (roomSnap.data().aliveCount || 1) - 1);

                // Mark victim dead
                transaction.update(victimRef, { alive: false });

                // Re-link the chain: victim's assassin now targets victim's target
                const victimAssassinId = victimData.assassinId;
                const victimTargetId = victimData.targetId;

                if (victimAssassinId && victimTargetId && victimAssassinId !== victimId) {
                    const assassinRef = doc(collection(roomRef, "players"), victimAssassinId);
                    transaction.update(assassinRef, { targetId: victimTargetId });
                }

                // Update alive count
                transaction.update(roomRef, {
                    aliveCount: newAliveCount,
                    lastUpdated: FB.serverTimestamp()
                });

                // Check for last survivor
                if (newAliveCount <= 1) {
                    // Winner is whoever survives — will be resolved via endGameByTimer or snapshot
                    // We set status ended here and let the winner be determined by alive query
                }
            });
        } catch(e) {
            debugLog("Transaction error: " + e.message);
        }

        if (isSelf) {
            isDeadLocally = true;
            aliveFlag = false;
            this.destroy();
        }
    }

    destroy() {
        this.active = false;
        window.removeEventListener("devicemotion", this._onMotion);
        window.removeEventListener("deviceorientation", this._onOrientation);
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.mediaStream) this.mediaStream.getTracks().forEach(t => t.stop());
        if (this.audioCtx) this.audioCtx.close();
        debugLog("Sensors destroyed");
    }
}

// ============================================================
// GUESS RESULT
// ============================================================

function showGuessResult(survived, guessedName) {
    const existing = document.getElementById("resultOverlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "resultOverlay";
    overlay.style.cssText = `
        position: fixed; inset: 0; background: var(--black);
        z-index: 1001; display: flex; align-items: center;
        justify-content: center; padding: 2rem;
    `;

    if (survived) {
        overlay.innerHTML = `
            <div class="result-screen fade-up">
                <span class="result-icon">✅</span>
                <div class="result-title success">NICE CATCH</div>
                <p class="result-sub">
                    You spotted the shadow before it got you.<br>
                    <strong style="color:var(--gold);">${guessedName}</strong> has been neutralised.
                </p>
                <button class="btn btn-gold" id="resultContinue">BACK TO THE HUNT</button>
            </div>`;
    } else {
        overlay.innerHTML = `
            <div class="result-screen fade-up">
                <span class="result-icon">☠</span>
                <div class="result-title danger">WRONG CALL</div>
                <p class="result-sub">
                    ${guessedName
                        ? `<strong style="color:var(--red);">${guessedName}</strong> wasn't your assassin.<br>`
                        : ''
                    }The shadows don't forgive mistakes.<br>You've been eliminated.
                </p>
                <button class="btn btn-secondary" id="resultContinue">SPECTATE</button>
            </div>`;
    }

    document.body.appendChild(overlay);
    document.getElementById("resultContinue")?.addEventListener("click", () => {
        overlay.remove();
        refreshMissionCard();
    });
}

// ============================================================
// GAME OVER
// ============================================================

async function handleGameOver(winnerIds) {
    if (timerInterval) clearInterval(timerInterval);
    if (sensorManager) sensorManager.destroy();
    currentGameStatus = "ended";

    const { getDocs, collection } = FB;

    // Fetch winner names
    let winnerLines = "";
    if (winnerIds && winnerIds.length > 0) {
        const playersSnap = await getDocs(collection(roomRef, "players"));
        const winnerNames = [];
        playersSnap.forEach(d => {
            if (winnerIds.includes(d.id)) winnerNames.push(d.data().name);
        });

        if (winnerNames.length === 1) {
            winnerLines = `
                <span class="winner-name">${winnerNames[0]}</span>
                <p class="flavor-text" style="text-align:center;">
                    Every agent in the city had their name.<br>
                    None of them were good enough.
                </p>`;
        } else {
            winnerLines = `
                <h3 style="text-align:center; margin-bottom:0.8rem;">SURVIVORS</h3>
                <div class="survivors-list">
                    ${winnerNames.map(n => `<div class="survivor-item">${n}</div>`).join("")}
                </div>
                <p class="flavor-text" style="text-align:center;">
                    Time ran out. The contracts remain open.
                </p>`;
        }
    }

    const isWinner = winnerIds && winnerIds.includes(currentUser.uid);

    render(`
        <div class="screen fade-up" style="text-align:center;">
            <div style="padding-top: 4rem;">
                <span class="result-icon" style="font-size: 4rem; display:block; margin-bottom:1rem;">
                    ${isWinner ? "🏆" : "☠"}
                </span>
                <div class="result-title ${isWinner ? "success" : ""}" style="margin-bottom:0.5rem;">
                    ${winnerIds?.length === 1 ? "THE LAST SHADOW" : "TIME'S UP"}
                </div>
                ${winnerLines}
            </div>
            <div class="spacer"></div>
            <button class="btn btn-primary" id="runItBackBtn">🔁 RUN IT BACK</button>
            <button class="btn-ghost" id="quitBtn">DISAPPEAR</button>
        </div>
    `);

    document.getElementById("runItBackBtn")?.addEventListener("click", () => {
        localStorage.removeItem("shadowmark_room");
        window.location.reload();
    });
    document.getElementById("quitBtn")?.addEventListener("click", () => {
        localStorage.clear();
        window.location.reload();
    });
}

// ============================================================
// LEAVE ROOM
// ============================================================

async function leaveRoom() {
    if (roomRef && currentUser) {
        const { doc, collection, updateDoc } = FB;
        await updateDoc(doc(collection(roomRef, "players"), currentUser.uid), { connected: false });
    }
    if (unsubPlayers) unsubPlayers();
    if (unsubRoom) unsubRoom();
    if (unsubMe) unsubMe();
    localStorage.removeItem("shadowmark_room");
    window.location.reload();
}

// ============================================================
// BOOT
// ============================================================

function boot() {
    debugLog("Booting Shadowmark...");
    const { initializeApp, getAuth, signInAnonymously, onAuthStateChanged, getFirestore } = FB;

    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    onAuthStateChanged(auth, user => {
        if (!user) {
            debugLog("Signing in anonymously...");
            signInAnonymously(auth).catch(e => {
                debugLog("Auth error: " + e.message);
                render(`
                    <div class="screen" style="text-align:center; justify-content:center;">
                        <h2>FIREBASE ERROR</h2>
                        <p class="flavor-text">${e.message}</p>
                        <p style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-dim);">
                            Enable Anonymous Auth in your Firebase console.
                        </p>
                        <button class="btn btn-secondary" onclick="location.reload()">RETRY</button>
                    </div>`);
            });
            return;
        }

        currentUser = user;
        debugLog("Authenticated: " + user.uid);

        const savedName = localStorage.getItem("shadowmark_name");
        const savedRoom = localStorage.getItem("shadowmark_room");

        if (savedName) {
            currentPlayerName = savedName;
            if (savedRoom) {
                roomCode = savedRoom;
                const { doc, getFirestore } = FB;
                roomRef = FB.doc(db, "rooms", savedRoom);
                // Attempt rejoin
                FB.getDoc(roomRef).then(snap => {
                    if (!snap.exists() || snap.data().status === "ended") {
                        localStorage.removeItem("shadowmark_room");
                        showHome();
                    } else if (snap.data().status === "active") {
                        enterActiveGame();
                    } else {
                        goToLobby();
                    }
                }).catch(() => showHome());
            } else {
                showHome();
            }
        } else {
            showNameInput();
        }
    });
}

// Poll until Firebase module script has finished loading
function waitForFirebase() {
    if (window._firebase) {
        FB = window._firebase;
        boot();
    } else {
        setTimeout(waitForFirebase, 50);
    }
}
waitForFirebase();
