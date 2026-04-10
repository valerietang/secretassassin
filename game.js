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

// Global State
let currentUser = null;
let roomCode = localStorage.getItem("assassin_room") || null;
let playerRef = null;
let roomRef = null;
let unsubPlayers = null, unsubRoom = null;
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

// DOM Helper
const root = document.getElementById("appRoot");

function render(html) { 
    if (root) root.innerHTML = html; 
    else console.error("Root element not found");
}

function showToast(msg, isError = false) { 
    alert(msg); 
}

function debugLog(msg) { 
    console.log(`[ASSASSIN] ${msg}`); 
    const panel = document.getElementById("debugLogPanel"); 
    if(panel) panel.innerHTML += `> ${new Date().toLocaleTimeString()} ${msg}<br>`; 
}

// UI Screens
function showLoading() {
    render('<div class="loading">🔪 Connecting to Firebase...<br>Initializing Assassin Protocol</div>');
}

function showHome() {
    render(`
        <div class="card" style="text-align:center">
            <h1>⚔️ NEON ASSASSIN ⚔️</h1>
            <p>sensor · deception · contract</p>
            <button id="createRoomBtn">🔪 CREATE ROOM</button>
            <button id="joinRoomBtn">🔗 JOIN ROOM</button>
            <input id="joinCodeInput" placeholder="Enter Room Code" style="display:none" />
            <div class="debug-panel" id="debugLogPanel"></div>
        </div>
    `);
    
    document.getElementById("createRoomBtn")?.addEventListener("click", () => createNewRoom());
    const joinBtn = document.getElementById("joinRoomBtn");
    const joinInput = document.getElementById("joinCodeInput");
    joinBtn?.addEventListener("click", () => {
        joinInput.style.display = joinInput.style.display === "none" ? "flex" : "none";
    });
    joinInput?.addEventListener("keypress", e => e.key === "Enter" && joinRoom(joinInput.value.trim().toUpperCase()));
}

async function createNewRoom() {
    if(!currentUser) return;
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
    let code = "";
    for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
    const roomData = {
        hostId: currentUser.uid,
        status: "lobby",
        createdAt: serverTimestamp(),
        aliveCount: 0,
        winnerIds: []
    };
    try {
        await setDoc(doc(db, "rooms", code), roomData);
        await joinRoom(code);
    } catch(e) { 
        console.error(e); 
        showToast("Error creating room: " + e.message); 
    }
}

async function joinRoom(code) {
    if(!code) return;
    roomCode = code;
    localStorage.setItem("assassin_room", code);
    roomRef = doc(db, "rooms", code);
    const snap = await getDoc(roomRef);
    if(!snap.exists()) { 
        showToast("Room not found"); 
        return; 
    }
    const room = snap.data();
    if(room.status !== "lobby") { 
        showToast("Game already started"); 
        return; 
    }
    const playersCol = collection(roomRef, "players");
    const existing = await getDoc(doc(playersCol, currentUser.uid));
    if(!existing.exists()) {
        await setDoc(doc(playersCol, currentUser.uid), {
            name: `Agent_${Math.floor(Math.random()*1000)}`,
            alive: true,
            isHost: room.hostId === currentUser.uid,
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
        await updateDoc(doc(playersCol, currentUser.uid), { connected: true, lastSeen: serverTimestamp() });
    }
    goToLobby();
}

function goToLobby() {
    if(!roomCode) return;
    renderLobbyUI();
    subscribeLobby();
}

function renderLobbyUI() {
    render(`
        <div class="card">
            <h2>🔪 LOBBY: ${roomCode}</h2>
            <div id="lobbyPlayerList" class="player-list"></div>
            <div id="sensorSetupPanel"></div>
            <button id="readySensorBtn">📡 ENABLE SENSORS & READY</button>
            <button id="startGameBtn" style="background:#0f3b2c">▶ START GAME (HOST)</button>
            <button id="leaveLobbyBtn">🚪 LEAVE</button>
            <div class="debug-panel" id="debugLogPanel"></div>
        </div>
    `);
    
    document.getElementById("readySensorBtn")?.addEventListener("click", async () => {
        await requestSensorsAndReady();
    });
    document.getElementById("startGameBtn")?.addEventListener("click", async () => {
        const roomSnap = await getDoc(roomRef);
        if(currentUser && currentUser.uid === roomSnap.data()?.hostId) {
            startGameTransaction();
        } else {
            showToast("Only host can start");
        }
    });
    document.getElementById("leaveLobbyBtn")?.addEventListener("click", leaveRoom);
}

async function requestSensorsAndReady() {
    if(!currentUser) return;
    let motionGranted = false, micGranted = false;
    
    if(typeof DeviceOrientationEvent !== "undefined" && typeof DeviceMotionEvent !== "undefined") {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            try { 
                await DeviceOrientationEvent.requestPermission(); 
                motionGranted = true; 
            } catch(e) { console.warn("Motion denied"); }
        } else { 
            motionGranted = true; 
        }
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micGranted = true;
        stream.getTracks().forEach(t=>t.stop());
    } catch(e) { 
        console.warn("Mic denied"); 
    }
    
    await updateDoc(doc(roomRef, "players", currentUser.uid), { 
        sensorReady: true, 
        motionEnabled: motionGranted, 
        micEnabled: micGranted 
    });
    showToast("Sensors ready! ✅");
}

function subscribeLobby() {
    if(unsubPlayers) unsubPlayers();
    const playersQuery = collection(roomRef, "players");
    unsubPlayers = onSnapshot(playersQuery, (snap) => {
        const players = [];
        snap.forEach(d=>players.push({id:d.id, ...d.data()}));
        const container = document.getElementById("lobbyPlayerList");
        if(container) {
            container.innerHTML = players.map(p => `
                <div class="player-item">
                    <span>${p.name} ${p.isHost ? '<span class="badge-host">HOST</span>' : ''}</span>
                    <span>${p.sensorReady ? '✅ READY' : '⏳'}</span>
                </div>
            `).join("");
        }
        const readyCount = players.filter(p=>p.sensorReady).length;
        const startBtn = document.getElementById("startGameBtn");
        if(startBtn && readyCount >= 3 && players.length >= 3) {
            startBtn.disabled = false;
        } else if(startBtn) {
            startBtn.disabled = true;
        }
        debugLog(`Players: ${players.length}, Ready: ${readyCount}`);
    });
}

async function startGameTransaction() {
    if(!roomRef) return;
    const playersSnap = await getDocs(collection(roomRef, "players"));
    const players = [];
    playersSnap.forEach(d=>{ 
        const data = d.data();
        if(data.alive !== false && data.sensorReady === true) {
            players.push({id:d.id, data});
        }
    });
    
    if(players.length < 3) { 
        showToast("Need 3 ready players"); 
        return; 
    }
    
    // Shuffle players for target loop
    const shuffled = players.map(p=>p.id);
    for(let i=shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random()*(i+1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    const targetMap = {};
    for(let i=0;i<shuffled.length;i++) {
        targetMap[shuffled[i]] = shuffled[(i+1)%shuffled.length];
    }
    
    const triggersList = ["SHAKE_PHONE","PHONE_FACE_DOWN","TILT_LEFT_RIGHT","LOUD_NOISE","SUSTAINED_MOVEMENT_3S","PHONE_PICKED_UP"];
    const triggerAssign = {};
    shuffled.forEach(pid => { 
        triggerAssign[pid] = triggersList[Math.floor(Math.random()*triggersList.length)]; 
    });
    
    const startedAt = Timestamp.now();
    const endTime = Timestamp.fromMillis(Date.now() + 10*60*1000);
    const batch = writeBatch(db);
    const roomUpdate = { 
        status: "active", 
        startedAt, 
        endTime, 
        aliveCount: shuffled.length, 
        lastUpdated: serverTimestamp() 
    };
    batch.update(roomRef, roomUpdate);
    
    for(const pid of shuffled){
        const pref = doc(roomRef, "players", pid);
        batch.update(pref, { targetId: targetMap[pid], triggerId: triggerAssign[pid], alive: true });
    }
    await batch.commit();
    debugLog("Game started");
    enterActiveGame();
}

function enterActiveGame() {
    currentGameStatus = "active";
    startGameHUD();
    subscribeActiveGame();
    if(sensorManager) sensorManager.destroy();
    sensorManager = new SensorManager();
    sensorManager.init();
}

function startGameHUD() {
    render(`
        <div id="gameHudContainer">
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
            <div id="sensorIcons" style="display:flex; gap:10px; justify-content:center; margin:10px">⚡⚡⚡</div>
            <div class="debug-panel" id="debugLogPanel"></div>
        </div>
    `);
    updateActiveUI();
}

async function updateActiveUI() {
    if(!playerRef) return;
    const snap = await getDoc(playerRef);
    if(snap.exists()){
        const data = snap.data();
        aliveFlag = data.alive;
        isDeadLocally = !aliveFlag;
        myTarget = data.targetId;
        myTrigger = data.triggerId;
        
        if(myTarget){
            const targetSnap = await getDoc(doc(roomRef, "players", myTarget));
            document.getElementById("targetName")?.innerHTML = targetSnap.exists() ? targetSnap.data().name : "unknown";
        }
        
        const triggerObj = getTriggerMeta(myTrigger);
        document.getElementById("missionText").innerHTML = triggerObj?.missionText || "eliminate target";
    }
    if(!aliveFlag) document.body.classList.add("dead-overlay");
    else document.body.classList.remove("dead-overlay");
}

function getTriggerMeta(triggerId) {
    const map = {
        SHAKE_PHONE: { missionText:"SHAKE your phone violently", sensorType:"motion", cooldownMs:5000, threshold:25 },
        PHONE_FACE_DOWN: { missionText:"Place phone FACE DOWN", sensorType:"orientation", cooldownMs:5000, threshold:45 },
        TILT_LEFT_RIGHT: { missionText:"TILT left/right sharply", sensorType:"orientation", cooldownMs:5000, threshold:30 },
        LOUD_NOISE: { missionText:"Make LOUD noise (clap/scream)", sensorType:"mic", cooldownMs:5000, threshold:0.7 },
        SUSTAINED_MOVEMENT_3S: { missionText:"Move continuously 3 seconds", sensorType:"motion", cooldownMs:5000, threshold:2.5 },
        PHONE_PICKED_UP: { missionText:"PICK UP phone", sensorType:"orientation", cooldownMs:5000, threshold:20 }
    };
    return map[triggerId] || { missionText:"eliminate target", sensorType:"none", cooldownMs:5000 };
}

function subscribeActiveGame() {
    if(unsubRoom) unsubRoom();
    unsubRoom = onSnapshot(roomRef, async (snap) => {
        const data = snap.data();
        if(data && data.endTime && data.endTime.toMillis) {
            endTimestamp = data.endTime.toMillis();
            updateTimerDisplay();
            if(timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(updateTimerDisplay, 1000);
        }
        if(data && data.aliveCount !== undefined) {
            document.getElementById("aliveCountHUD").innerHTML = `👥 ${data.aliveCount}`;
        }
        if(data && data.status === "ended") {
            endGameHandler(data.winnerIds);
        }
    });
    
    playerRef = doc(roomRef, "players", currentUser.uid);
    onSnapshot(playerRef, (snap) => {
        if(snap.exists()){
            const me = snap.data();
            aliveFlag = me.alive;
            if(!aliveFlag && !isDeadLocally) {
                isDeadLocally = true;
                if(sensorManager) sensorManager.destroy();
                showToast("☠️ YOU ARE DEAD");
            }
            myTarget = me.targetId;
            myTrigger = me.triggerId;
            updateActiveUI();
        }
    });
}

function updateTimerDisplay() {
    if(!endTimestamp) return;
    const diff = Math.max(0, endTimestamp - Date.now());
    const minutes = Math.floor(diff/60000);
    const seconds = Math.floor((diff%60000)/1000);
    const timerElem = document.getElementById("timerDisplay");
    if(timerElem) timerElem.innerHTML = `${minutes}:${seconds<10?'0'+seconds:seconds}`;
    if(diff <= 0 && currentGameStatus === "active") endGameByTimer();
}

async function endGameByTimer() {
    const roomSnap = await getDoc(roomRef);
    if(roomSnap.exists() && roomSnap.data().status !== "ended"){
        const alivePlayersQuery = await getDocs(query(collection(roomRef,"players"), where("alive","==",true)));
        const winners = alivePlayersQuery.docs.map(d=>d.id);
        await updateDoc(roomRef, { status: "ended", winnerIds: winners });
    }
}

function endGameHandler(winnerIds) {
    if(timerInterval) clearInterval(timerInterval);
    if(sensorManager) sensorManager.destroy();
    currentGameStatus = "ended";
    const winnerText = winnerIds?.length ? `${winnerIds.length} winner(s)` : "nobody";
    render(`<div class="card"><h1>🏆 GAME OVER</h1><p>Game ended</p><button id="backHome">🏠 Main Menu</button></div>`);
    document.getElementById("backHome")?.addEventListener("click",()=>{ 
        localStorage.removeItem("assassin_room"); 
        window.location.reload(); 
    });
}

// Sensor Manager Class
class SensorManager {
    constructor() {
        this.active = true;
        this.graceEnd = Date.now() + 3000;
        this.lastTriggerTime = 0;
        this.motionBuffer = [];
        this.micAnalyser = null;
        this.mediaStream = null;
        this.handleMotion = this.handleMotion.bind(this);
        this.handleOrientation = this.handleOrientation.bind(this);
    }
    
    async init() {
        if(!aliveFlag) return;
        window.addEventListener("devicemotion", this.handleMotion);
        window.addEventListener("deviceorientation", this.handleOrientation);
        try { 
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); 
            this.mediaStream = stream; 
            const audioCtx = new AudioContext(); 
            const source = audioCtx.createMediaStreamSource(stream); 
            this.micAnalyser = audioCtx.createAnalyser(); 
            source.connect(this.micAnalyser); 
            this.micAnalyser.fftSize = 256; 
            this.startMicCheck(); 
        } catch(e) {}
        
        document.addEventListener("visibilitychange", () => { 
            if(document.hidden) this.active = false; 
            else this.active = true; 
        });
    }
    
    startMicCheck() {
        const checkMic = () => { 
            if(!this.active || !aliveFlag || !this.micAnalyser) return; 
            const data = new Uint8Array(this.micAnalyser.frequencyBinCount); 
            this.micAnalyser.getByteTimeDomainData(data); 
            let max = 0; 
            for(let i = 0; i < data.length; i++) {
                let v = (data[i] - 128) / 128; 
                max = Math.max(max, Math.abs(v));
            }
            if(max > 0.65 && myTrigger === "LOUD_NOISE") this.attemptElimination(); 
            requestAnimationFrame(checkMic);
        };
        checkMic();
    }
    
    handleMotion(e) {
        if(!this.active || !aliveFlag || Date.now() < this.graceEnd) return;
        let acc = e.accelerationIncludingGravity;
        let mag = Math.sqrt((acc.x||0)**2 + (acc.y||0)**2 + (acc.z||0)**2);
        if(myTrigger === "SHAKE_PHONE" && mag > 28) this.attemptElimination();
        if(myTrigger === "SUSTAINED_MOVEMENT_3S") {
            this.motionBuffer.push(Date.now());
            this.motionBuffer = this.motionBuffer.filter(t => Date.now() - t < 3000);
            if(this.motionBuffer.length > 8) this.attemptElimination();
        }
    }
    
    handleOrientation(e) {
        if(!this.active || !aliveFlag || Date.now() < this.graceEnd) return;
        let beta = e.beta || 0, gamma = e.gamma || 0;
        if(myTrigger === "PHONE_FACE_DOWN" && Math.abs(beta) > 70) this.attemptElimination();
        if(myTrigger === "TILT_LEFT_RIGHT" && Math.abs(gamma) > 45) this.attemptElimination();
        if(myTrigger === "PHONE_PICKED_UP" && beta < -20 && Math.abs(gamma) < 30) this.attemptElimination();
    }
    
    attemptElimination() {
        if(!aliveFlag || pendingEliminationModal || localTriggerCooldown.get(myTrigger) > Date.now()) return;
        localTriggerCooldown.set(myTrigger, Date.now() + 10000);
        this.showEliminationModal();
    }
    
    showEliminationModal() {
        pendingEliminationModal = true;
        const modalDiv = document.createElement("div"); 
        modalDiv.className = "modal-full";
        modalDiv.innerHTML = `<div class="card"><h2>🔪 ELIMINATION CONFIRM</h2><p>Were you eliminated by your assassin?</p><div class="btn-group"><button id="confirmYes">YES, I'm dead</button><button id="confirmNo">NO, false alarm</button></div></div>`;
        document.body.appendChild(modalDiv);
        document.getElementById("confirmYes")?.addEventListener("click", async() => { 
            await this.confirmElimination(true); 
            modalDiv.remove(); 
            pendingEliminationModal = false; 
        });
        document.getElementById("confirmNo")?.addEventListener("click", () => { 
            modalDiv.remove(); 
            pendingEliminationModal = false; 
        });
    }
    
    async confirmElimination(confirmed) {
        if(!confirmed || !aliveFlag) return;
        try {
            await runTransaction(db, async (transaction) => {
                const victimRef = doc(roomRef, "players", currentUser.uid);
                const victimSnap = await transaction.get(victimRef);
                if(!victimSnap.exists() || victimSnap.data().alive === false) return;
                const assassinId = victimSnap.data().targetId;
                const assassinRef = doc(roomRef, "players", assassinId);
                const myTargetId = victimSnap.data().targetId;
                transaction.update(victimRef, { alive: false });
                const assassinSnap = await transaction.get(assassinRef);
                if(assassinSnap.exists() && assassinSnap.data().alive === true) {
                    transaction.update(assassinRef, { targetId: myTargetId });
                }
                const roomSnap = await transaction.get(roomRef);
                const newAlive = (roomSnap.data().aliveCount || 0) - 1;
                transaction.update(roomRef, { aliveCount: newAlive, lastUpdated: serverTimestamp() });
                const logRef = doc(collection(roomRef, "events"));
                transaction.set(logRef, { type: "kill", actorId: assassinId, targetId: currentUser.uid, timestamp: serverTimestamp() });
            });
        } catch(e) { console.error("Transaction failed", e); }
        aliveFlag = false;
        if(sensorManager) sensorManager.destroy();
        showToast("You have been eliminated.");
    }
    
    destroy() {
        window.removeEventListener("devicemotion", this.handleMotion);
        window.removeEventListener("deviceorientation", this.handleOrientation);
        if(this.mediaStream) this.mediaStream.getTracks().forEach(t => t.stop());
        this.active = false;
    }
}

async function leaveRoom() {
    if(roomRef && currentUser) {
        await updateDoc(doc(roomRef, "players", currentUser.uid), { connected: false });
    }
    localStorage.removeItem("assassin_room");
    window.location.reload();
}

// Initialize App
showLoading();
onAuthStateChanged(auth, async (user) => {
    if(!user) { 
        try {
            await signInAnonymously(auth);
        } catch(e) {
            console.error("Auth failed:", e);
            showToast("Firebase auth failed. Check your config.");
            render('<div class="card"><h2>⚠️ Firebase Error</h2><p>Check console for details. Make sure your firebaseConfig is correct.</p><button onclick="location.reload()">Retry</button></div>');
        }
        return; 
    }
    currentUser = user;
    debugLog("Authenticated: " + user.uid);
    
    if(roomCode) {
        roomRef = doc(db, "rooms", roomCode);
        const snap = await getDoc(roomRef);
        if(snap.exists() && snap.data().status === "active") {
            enterActiveGame();
        } else if(snap.exists() && snap.data().status === "lobby") {
            goToLobby();
        } else {
            showHome();
        }
    } else {
        showHome();
    }
});
