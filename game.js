// TODO: REPLACE WITH YOUR FIREBASE CONFIG
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
let currentPlayerName = "";
let roomCode = localStorage.getItem("assassin_room") || null;
let roomRef = null;
let playerRef = null;
let unsubPlayers = null;
let unsubRoom = null;
let unsubMe = null;
let currentGameStatus = "lobby";
let aliveFlag = true;
let myTarget = null;
let myAssassinTrigger = null;  // The trigger my assassin must use to eliminate ME
let myTargetsTrigger = null;   // The trigger I need to make my target perform
let timerInterval = null;
let endTimestamp = null;
let sensorManager = null;
let pendingEliminationModal = false;
let localTriggerCooldown = new Map();
let isDeadLocally = false;
let motionGranted = false;
let micGranted = false;

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

// Name input screen
function showNameInput() {
    render(`
        <div class="card" style="text-align:center">
            <h1>⚔️ NEON ASSASSIN ⚔️</h1>
            <p>Enter your agent name</p>
            <input type="text" id="playerNameInput" placeholder="Agent Name" maxlength="20" autocomplete="off">
            <button id="confirmNameBtn">CONTINUE</button>
        </div>
    `);
    
    document.getElementById("confirmNameBtn")?.addEventListener("click", function() {
        const name = document.getElementById("playerNameInput").value.trim();
        if (name.length === 0) {
            showToast("Please enter a name");
            return;
        }
        currentPlayerName = name;
        showHome();
    });
    
    document.getElementById("playerNameInput")?.addEventListener("keypress", function(e) {
        if (e.key === "Enter") {
            const name = e.target.value.trim();
            if (name.length > 0) {
                currentPlayerName = name;
                showHome();
            }
        }
    });
}

// Home screen
function showHome() {
    render(`
        <div class="card" style="text-align:center">
            <h1>⚔️ NEON ASSASSIN ⚔️</h1>
            <p>Welcome, ${currentPlayerName}!</p>
            <button id="createRoomBtn">🔪 CREATE ROOM</button>
            <div class="join-container">
                <input id="joinCodeInput" placeholder="Enter Room Code" maxlength="6" autocomplete="off">
                <button id="joinRoomBtn">JOIN</button>
            </div>
            <div class="debug-panel" id="debugLogPanel"></div>
        </div>
    `);
    
    document.getElementById("createRoomBtn")?.addEventListener("click", createNewRoom);
    document.getElementById("joinRoomBtn")?.addEventListener("click", function() {
        const code = document.getElementById("joinCodeInput").value.trim().toUpperCase();
        if (code) joinRoom(code);
    });
    document.getElementById("joinCodeInput")?.addEventListener("keypress", function(e) {
        if (e.key === "Enter") {
            const code = e.target.value.trim().toUpperCase();
            if (code) joinRoom(code);
        }
    });
}

async function createNewRoom() {
    if (!currentUser) return;
    
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
            assassinTriggerId: null  // The trigger that kills THIS player (known only to their assassin)
        });
    } else {
        await updateDoc(playerDoc, { connected: true, lastSeen: serverTimestamp() });
    }
    
    goToLobby();
}

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
            <div class="sensor-status" id="sensorStatusArea"></div>
            <button id="readySensorBtn">📡 ENABLE SENSORS & READY</button>
            <button id="startGameBtn" style="background:#0f3b2c" disabled>▶ START GAME (need 3 ready)</button>
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
    
    motionGranted = false;
    micGranted = false;
    
    const sensorArea = document.getElementById("sensorStatusArea");
    if (sensorArea) {
        sensorArea.innerHTML = '<div style="text-align:center">⏳ Requesting permissions...</div>';
    }
    
    // Request motion
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        try {
            await DeviceOrientationEvent.requestPermission();
            motionGranted = true;
            debugLog("Motion granted");
        } catch(e) {
            debugLog("Motion denied: " + e.message);
        }
    } else {
        motionGranted = true;
    }
    
    // Request mic
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micGranted = true;
        stream.getTracks().forEach(function(t) { t.stop(); });
        debugLog("Mic granted");
    } catch(e) {
        debugLog("Mic denied: " + e.message);
    }
    
    // Update sensor status display
    if (sensorArea) {
        if (micGranted && motionGranted) {
            sensorArea.innerHTML = '<div style="text-align:center; color:#0f0;">✅ All sensors ready!</div>';
        } else if (!micGranted && motionGranted) {
            sensorArea.innerHTML = `
                <div style="text-align:center">
                    <div style="color:#ff8888;">⚠️ Microphone access denied - LOUD_NOISE trigger won't work</div>
                    <button id="retryMicBtn" style="padding:0.3rem 1rem; font-size:0.8rem; margin-top:0.3rem;">🔁 Request Mic Again</button>
                </div>
            `;
            document.getElementById("retryMicBtn")?.addEventListener("click", requestSensorsAndReady);
        } else if (micGranted && !motionGranted) {
            sensorArea.innerHTML = '<div style="text-align:center; color:#ff8888;">⚠️ Motion sensors not available - some triggers won\'t work</div>';
        } else {
            sensorArea.innerHTML = '<div style="text-align:center; color:#ff8888;">⚠️ No sensors available. Game will be difficult!</div>';
        }
    }
    
    const playerDoc = doc(collection(roomRef, "players"), currentUser.uid);
    await updateDoc(playerDoc, {
        sensorReady: true,
        motionEnabled: motionGranted,
        micEnabled: micGranted
    });
    
    showToast("Ready! Waiting for host to start...");
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
                if (p.sensorReady) {
                    html += '<span class="badge-ready">✅ READY</span>';
                } else {
                    html += '<span class="badge-missing">⏳ PENDING</span>';
                }
                html += '</div>';
            }
            container.innerHTML = html;
        }
        
        const readyCount = players.filter(function(p) { return p.sensorReady; }).length;
        const startBtn = document.getElementById("startGameBtn");
        const isHost = players.some(function(p) { return p.id === currentUser.uid && p.isHost; });
        
        if (startBtn && readyCount >= 3 && players.length >= 3 && isHost) {
            startBtn.disabled = false;
        } else if (startBtn && !isHost) {
            startBtn.disabled = true;
        } else if (startBtn) {
            startBtn.disabled = true;
        }
        
        debugLog("Players: " + players.length + ", Ready: " + readyCount);
    });
}

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
    
    // Shuffle players
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
    
    // Assign targets (each player's target is the next in the loop)
    const targetMap = {};
    for (let i = 0; i < shuffled.length; i++) {
        targetMap[shuffled[i]] = shuffled[(i + 1) % shuffled.length];
    }
    
    // Each player gets a trigger that their ASSASSIN must use to kill them
    const triggersList = ["SHAKE_PHONE", "PHONE_FACE_DOWN", "TILT_LEFT_RIGHT", "LOUD_NOISE", "SUSTAINED_MOVEMENT_3S", "PHONE_PICKED_UP"];
    const triggerAssignment = {};
    for (let i = 0; i < shuffled.length; i++) {
        const pid = shuffled[i];
        // Assign a random trigger that will kill THIS player
        triggerAssignment[pid] = triggersList[Math.floor(Math.random() * triggersList.length)];
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
            assassinTriggerId: triggerAssignment[pid]  // The trigger that kills THIS player
        });
    }
    
    await batch.commit();
    debugLog("Game started - Each player has a target and a secret trigger that kills them");
    enterActiveGame();
}

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
                <h3>🎯 YOUR MISSION</h3>
                <div style="font-size:1.2rem; margin:0.5rem 0;">Make your target perform:</div>
                <div id="targetName" class="target-name" style="font-size:1.5rem;">---</div>
                <div id="missionText" class="mission-text" style="font-size:1.3rem; color:#ff8888; margin:0.5rem 0;">---</div>
                <div style="font-size:0.9rem; margin-top:1rem; color:#aaa;">
                    ⚠️ Your assassin is trying to make YOU perform YOUR trigger<br>
                    Be careful what actions you take!
                </div>
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
        myAssassinTrigger = data.assassinTriggerId;  // The trigger that kills ME
        
        if (myTarget) {
            const targetSnap = await getDoc(doc(collection(roomRef, "players"), myTarget));
            const targetElem = document.getElementById("targetName");
            if (targetElem) {
                targetElem.innerHTML = targetSnap.exists() ? targetSnap.data().name : "unknown";
            }
            
            // I need to know my TARGET'S trigger (what kills them)
            if (targetSnap.exists()) {
                myTargetsTrigger = targetSnap.data().assassinTriggerId;
                const missionElem = document.getElementById("missionText");
                if (missionElem) {
                    missionElem.innerHTML = getTriggerActionText(myTargetsTrigger);
                }
            }
        }
        
        // Show warning about your own trigger (but not what it is!)
        const warningElem = document.getElementById("ownTriggerWarning");
        if (warningElem) {
            warningElem.innerHTML = "⚠️ Your assassin is trying to make you perform a SECRET action!";
        }
    }
    
    if (!aliveFlag) {
        document.body.classList.add("dead-overlay");
    } else {
        document.body.classList.remove("dead-overlay");
    }
}

function getTriggerActionText(triggerId) {
    const map = {
        "SHAKE_PHONE": "🔨 SHAKE their phone violently",
        "PHONE_FACE_DOWN": "📱 Place their phone FACE DOWN",
        "TILT_LEFT_RIGHT": "↔️ TILT their phone left and right rapidly",
        "LOUD_NOISE": "📢 Make a LOUD noise (clap, shout)",
        "SUSTAINED_MOVEMENT_3S": "🏃 Move their phone continuously for 3 seconds",
        "PHONE_PICKED_UP": "⬆️ PICK UP their phone from a flat surface"
    };
    return map[triggerId] || "Complete your assassination mission";
}

function getTriggerDescription(triggerId) {
    const map = {
        "SHAKE_PHONE": "shaking your phone violently",
        "PHONE_FACE_DOWN": "placing your phone face down",
        "TILT_LEFT_RIGHT": "tilting your phone left and right",
        "LOUD_NOISE": "making a loud noise",
        "SUSTAINED_MOVEMENT_3S": "moving your phone continuously",
        "PHONE_PICKED_UP": "picking up your phone"
    };
    return map[triggerId] || "a specific action";
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
                aliveElem.innerHTML = "👥 " + data.aliveCount + " alive";
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
                showToast("☠️ YOU HAVE BEEN ELIMINATED! Your assassin made you perform your trigger.");
            }
            myTarget = me.targetId;
            myAssassinTrigger = me.assassinTriggerId;
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

async function leaveRoom() {
    if (roomRef && currentUser) {
        const playerDoc = doc(collection(roomRef, "players"), currentUser.uid);
        await updateDoc(playerDoc, { connected: false });
    }
    localStorage.removeItem("assassin_room");
    window.location.reload();
}

// Sensor Manager - Monitors for the player's OWN trigger (what kills them)
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
        
        if (micGranted) {
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
                debugLog("Mic check failed: " + e.message);
            }
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
            
            // Check if I performed my own trigger (my assassin's goal)
            if (max > 0.65 && myAssassinTrigger === "LOUD_NOISE") {
                this.attemptSelfElimination();
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
        
        // Check if I performed my own trigger
        if (myAssassinTrigger === "SHAKE_PHONE" && mag > 28) {
            this.attemptSelfElimination();
        }
        
        if (myAssassinTrigger === "SUSTAINED_MOVEMENT_3S") {
            this.motionBuffer.push(Date.now());
            this.motionBuffer = this.motionBuffer.filter(function(t) {
                return Date.now() - t < 3000;
            });
            if (this.motionBuffer.length > 8) {
                this.attemptSelfElimination();
            }
        }
    }
    
    handleOrientation(e) {
        if (!this.active || !aliveFlag || Date.now() < this.graceEnd) return;
        
        const beta = e.beta || 0;
        const gamma = e.gamma || 0;
        
        // Check if I performed my own trigger
        if (myAssassinTrigger === "PHONE_FACE_DOWN" && Math.abs(beta) > 70) {
            this.attemptSelfElimination();
        }
        if (myAssassinTrigger === "TILT_LEFT_RIGHT" && Math.abs(gamma) > 45) {
            this.attemptSelfElimination();
        }
        if (myAssassinTrigger === "PHONE_PICKED_UP" && beta < -20 && Math.abs(gamma) < 30) {
            this.attemptSelfElimination();
        }
    }
    
    attemptSelfElimination() {
        if (!aliveFlag || pendingEliminationModal) return;
        
        const cooldownTime = localTriggerCooldown.get(myAssassinTrigger);
        if (cooldownTime && cooldownTime > Date.now()) return;
        
        localTriggerCooldown.set(myAssassinTrigger, Date.now() + 10000);
        this.showEliminationModal();
    }
    
    showEliminationModal() {
        pendingEliminationModal = true;
        
        const triggerDescription = getTriggerDescription(myAssassinTrigger);
        
        const modalDiv = document.createElement("div");
        modalDiv.className = "modal-full";
        modalDiv.innerHTML = `
            <div class="card">
                <h2>🔪 ELIMINATION DETECTED!</h2>
                <p>You just performed: <strong style="color:#ff8888;">${triggerDescription}</strong></p>
                <p>This was your assassin's mission for you!</p>
                <div class="btn-group">
                    <button id="confirmYes">✅ I've been eliminated</button>
                    <button id="confirmNo">❌ This was a mistake</button>
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
                
                // Find who has ME as their target (my assassin)
                const playersQuery = await getDocs(collection(roomRef, "players"));
                let assassinId = null;
                playersQuery.forEach(function(d) {
                    if (d.data().targetId === currentUser.uid && d.data().alive === true) {
                        assassinId = d.id;
                    }
                });
                
                transaction.update(victimRef, { alive: false });
                
                // Give my target to my assassin
                if (assassinId) {
                    const myTargetId = victimSnap.data().targetId;
                    const assassinRef = doc(collection(roomRef, "players"), assassinId);
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
        showToast("☠️ YOU HAVE BEEN ELIMINATED!");
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
    
    // Check if user has a name saved
    const savedName = localStorage.getItem("assassin_name");
    if (savedName) {
        currentPlayerName = savedName;
        showHome();
    } else {
        showNameInput();
    }
});

// Save name when entered
function showNameInput() {
    render(`
        <div class="card" style="text-align:center">
            <h1>⚔️ NEON ASSASSIN ⚔️</h1>
            <p>Enter your agent name</p>
            <input type="text" id="playerNameInput" placeholder="Agent Name" maxlength="20" autocomplete="off">
            <button id="confirmNameBtn">CONTINUE</button>
        </div>
    `);
    
    document.getElementById("confirmNameBtn")?.addEventListener("click", function() {
        const name = document.getElementById("playerNameInput").value.trim();
        if (name.length === 0) {
            showToast("Please enter a name");
            return;
        }
        currentPlayerName = name;
        localStorage.setItem("assassin_name", name);
        showHome();
    });
}
