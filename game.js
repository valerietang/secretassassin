const firebaseConfig = {
    apiKey: "AIzaSyAMdGxGvZxWX9qCXyi4FROjkY7mYuD7P4w",
    authDomain: "secret-assassin-v1.firebaseapp.com",
    projectId: "secret-assassin-v1",
    storageBucket: "secret-assassin-v1.firebasestorage.app",
    messagingSenderId: "946220914680",
    appId: "1:946220914680:web:11ac26113052d2e182680d"
};

import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, collection, runTransaction, query, where, getDocs, writeBatch, serverTimestamp, Timestamp } from "firebase/firestore";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Global variables
let currentUser = null;
let roomCode = localStorage.getItem("assassin_room") || null;
let roomRef = null;
let playerRef = null;
let unsubPlayers = null;
let unsubRoom = null;
let unsubMe = null;
let currentGameStatus = "lobby";
let aliveFlag = true;
let myTarget = null;
let myTrigger = null;
let timerInterval = null;
let endTimestamp = null;
let sensorManager = null;
let pendingEliminationModal = false;
let localTriggerCooldown = new Map();
let isDeadLocally = false;

// Helper functions
function debugLog(msg) {
    console.log("[ASSASSIN]", msg);
    const panel = document.getElementById("debugLogPanel");
    if (panel) {
        panel.innerHTML += "> " + new Date().toLocaleTimeString() + " " + msg + "<br>";
        panel.scrollTop = panel.scrollHeight;
    }
}

function showToast(msg) {
    alert(msg);
}

function render(html) {
    const root = document.getElementById("appRoot");
    if (root) root.innerHTML = html;
}

// Home screen
function showHome() {
    render(`
        <div class="card" style="text-align:center">
            <h1>⚔️ Secret Assassin ⚔️</h1>
            <br>
            <p>eliminate your target, stay alive</p>
            <br>
            <button id="createRoomBtn">🔪 CREATE ROOM</button>
            <button id="joinRoomBtn">🔗 JOIN ROOM</button>
            <input id="joinCodeInput" placeholder="Enter Room Code" style="display:none" />
            <div class="debug-panel" id="debugLogPanel"></div>
        </div>
    `);
    
    document.getElementById("createRoomBtn")?.addEventListener("click", createNewRoom);
    const joinBtn = document.getElementById("joinRoomBtn");
    const joinInput = document.getElementById("joinCodeInput");
    joinBtn?.addEventListener("click", function() {
        if (joinInput.style.display === "none") {
            joinInput.style.display = "flex";
        } else {
            joinInput.style.display = "none";
        }
    });
    joinInput?.addEventListener("keypress", function(e) {
        if (e.key === "Enter") {
            joinRoom(joinInput.value.trim().toUpperCase());
        }
    });
}

// Create room
async function createNewRoom() {
    if (!currentUser) {
        showToast("Waiting for authentication...");
        return;
    }
    
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const roomData = {
        hostId: currentUser.uid,
        status: "lobby",
        createdAt: serverTimestamp(),
        aliveCount: 0,
        winnerIds: []
    };
    
    try {
        debugLog("Creating room: " + code);
        await setDoc(doc(db, "rooms", code), roomData);
        await joinRoom(code);
    } catch(e) {
        debugLog("Error: " + e.message);
        showToast("Error creating room: " + e.message);
    }
}

// Join room
async function joinRoom(code) {
    if (!code || !currentUser) return;
    
    roomCode = code;
    localStorage.setItem("assassin_room", code);
    roomRef = doc(db, "rooms", code);
    
    const snap = await getDoc(roomRef);
    if (!snap.exists()) {
        showToast("Room not found");
        return;
    }
    
    const room = snap.data();
    if (room.status !== "lobby") {
        showToast("Game already started");
        return;
    }
    
    const playerDoc = doc(collection(roomRef, "players"), currentUser.uid);
    const existing = await getDoc(playerDoc);
    
    if (!existing.exists()) {
        await setDoc(playerDoc, {
            name: "Agent_" + Math.floor(Math.random() * 1000),
            alive: true,
            isHost: (room.hostId === currentUser.uid),
            joinedAt: serverTimestamp(),
            sensorReady: false,
            motionEnabled: false,
            micEnabled: false,
            connected: true,
            lastSeen: serverTimestamp(),
            targetId: null,
            triggerId: null
        });
    } else {
        await updateDoc(playerDoc, { connected: true, lastSeen: serverTimestamp() });
    }
    
    goToLobby();
}

// Lobby
function goToLobby() {
    if (!roomCode) return;
    renderLobbyUI();
    subscribeLobby();
}

function renderLobbyUI() {
    render(`
        <div class="card">
            <h2>🔪 LOBBY: ${roomCode}</h2>
            <div id="lobbyPlayerList" class="player-list">Loading players...</div>
            <button id="readySensorBtn">📡 ENABLE SENSORS </button>
            <button id="startGameBtn" style="background:#0f3b2c" disabled>▶ START GAME (min. 3 players)</button>
            <button id="leaveLobbyBtn">🚪 LEAVE</button>
            <div class="debug-panel" id="debugLogPanel"></div>
        </div>
    `);
    
    document.getElementById("readySensorBtn")?.addEventListener("click", requestSensorsAndReady);
    document.getElementById("startGameBtn")?.addEventListener("click", startGameTransaction);
    document.getElementById("leaveLobbyBtn")?.addEventListener("click", leaveRoom);
}

async function requestSensorsAndReady() {
    if (!currentUser) return;
    
    let motionGranted = false;
    let micGranted = false;
    
    // Request motion permission for iOS
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        try {
            await DeviceOrientationEvent.requestPermission();
            motionGranted = true;
        } catch(e) {
            debugLog("Motion denied");
        }
    } else {
        motionGranted = true;
    }
    
    // Request mic
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micGranted = true;
        stream.getTracks().forEach(function(t) { t.stop(); });
    } catch(e) {
        debugLog("Mic denied");
    }
    
    const playerDoc = doc(collection(roomRef, "players"), currentUser.uid);
    await updateDoc(playerDoc, {
        sensorReady: true,
        motionEnabled: motionGranted,
        micEnabled: micGranted
    });
    
    showToast("Sensors ready! ✅");
}

function subscribeLobby() {
    if (unsubPlayers) unsubPlayers();
    
    const playersQuery = collection(roomRef, "players");
    unsubPlayers = onSnapshot(playersQuery, function(snap) {
        const players = [];
        snap.forEach(function(d) {
            players.push({ id: d.id, ...d.data() });
        });
        
        const container = document.getElementById("lobbyPlayerList");
        if (container) {
            let html = "";
            for (let i = 0; i < players.length; i++) {
                const p = players[i];
                html += '<div class="player-item">';
                html += '<span>' + p.name;
                if (p.isHost) html += ' <span class="badge-host">HOST</span>';
                html += '</span>';
                html += '<span>' + (p.sensorReady ? '✅ READY' : '⏳') + '</span>';
                html += '</div>';
            }
            container.innerHTML = html;
        }
        
        const readyCount = players.filter(function(p) { return p.sensorReady; }).length;
        const startBtn = document.getElementById("startGameBtn");
        if (startBtn && readyCount >= 3 && players.length >= 3) {
            startBtn.disabled = false;
        } else if (startBtn) {
            startBtn.disabled = true;
        }
        
        debugLog("Players: " + players.length + ", Ready: " + readyCount);
    });
}

// Start game
async function startGameTransaction() {
    if (!roomRef) return;
    
    const playersSnap = await getDocs(collection(roomRef, "players"));
    const players = [];
    playersSnap.forEach(function(d) {
        const data = d.data();
        if (data.alive !== false && data.sensorReady === true) {
            players.push({ id: d.id, data: data });
        }
    });
    
    if (players.length < 3) {
        showToast("Need 3 ready players");
        return;
    }
    
    // Shuffle
    const shuffled = [];
    for (let i = 0; i < players.length; i++) {
        shuffled.push(players[i].id);
    }
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = temp;
    }
    
    // Assign targets (closed loop)
    const targetMap = {};
    for (let i = 0; i < shuffled.length; i++) {
        targetMap[shuffled[i]] = shuffled[(i + 1) % shuffled.length];
    }
    
    // Assign triggers
    const triggersList = ["SHAKE_PHONE", "PHONE_FACE_DOWN", "TILT_LEFT_RIGHT", "LOUD_NOISE", "SUSTAINED_MOVEMENT_3S", "PHONE_PICKED_UP"];
    const triggerAssign = {};
    for (let i = 0; i < shuffled.length; i++) {
        const pid = shuffled[i];
        triggerAssign[pid] = triggersList[Math.floor(Math.random() * triggersList.length)];
    }
    
    const startedAt = Timestamp.now();
    const endTime = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
    const batch = writeBatch(db);
    
    batch.update(roomRef, {
        status: "active",
        startedAt: startedAt,
        endTime: endTime,
        aliveCount: shuffled.length,
        lastUpdated: serverTimestamp()
    });
    
    for (let i = 0; i < shuffled.length; i++) {
        const pid = shuffled[i];
        const playerDoc = doc(collection(roomRef, "players"), pid);
        batch.update(playerDoc, {
            targetId: targetMap[pid],
            triggerId: triggerAssign[pid],
            alive: true
        });
    }
    
    await batch.commit();
    debugLog("Game started");
    enterActiveGame();
}

// Active game
function enterActiveGame() {
    currentGameStatus = "active";
    startGameHUD();
    subscribeActiveGame();
    
    if (sensorManager) {
        sensorManager.destroy();
    }
    sensorManager = new SensorManager();
    sensorManager.init();
}

function startGameHUD() {
    render(`
        <div>
            <div class="hud">
                <span id="aliveCountHUD">👥 --</span>
                <span id="timerDisplay" class="timer">10:00</span>
                <span id="statusBadge">🔪 ACTIVE</span>
            </div>
            <div class="mission-card">
                <h3>🎯 TARGET</h3>
                <div id="targetName">---</div>
                <div id="missionText">loading...</div>
            </div>
            <div class="debug-panel" id="debugLogPanel"></div>
        </div>
    `);
    updateActiveUI();
}

async function updateActiveUI() {
    if (!playerRef) return;
    
    const snap = await getDoc(playerRef);
    if (snap.exists()) {
        const data = snap.data();
        aliveFlag = data.alive;
        isDeadLocally = !aliveFlag;
        myTarget = data.targetId;
        myTrigger = data.triggerId;
        
        if (myTarget) {
            const targetSnap = await getDoc(doc(collection(roomRef, "players"), myTarget));
            const targetElem = document.getElementById("targetName");
            if (targetElem) {
                targetElem.innerHTML = targetSnap.exists() ? targetSnap.data().name : "unknown";
            }
        }
        
        const missionElem = document.getElementById("missionText");
        if (missionElem) {
            missionElem.innerHTML = getMissionText(myTrigger);
        }
    }
    
    if (!aliveFlag) {
        document.body.classList.add("dead-overlay");
    } else {
        document.body.classList.remove("dead-overlay");
    }
}

function getMissionText(triggerId) {
    const map = {
        "SHAKE_PHONE": "SHAKE your phone violently",
        "PHONE_FACE_DOWN": "Place phone FACE DOWN",
        "TILT_LEFT_RIGHT": "TILT left/right sharply",
        "LOUD_NOISE": "Make LOUD noise (clap/scream)",
        "SUSTAINED_MOVEMENT_3S": "Move continuously 3 seconds",
        "PHONE_PICKED_UP": "PICK UP phone"
    };
    return map[triggerId] || "eliminate target";
}

function subscribeActiveGame() {
    if (unsubRoom) unsubRoom();
    
    unsubRoom = onSnapshot(roomRef, function(snap) {
        const data = snap.data();
        if (data && data.endTime && data.endTime.toMillis) {
            endTimestamp = data.endTime.toMillis();
            updateTimerDisplay();
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(updateTimerDisplay, 1000);
        }
        if (data && data.aliveCount !== undefined) {
            const aliveElem = document.getElementById("aliveCountHUD");
            if (aliveElem) {
                aliveElem.innerHTML = "👥 " + data.aliveCount;
            }
        }
        if (data && data.status === "ended") {
            endGameHandler(data.winnerIds);
        }
    });
    
    playerRef = doc(collection(roomRef, "players"), currentUser.uid);
    if (unsubMe) unsubMe();
    
    unsubMe = onSnapshot(playerRef, function(snap) {
        if (snap.exists()) {
            const me = snap.data();
            aliveFlag = me.alive;
            if (!aliveFlag && !isDeadLocally) {
                isDeadLocally = true;
                if (sensorManager) sensorManager.destroy();
                showToast("☠️ YOU ARE DEAD");
            }
            myTarget = me.targetId;
            myTrigger = me.triggerId;
            updateActiveUI();
        }
    });
}

function updateTimerDisplay() {
    if (!endTimestamp) return;
    
    const diff = Math.max(0, endTimestamp - Date.now());
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    const timerElem = document.getElementById("timerDisplay");
    if (timerElem) {
        timerElem.innerHTML = minutes + ":" + (seconds < 10 ? "0" + seconds : seconds);
    }
    
    if (diff <= 0 && currentGameStatus === "active") {
        endGameByTimer();
    }
}

async function endGameByTimer() {
    const roomSnap = await getDoc(roomRef);
    if (roomSnap.exists() && roomSnap.data().status !== "ended") {
        const alivePlayersQuery = await getDocs(query(collection(roomRef, "players"), where("alive", "==", true)));
        const winners = [];
        alivePlayersQuery.forEach(function(d) {
            winners.push(d.id);
        });
        await updateDoc(roomRef, { status: "ended", winnerIds: winners });
    }
}

function endGameHandler(winnerIds) {
    if (timerInterval) clearInterval(timerInterval);
    if (sensorManager) sensorManager.destroy();
    currentGameStatus = "ended";
    
    render(`
        <div class="card">
            <h1>🏆 GAME OVER</h1>
            <p>Game ended</p>
            <button id="backHome">🏠 Main Menu</button>
        </div>
    `);
    
    document.getElementById("backHome")?.addEventListener("click", function() {
        localStorage.removeItem("assassin_room");
        window.location.reload();
    });
}

// Leave room
async function leaveRoom() {
    if (roomRef && currentUser) {
        const playerDoc = doc(collection(roomRef, "players"), currentUser.uid);
        await updateDoc(playerDoc, { connected: false });
    }
    localStorage.removeItem("assassin_room");
    window.location.reload();
}

// Sensor Manager
class SensorManager {
    constructor() {
        this.active = true;
        this.graceEnd = Date.now() + 3000;
        this.motionBuffer = [];
        this.micAnalyser = null;
        this.mediaStream = null;
        this.micInterval = null;
        this.handleMotion = this.handleMotion.bind(this);
        this.handleOrientation = this.handleOrientation.bind(this);
    }
    
    async init() {
        if (!aliveFlag) return;
        
        window.addEventListener("devicemotion", this.handleMotion);
        window.addEventListener("deviceorientation", this.handleOrientation);
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaStream = stream;
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioCtx();
            const source = audioCtx.createMediaStreamSource(stream);
            this.micAnalyser = audioCtx.createAnalyser();
            source.connect(this.micAnalyser);
            this.micAnalyser.fftSize = 256;
            this.startMicCheck();
        } catch(e) {
            debugLog("Mic not available");
        }
        
        document.addEventListener("visibilitychange", function() {
            if (document.hidden) {
                this.active = false;
            } else {
                this.active = true;
            }
        }.bind(this));
    }
    
    startMicCheck() {
        const checkMic = function() {
            if (!this.active || !aliveFlag || !this.micAnalyser) return;
            
            const data = new Uint8Array(this.micAnalyser.frequencyBinCount);
            this.micAnalyser.getByteTimeDomainData(data);
            let max = 0;
            for (let i = 0; i < data.length; i++) {
                const v = (data[i] - 128) / 128;
                if (Math.abs(v) > max) max = Math.abs(v);
            }
            
            if (max > 0.65 && myTrigger === "LOUD_NOISE") {
                this.attemptElimination();
            }
            
            this.micInterval = requestAnimationFrame(checkMic.bind(this));
        }.bind(this);
        
        checkMic();
    }
    
    handleMotion(e) {
        if (!this.active || !aliveFlag || Date.now() < this.graceEnd) return;
        
        const acc = e.accelerationIncludingGravity;
        const mag = Math.sqrt(
            (acc.x || 0) * (acc.x || 0) +
            (acc.y || 0) * (acc.y || 0) +
            (acc.z || 0) * (acc.z || 0)
        );
        
        if (myTrigger === "SHAKE_PHONE" && mag > 28) {
            this.attemptElimination();
        }
        
        if (myTrigger === "SUSTAINED_MOVEMENT_3S") {
            this.motionBuffer.push(Date.now());
            this.motionBuffer = this.motionBuffer.filter(function(t) {
                return Date.now() - t < 3000;
            });
            if (this.motionBuffer.length > 8) {
                this.attemptElimination();
            }
        }
    }
    
    handleOrientation(e) {
        if (!this.active || !aliveFlag || Date.now() < this.graceEnd) return;
        
        const beta = e.beta || 0;
        const gamma = e.gamma || 0;
        
        if (myTrigger === "PHONE_FACE_DOWN" && Math.abs(beta) > 70) {
            this.attemptElimination();
        }
        if (myTrigger === "TILT_LEFT_RIGHT" && Math.abs(gamma) > 45) {
            this.attemptElimination();
        }
        if (myTrigger === "PHONE_PICKED_UP" && beta < -20 && Math.abs(gamma) < 30) {
            this.attemptElimination();
        }
    }
    
    attemptElimination() {
        if (!aliveFlag || pendingEliminationModal) return;
        
        const cooldownTime = localTriggerCooldown.get(myTrigger);
        if (cooldownTime && cooldownTime > Date.now()) return;
        
        localTriggerCooldown.set(myTrigger, Date.now() + 10000);
        this.showEliminationModal();
    }
    
    showEliminationModal() {
        pendingEliminationModal = true;
        
        const modalDiv = document.createElement("div");
        modalDiv.className = "modal-full";
        modalDiv.innerHTML = `
            <div class="card">
                <h2>🔪 ELIMINATION CONFIRM</h2>
                <p>Were you eliminated by your assassin?</p>
                <div class="btn-group">
                    <button id="confirmYes">YES, I'm dead</button>
                    <button id="confirmNo">NO, false alarm</button>
                </div>
            </div>
        `;
        document.body.appendChild(modalDiv);
        
        document.getElementById("confirmYes")?.addEventListener("click", async function() {
            await this.confirmElimination(true);
            modalDiv.remove();
            pendingEliminationModal = false;
        }.bind(this));
        
        document.getElementById("confirmNo")?.addEventListener("click", function() {
            modalDiv.remove();
            pendingEliminationModal = false;
        });
    }
    
    async confirmElimination(confirmed) {
        if (!confirmed || !aliveFlag) return;
        
        try {
            await runTransaction(db, async function(transaction) {
                const victimRef = doc(collection(roomRef, "players"), currentUser.uid);
                const victimSnap = await transaction.get(victimRef);
                if (!victimSnap.exists() || victimSnap.data().alive === false) return;
                
                const assassinId = victimSnap.data().targetId;
                const assassinRef = doc(collection(roomRef, "players"), assassinId);
                const myTargetId = victimSnap.data().targetId;
                
                transaction.update(victimRef, { alive: false });
                
                const assassinSnap = await transaction.get(assassinRef);
                if (assassinSnap.exists() && assassinSnap.data().alive === true) {
                    transaction.update(assassinRef, { targetId: myTargetId });
                }
                
                const roomSnap = await transaction.get(roomRef);
                const newAlive = (roomSnap.data().aliveCount || 0) - 1;
                transaction.update(roomRef, { aliveCount: newAlive, lastUpdated: serverTimestamp() });
            });
        } catch(e) {
            debugLog("Transaction failed: " + e.message);
        }
        
        aliveFlag = false;
        if (sensorManager) sensorManager.destroy();
        showToast("You have been eliminated.");
    }
    
    destroy() {
        if (this.micInterval) {
            cancelAnimationFrame(this.micInterval);
        }
        window.removeEventListener("devicemotion", this.handleMotion);
        window.removeEventListener("deviceorientation", this.handleOrientation);
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(function(t) { t.stop(); });
        }
        this.active = false;
    }
}

// Initialize
debugLog("App starting...");

onAuthStateChanged(auth, function(user) {
    if (!user) {
        debugLog("Signing in anonymously...");
        signInAnonymously(auth).catch(function(e) {
            debugLog("Auth error: " + e.message);
            render(`
                <div class="card" style="text-align:center">
                    <h2>⚠️ Firebase Error</h2>
                    <p>${e.message}</p>
                    <p>Check that Anonymous Auth is enabled in Firebase Console</p>
                    <button onclick="location.reload()">Retry</button>
                </div>
            `);
        });
        return;
    }
    
    currentUser = user;
    debugLog("Logged in: " + user.uid);
    
    if (roomCode) {
        roomRef = doc(db, "rooms", roomCode);
        getDoc(roomRef).then(function(snap) {
            if (snap.exists() && snap.data().status === "active") {
                enterActiveGame();
            } else if (snap.exists() && snap.data().status === "lobby") {
                goToLobby();
            } else {
                showHome();
            }
        }).catch(function(e) {
            debugLog("Error: " + e.message);
            showHome();
        });
    } else {
        showHome();
    }
});
