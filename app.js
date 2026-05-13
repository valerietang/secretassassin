// ============================================================
// SHADOWMARK — Core Game Logic
// ============================================================

const DEBUG_MODE = false;

// ——— FIREBASE CONFIG ———
const firebaseConfig = {
    apiKey: "AIzaSyAMdGxGvZxWX9qCXyi4FROjkY7mYuD7P4w",
    authDomain: "secret-assassin-v1.firebaseapp.com",
    projectId: "secret-assassin-v1",
    storageBucket: "secret-assassin-v1.firebasestorage.app",
    messagingSenderId: "946220914680",
    appId: "1:946220914680:web:11ac26113052d2e182680d"
};

// ============================================================
// TRIGGER DEFINITIONS
// ============================================================

const TRIGGERS = {
    ROTATE_DEVICE: {
        id: "ROTATE_DEVICE",
        action: "rotate their phone (portrait to landscape, or back)",
        hud: "get them to rotate their phone sideways — or back upright",
        tip: "\"Turn your phone sideways to see this\" or \"flip it back, it looks better portrait\""
    },
    TRIPLE_TAP: {
        id: "TRIPLE_TAP",
        action: "triple-tap their screen",
        hud: "get them to tap their screen three times quickly",
        tip: "\"Tap here three times to confirm\" or pretend it's a UI gesture they need"
    },
    LONG_PRESS: {
        id: "LONG_PRESS",
        action: "hold their finger on the screen for 3 seconds",
        hud: "get them to press and hold on their screen for 3 seconds",
        tip: "\"Press and hold that\" while showing them something on your phone"
    },
    SWITCH_TABS: {
        id: "SWITCH_TABS",
        action: "switch apps or open another tab",
        hud: "get them to leave this app — even briefly",
        tip: "\"Google this for me real quick\" or \"open your camera and take a photo of this\""
    },
    PINCH_ZOOM: {
        id: "PINCH_ZOOM",
        action: "pinch-zoom on their screen",
        hud: "get them to pinch-zoom on their screen",
        tip: "\"Zoom in on this\" while showing them a photo, map, or small text"
    }
};

const TRIGGER_KEYS = Object.keys(TRIGGERS);

// ============================================================
// GLOBALS
// ============================================================

let FB = null;
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
let localTriggerCooldown = new Map();
let gameOverHandled = false;

// ============================================================
// UTILITIES
// ============================================================

function debugLog(msg) {
    if (!DEBUG_MODE) return;
    console.log("[SHADOWMARK]", msg);
    const panel = document.getElementById("debugLogPanel");
    if (panel) {
        panel.innerHTML += "> " + new Date().toLocaleTimeString() + " " + msg + "<br>";
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
    setTimeout(function() { toast.remove(); }, 3200);
}

function render(html) {
    const root = document.getElementById("appRoot");
    if (root) root.innerHTML = html;
}

function debugPanel() {
    return DEBUG_MODE ? '<div class="debug-panel" id="debugLogPanel"></div>' : "";
}

// ============================================================
// NAME INPUT
// ============================================================

function showNameInput() {
    render(
        '<div class="screen fade-up">' +
        '<div class="screen-header" style="padding-top:4rem;">' +
        '<div class="wordmark">SHADOWMARK</div>' +
        '<span class="wordmark-sub">covert elimination protocol</span>' +
        '</div>' +
        '<p class="flavor-text fade-up fade-up-delay-1">Every agent needs a name.<br>Choose one you won\'t mind being remembered by.</p>' +
        '<div class="input-group fade-up fade-up-delay-2">' +
        '<span class="label">Codename</span>' +
        '<input type="text" id="playerNameInput" placeholder="e.g. GHOST" maxlength="20" autocomplete="off">' +
        '</div>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-primary fade-up fade-up-delay-3" id="confirmNameBtn">ENTER THE FIELD</button>' +
        '</div>'
    );
    var input = document.getElementById("playerNameInput");
    document.getElementById("confirmNameBtn").addEventListener("click", confirmName);
    input.addEventListener("keypress", function(e) { if (e.key === "Enter") confirmName(); });
    input.focus();
}

function confirmName() {
    var name = document.getElementById("playerNameInput").value.trim().toUpperCase();
    if (!name) { showToast("You need a name, agent."); return; }
    currentPlayerName = name;
    localStorage.setItem("shadowmark_name", name);
    showHome();
}

// ============================================================
// HOME
// ============================================================

function showHome() {
    render(
        '<div class="screen fade-up">' +
        '<div class="screen-header" style="padding-top:3rem;">' +
        '<div class="wordmark">SHADOWMARK</div>' +
        '<span class="wordmark-sub">welcome back, ' + currentPlayerName + '</span>' +
        '</div>' +
        '<p class="flavor-text fade-up fade-up-delay-1">Your city. Your rules.<br>Someone already has your name on a list.</p>' +
        '<div class="fade-up fade-up-delay-2">' +
        '<button class="btn btn-primary" id="createRoomBtn">&#128298; OPEN A SAFEHOUSE</button>' +
        '</div>' +
        '<div class="divider fade-up fade-up-delay-3">or infiltrate</div>' +
        '<div class="join-row fade-up fade-up-delay-3">' +
        '<div style="flex:1;"><span class="label">Room Code</span>' +
        '<input type="text" id="joinCodeInput" placeholder="X7K2MN" maxlength="6" autocomplete="off"></div>' +
        '<button class="btn btn-secondary" id="joinRoomBtn">GO</button>' +
        '</div>' +
        debugPanel() +
        '</div>'
    );
    document.getElementById("createRoomBtn").addEventListener("click", createNewRoom);
    document.getElementById("joinRoomBtn").addEventListener("click", function() {
        var code = document.getElementById("joinCodeInput").value.trim().toUpperCase();
        if (code) joinRoom(code);
    });
    document.getElementById("joinCodeInput").addEventListener("keypress", function(e) {
        if (e.key === "Enter") {
            var code = e.target.value.trim().toUpperCase();
            if (code) joinRoom(code);
        }
    });
}

// ============================================================
// ROOM CREATION & JOINING
// ============================================================

async function createNewRoom() {
    if (!currentUser) return;
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
    var code = "";
    for (var i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    var _FB = FB;
    try {
        debugLog("Creating room: " + code);
        await _FB.setDoc(_FB.doc(db, "rooms", code), {
            hostId: currentUser.uid,
            status: "lobby",
            createdAt: _FB.serverTimestamp(),
            aliveCount: 0,
            winnerIds: []
        });
        await joinRoom(code);
    } catch(e) {
        debugLog("Error: " + e.message);
        showToast("Error creating room. Try again.");
    }
}

async function joinRoom(code) {
    if (!code || !currentUser) return;
    var _FB = FB;

    roomCode = code;
    localStorage.setItem("shadowmark_room", code);
    roomRef = _FB.doc(db, "rooms", code);

    var snap;
    try {
        snap = await _FB.getDoc(roomRef);
    } catch(e) {
        showToast("Couldn't reach the server. Check your connection.");
        return;
    }

    if (!snap.exists()) { showToast("No safehouse found with that code."); return; }

    var room = snap.data();
    if (room.status === "ended") { showToast("That operation is over."); return; }

    playerRef = _FB.doc(_FB.collection(roomRef, "players"), currentUser.uid);

    if (room.status === "active") {
        var existing = await _FB.getDoc(playerRef);
        if (existing.exists() && existing.data().alive) {
            debugLog("Rejoining active game");
            enterActiveGame();
            return;
        }
        showToast("Operation already in progress.");
        return;
    }

    var existingPlayer = await _FB.getDoc(playerRef);
    if (!existingPlayer.exists()) {
        await _FB.setDoc(playerRef, {
            name: currentPlayerName,
            alive: true,
            isHost: (room.hostId === currentUser.uid),
            joinedAt: _FB.serverTimestamp(),
            sensorReady: false,
            connected: true,
            lastSeen: _FB.serverTimestamp(),
            targetId: null,
            assassinId: null,
            assassinTriggerId: null
        });
    } else {
        await _FB.updateDoc(playerRef, { connected: true, lastSeen: _FB.serverTimestamp() });
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
    render(
        '<div class="screen fade-up">' +
        '<div class="room-code-display">' +
        '<div class="room-code-value">' + roomCode + '</div>' +
        '<div class="room-code-hint">Share this code. Trust no one who asks for it twice.</div>' +
        '</div>' +
        '<h3>AGENTS IN FIELD</h3>' +
        '<div id="lobbyPlayerList" class="player-list" style="margin-top:0.8rem;">' +
        '<p style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.75rem;">Awaiting agents...</p>' +
        '</div>' +
        '<div id="sensorStatusArea" style="margin-bottom:1rem;"></div>' +
        '<button class="btn btn-gold" id="readySensorBtn">&#128225; ARM YOURSELF</button>' +
        '<button class="btn btn-primary" id="startGameBtn" disabled>&#9654; UNLEASH CHAOS</button>' +
        '<button class="btn-ghost" id="leaveLobbyBtn">&#8617; ABORT MISSION</button>' +
        debugPanel() +
        '</div>'
    );
    document.getElementById("readySensorBtn").addEventListener("click", markReady);
    document.getElementById("startGameBtn").addEventListener("click", startGameTransaction);
    document.getElementById("leaveLobbyBtn").addEventListener("click", leaveRoom);
}

async function markReady() {
    var btn = document.getElementById("readySensorBtn");
    if (btn) { btn.disabled = true; btn.textContent = "ARMED"; }
    var area = document.getElementById("sensorStatusArea");
    if (area) area.innerHTML = '<div style="text-align:center;padding:0.5rem 0;"><span style="font-family:var(--font-mono);font-size:0.7rem;letter-spacing:0.2em;color:var(--green);">ALL SYSTEMS ARMED</span></div>';
    try {
        await FB.updateDoc(playerRef, { sensorReady: true, connected: true });
        showToast("Armed and ready. Waiting for the host.");
    } catch(e) {
        showToast("Error arming. Try again.");
        if (btn) { btn.disabled = false; btn.textContent = "ARM YOURSELF"; }
    }
}

function subscribeLobby() {
    if (unsubPlayers) unsubPlayers();
    if (unsubRoom) unsubRoom();

    // Watch room document — when host starts, ALL devices transition simultaneously
    unsubRoom = FB.onSnapshot(roomRef, function(snap) {
        var data = snap.data();
        if (!data) return;
        if (data.status === "active" && currentGameStatus !== "active") {
            debugLog("Room active — entering game");
            if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
            if (unsubRoom) { unsubRoom(); unsubRoom = null; }
            enterActiveGame();
        }
    });

    unsubPlayers = FB.onSnapshot(FB.collection(roomRef, "players"), function(snap) {
        var players = [];
        snap.forEach(function(d) { players.push(Object.assign({ id: d.id }, d.data())); });

        var container = document.getElementById("lobbyPlayerList");
        if (container) {
            var html = "";
            players.forEach(function(p) {
                html += '<div class="player-item">' +
                    '<span class="player-name">' + p.name + '</span>' +
                    '<div class="player-badges">' +
                    (p.isHost ? '<span class="badge badge-host">HOST</span>' : "") +
                    (p.sensorReady ? '<span class="badge badge-armed">ARMED</span>' : '<span class="badge badge-pending">ARMING</span>') +
                    '</div></div>';
            });
            container.innerHTML = html || '<p style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.75rem;">Awaiting agents...</p>';
        }

        var armedCount = players.filter(function(p) { return p.sensorReady; }).length;
        var isHost = players.some(function(p) { return p.id === currentUser.uid && p.isHost; });
        var startBtn = document.getElementById("startGameBtn");

        if (startBtn) {
            if (isHost && armedCount >= 3 && players.length >= 3) {
                startBtn.disabled = false;
                startBtn.textContent = "UNLEASH CHAOS (" + armedCount + " ARMED)";
            } else if (isHost) {
                startBtn.disabled = true;
                startBtn.textContent = "UNLEASH CHAOS (NEED " + Math.max(0, 3 - armedCount) + " MORE)";
            } else {
                startBtn.disabled = true;
                startBtn.textContent = "WAITING FOR HOST...";
            }
        }

        debugLog("Players: " + players.length + ", Armed: " + armedCount);
    });
}

// ============================================================
// START GAME
// ============================================================

async function startGameTransaction() {
    if (!roomRef) return;
    var _FB = FB;
    var startBtn = document.getElementById("startGameBtn");
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = "STARTING..."; }

    var playersSnap = await _FB.getDocs(_FB.collection(roomRef, "players"));
    var players = [];
    playersSnap.forEach(function(d) {
        var data = d.data();
        if (data.alive !== false && data.sensorReady === true) {
            players.push({ id: d.id, data: data });
        }
    });

    if (players.length < 3) {
        showToast("Need at least 3 armed agents.");
        if (startBtn) { startBtn.disabled = false; startBtn.textContent = "UNLEASH CHAOS"; }
        return;
    }

    // Fisher-Yates shuffle
    var shuffled = players.map(function(p) { return p.id; });
    for (var i = shuffled.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }

    // Circular chain: each player targets the next, assassin is the previous
    var targetMap = {};
    var assassinMap = {};
    for (var k = 0; k < shuffled.length; k++) {
        targetMap[shuffled[k]] = shuffled[(k + 1) % shuffled.length];
        assassinMap[shuffled[(k + 1) % shuffled.length]] = shuffled[k];
    }

    // Assign a random trigger to each player (what their assassin must make them do)
    var triggerAssignment = {};
    shuffled.forEach(function(pid) {
        triggerAssignment[pid] = TRIGGER_KEYS[Math.floor(Math.random() * TRIGGER_KEYS.length)];
    });

    var endTime = _FB.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
    var batch = _FB.writeBatch(db);

    batch.update(roomRef, {
        status: "active",
        startedAt: _FB.Timestamp.now(),
        endTime: endTime,
        aliveCount: shuffled.length,
        lastUpdated: _FB.serverTimestamp()
    });

    shuffled.forEach(function(pid) {
        batch.update(_FB.doc(_FB.collection(roomRef, "players"), pid), {
            targetId: targetMap[pid],
            assassinId: assassinMap[pid],
            assassinTriggerId: triggerAssignment[pid]
        });
    });

    try {
        await batch.commit();
        debugLog("Game started: " + shuffled.length + " players");
        // Host also enters the game — other devices enter via the room onSnapshot listener
        enterActiveGame();
    } catch(e) {
        debugLog("Start error: " + e.message);
        showToast("Failed to start. Try again.");
        if (startBtn) { startBtn.disabled = false; startBtn.textContent = "UNLEASH CHAOS"; }
    }
}

// ============================================================
// ACTIVE GAME — ENTRY
// ============================================================

async function enterActiveGame() {
    // Guard against double-entry from both the host's direct call and the snapshot
    if (currentGameStatus === "active") return;
    currentGameStatus = "active";
    gameOverHandled = false;
    var _FB = FB;

    if (!playerRef) {
        playerRef = _FB.doc(_FB.collection(roomRef, "players"), currentUser.uid);
    }

    try {
        var snap = await _FB.getDoc(playerRef);
        if (snap.exists()) {
            var data = snap.data();
            aliveFlag = data.alive;
            isDeadLocally = !aliveFlag;
            myTarget = data.targetId;
            myAssassinId = data.assassinId;
            myAssassinTrigger = data.assassinTriggerId;
        }
    } catch(e) {
        debugLog("Error loading player data: " + e.message);
    }

    showCalibration();
}

// ============================================================
// CALIBRATION
// ============================================================

function showCalibration() {
    var steps = [
        { prompt: "ROTATE IT", sub: "Turn your phone sideways. Then back. Get used to it." },
        { prompt: "TRIPLE TAP", sub: "Tap the screen three times quickly." },
        { prompt: "HOLD IT", sub: "Press and hold anywhere on screen for 3 seconds." },
        { prompt: "PINCH IT", sub: "Pinch-zoom in with two fingers." }
    ];

    render(
        '<div class="screen calibration-screen fade-up">' +
        '<h3 style="text-align:center;margin-bottom:0.5rem;">FIELD CALIBRATION</h3>' +
        '<p class="flavor-text" style="text-align:center;">Before we begin — let\'s see what you\'re made of.</p>' +
        '<div class="calibration-bar-wrap"><div class="calibration-bar-fill" id="calibBar"></div></div>' +
        '<div class="calibration-prompt" id="calibPrompt">' + steps[0].prompt + '</div>' +
        '<div class="calibration-sub" id="calibSub">' + steps[0].sub + '</div>' +
        '<div class="calibration-step-count" id="calibCount">1 / ' + steps.length + '</div>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-primary" id="calibNextBtn">DONE</button>' +
        '<button class="btn-ghost" id="calibSkipBtn">SKIP CALIBRATION</button>' +
        '</div>'
    );

    var step = 0;
    function advance() {
        step++;
        var bar = document.getElementById("calibBar");
        if (bar) bar.style.width = ((step / steps.length) * 100) + "%";
        if (step >= steps.length) { setTimeout(showMission, 300); return; }
        var prompt = document.getElementById("calibPrompt");
        var sub = document.getElementById("calibSub");
        var count = document.getElementById("calibCount");
        if (prompt) {
            prompt.style.opacity = "0";
            var s = steps[step];
            setTimeout(function() { prompt.textContent = s.prompt; prompt.style.opacity = "1"; }, 150);
        }
        if (sub) sub.textContent = steps[step].sub;
        if (count) count.textContent = (step + 1) + " / " + steps.length;
    }
    document.getElementById("calibNextBtn").addEventListener("click", advance);
    document.getElementById("calibSkipBtn").addEventListener("click", showMission);
}

// ============================================================
// MISSION BRIEFING
// ============================================================

async function showMission() {
    var _FB = FB;
    var targetName = "UNKNOWN";
    var methodText = "---";
    var tipText = "";

    if (myTarget) {
        try {
            var targetSnap = await _FB.getDoc(_FB.doc(_FB.collection(roomRef, "players"), myTarget));
            if (targetSnap.exists()) {
                targetName = targetSnap.data().name;
                myTargetsTrigger = targetSnap.data().assassinTriggerId;
                var tdef = TRIGGERS[myTargetsTrigger];
                if (tdef) { methodText = tdef.action; tipText = tdef.tip; }
            }
        } catch(e) { debugLog("Error fetching target: " + e.message); }
    }

    var tipHTML = tipText
        ? '<div style="margin-top:1rem;padding:0.8rem;background:rgba(255,255,255,0.03);border-left:2px solid var(--border);">' +
          '<span style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.2em;color:var(--text-dim);text-transform:uppercase;display:block;margin-bottom:0.3rem;">Cover story</span>' +
          '<span style="font-family:var(--font-body);font-style:italic;font-size:0.95rem;color:var(--text-muted);">' + tipText + '</span></div>'
        : "";

    render(
        '<div class="screen fade-up">' +
        '<h3 style="margin-bottom:2rem;">YOUR ORDERS</h3>' +
        '<div class="mission-card">' +
        '<div class="mission-label">TARGET</div>' +
        '<div class="mission-target">' + targetName + '</div>' +
        '<div class="mission-method-label">METHOD</div>' +
        '<div class="mission-method">Get them to: <strong>' + methodText + '</strong></div>' +
        tipHTML +
        '<div class="mission-warning"><p>&#9888; Your assassin is already watching you.<br>They know exactly what makes you slip.</p></div>' +
        '</div>' +
        '<p class="flavor-text" style="font-size:0.9rem;">Be subtle. Be patient. Be ruthless.<br>Sensors arm the moment you tap below.</p>' +
        '<div style="font-family:var(--font-mono);font-size:0.65rem;letter-spacing:0.15em;color:var(--text-dim);text-align:center;margin-bottom:1rem;">&#9888; Keep your screen awake during the hunt</div>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-primary" id="startHuntBtn">&#128274; I\'VE READ THIS. START THE HUNT.</button>' +
        '</div>'
    );

    document.getElementById("startHuntBtn").addEventListener("click", function() {
        startSensors();
        showGameHUD();
        subscribeActiveGame();
    });
}

// ============================================================
// GAME HUD
// ============================================================

function showGameHUD() {
    render(
        '<div class="screen fade-up" id="gameHUDScreen">' +
        '<div class="hud">' +
        '<span class="hud-alive" id="aliveCountHUD">&#128101; --</span>' +
        '<span class="hud-timer" id="timerDisplay">10:00</span>' +
        '<span class="hud-status" id="statusBadge">HUNTING</span>' +
        '</div>' +
        '<div id="eliminatedBanner"></div>' +
        '<div class="mission-card" id="missionCard">' +
        '<div class="mission-label">TARGET</div>' +
        '<div class="mission-target" id="targetName">---</div>' +
        '<div class="mission-method-label">MAKE THEM</div>' +
        '<div class="mission-method" id="missionText">---</div>' +
        '</div>' +
        '<p class="flavor-text" id="flavorLine">Stay close. Stay quiet. Wait for your moment.</p>' +
        debugPanel() +
        '</div>'
    );
    refreshMissionCard();
}

async function refreshMissionCard() {
    if (!playerRef) return;
    var _FB = FB;
    try {
        var snap = await _FB.getDoc(playerRef);
        if (!snap.exists()) return;
        var data = snap.data();
        myTarget = data.targetId;
        myAssassinId = data.assassinId;
        myAssassinTrigger = data.assassinTriggerId;
        aliveFlag = data.alive;
        isDeadLocally = !aliveFlag;

        if (myTarget) {
            var targetSnap = await _FB.getDoc(_FB.doc(_FB.collection(roomRef, "players"), myTarget));
            if (targetSnap.exists()) {
                myTargetsTrigger = targetSnap.data().assassinTriggerId;
                var el = document.getElementById("targetName");
                var mt = document.getElementById("missionText");
                if (el) el.textContent = targetSnap.data().name;
                if (mt) mt.textContent = (TRIGGERS[myTargetsTrigger] && TRIGGERS[myTargetsTrigger].action) || "---";
            }
        }

        if (!aliveFlag) {
            document.body.classList.add("is-dead");
            var banner = document.getElementById("eliminatedBanner");
            if (banner) banner.innerHTML = '<div class="eliminated-banner"><p>&#9760; YOU HAVE BEEN ELIMINATED</p></div>';
            var sb = document.getElementById("statusBadge");
            if (sb) { sb.textContent = "ELIMINATED"; sb.style.color = "var(--text-dim)"; }
            var fl = document.getElementById("flavorLine");
            if (fl) fl.textContent = "Your contract has been fulfilled. Watch the others fall.";
        }
    } catch(e) { debugLog("refreshMissionCard error: " + e.message); }
}

// ============================================================
// SUBSCRIPTIONS (ACTIVE GAME)
// ============================================================

function subscribeActiveGame() {
    if (unsubRoom) unsubRoom();
    if (unsubMe) unsubMe();

    unsubRoom = FB.onSnapshot(roomRef, function(snap) {
        var data = snap.data();
        if (!data) return;

        if (data.endTime && data.endTime.toMillis) {
            endTimestamp = data.endTime.toMillis();
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(updateTimer, 1000);
            updateTimer();
        }

        var aliveEl = document.getElementById("aliveCountHUD");
        if (aliveEl && data.aliveCount !== undefined) {
            aliveEl.textContent = "&#128101; " + data.aliveCount + " alive";
        }

        if (data.status === "ended" && !gameOverHandled) {
            gameOverHandled = true;
            handleGameOver(data.winnerIds);
        }
    });

    unsubMe = FB.onSnapshot(playerRef, function(snap) {
        if (!snap.exists()) return;
        var me = snap.data();

        // Eliminated externally (wrong guess by someone else)
        if (aliveFlag && me.alive === false && !isDeadLocally) {
            isDeadLocally = true;
            aliveFlag = false;
            if (sensorManager) sensorManager.destroy();
            document.body.classList.add("is-dead");
            showToast("You've been eliminated.");
            refreshMissionCard();
        }

        // New target assigned after eliminating someone
        if (aliveFlag && me.targetId && myTarget && me.targetId !== myTarget) {
            showToast("Target neutralised. New assignment incoming.");
        }

        aliveFlag = me.alive;
        myTarget = me.targetId;
        myAssassinId = me.assassinId;
        myAssassinTrigger = me.assassinTriggerId;

        if (me.targetId !== null) refreshMissionCard();
    });
}

// ============================================================
// TIMER
// ============================================================

function updateTimer() {
    if (!endTimestamp) return;
    var diff = Math.max(0, endTimestamp - Date.now());
    var m = Math.floor(diff / 60000);
    var s = Math.floor((diff % 60000) / 1000);
    var el = document.getElementById("timerDisplay");
    if (el) {
        el.textContent = m + ":" + (s < 10 ? "0" + s : s);
        if (diff < 60000) { el.classList.add("urgent"); } else { el.classList.remove("urgent"); }
    }
    if (diff <= 0 && currentGameStatus === "active") endGameByTimer();
}

async function endGameByTimer() {
    if (gameOverHandled) return;
    currentGameStatus = "ended";
    gameOverHandled = true;
    var _FB = FB;
    try {
        var roomSnap = await _FB.getDoc(roomRef);
        if (roomSnap.exists() && roomSnap.data().status !== "ended") {
            var aliveQuery = await _FB.getDocs(_FB.query(_FB.collection(roomRef, "players"), _FB.where("alive", "==", true)));
            var winners = [];
            aliveQuery.forEach(function(d) { winners.push(d.id); });
            await _FB.updateDoc(roomRef, { status: "ended", winnerIds: winners });
        }
    } catch(e) { debugLog("endGameByTimer error: " + e.message); }
}

// ============================================================
// SENSOR MANAGER
// Five triggers: rotate, triple tap, long press, switch tabs, pinch zoom
// ============================================================

function startSensors() {
    if (sensorManager) sensorManager.destroy();
    sensorManager = new SensorManager();
    sensorManager.init();
}

class SensorManager {
    constructor() {
        this.active = false;
        this.guessScreenOpen = false;

        // Rotation
        this.lastOrientation = null;
        this.orientationDebounce = null;

        // Triple tap
        this.tapTimes = [];

        // Long press
        this.longPressTimer = null;
        this.touchMoved = false;
        this.longPressTouchStart = null;

        // Switch tabs
        this.visibilityTimer = null;
        this.visibilityArmed = false;

        // Pinch zoom
        this.pinchTimer = null;

        this._onOrientationChange = this._onOrientationChange.bind(this);
        this._onTap = this._onTap.bind(this);
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchEnd = this._onTouchEnd.bind(this);
        this._onTouchMove = this._onTouchMove.bind(this);
        this._onVisibilityChange = this._onVisibilityChange.bind(this);
    }

    init() {
        if (!aliveFlag || isDeadLocally) return;

        this.lastOrientation = this._currentOrientation();

        // Orientation change
        if (screen.orientation) {
            screen.orientation.addEventListener("change", this._onOrientationChange);
        } else {
            window.addEventListener("orientationchange", this._onOrientationChange);
        }

        // Tap, touch
        document.addEventListener("click", this._onTap);
        document.addEventListener("touchstart", this._onTouchStart, { passive: false });
        document.addEventListener("touchend", this._onTouchEnd);
        document.addEventListener("touchmove", this._onTouchMove, { passive: true });

        // Visibility
        document.addEventListener("visibilitychange", this._onVisibilityChange);

        // Grace period: 8s before any trigger fires
        var self = this;
        setTimeout(function() {
            self.active = true;
            debugLog("Sensors armed");
            // Visibility gets 15s total grace to avoid auto-lock false fires on game start
            setTimeout(function() {
                self.visibilityArmed = true;
                debugLog("Visibility armed");
            }, 7000);
        }, 8000);

        debugLog("SensorManager initialised — 8s grace period");
    }

    _currentOrientation() {
        if (screen.orientation) {
            return screen.orientation.type.indexOf("portrait") !== -1 ? "portrait" : "landscape";
        }
        return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    }

    // ——— TRIGGER 1: ROTATE DEVICE (bidirectional) ———
    _onOrientationChange() {
        if (!this.active || !aliveFlag || isDeadLocally) return;
        if (myAssassinTrigger !== "ROTATE_DEVICE") return;
        var self = this;
        if (this.orientationDebounce) clearTimeout(this.orientationDebounce);
        this.orientationDebounce = setTimeout(function() {
            var newOrientation = self._currentOrientation();
            if (newOrientation !== self.lastOrientation) {
                debugLog("Orientation changed: " + self.lastOrientation + " -> " + newOrientation);
                self.lastOrientation = newOrientation;
                self._triggerFired("ROTATE_DEVICE");
            }
        }, 500);
    }

    // ——— TRIGGER 2: TRIPLE TAP ———
    _onTap(e) {
        if (!this.active || !aliveFlag || isDeadLocally) return;
        if (myAssassinTrigger !== "TRIPLE_TAP") return;
        // Only count taps on non-interactive elements
        var tag = e.target.tagName.toLowerCase();
        if (tag === "button" || tag === "input" || tag === "a" || tag === "select" || tag === "textarea") return;
        var now = Date.now();
        this.tapTimes.push(now);
        this.tapTimes = this.tapTimes.filter(function(t) { return now - t < 600; });
        if (this.tapTimes.length >= 3) {
            this.tapTimes = [];
            debugLog("Triple tap detected");
            this._triggerFired("TRIPLE_TAP");
        }
    }

    // ——— TRIGGER 3: LONG PRESS (3 seconds) & TRIGGER 5: PINCH ZOOM ———
    _onTouchStart(e) {
        if (!this.active || !aliveFlag || isDeadLocally) return;

        // Pinch zoom: two simultaneous fingers
        if (myAssassinTrigger === "PINCH_ZOOM" && e.touches.length >= 2) {
            e.preventDefault(); // Block browser native zoom
            if (this.pinchTimer) clearTimeout(this.pinchTimer);
            var self = this;
            // Require both fingers held for 300ms to confirm it's intentional
            this.pinchTimer = setTimeout(function() {
                debugLog("Pinch zoom detected");
                self._triggerFired("PINCH_ZOOM");
            }, 300);
            return;
        }

        if (myAssassinTrigger !== "LONG_PRESS") return;
        if (e.touches.length !== 1) return;
        e.preventDefault(); // Suppress browser context menu and iOS callout

        this.touchMoved = false;
        this.longPressTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (this.longPressTimer) clearTimeout(this.longPressTimer);
        var self = this;
        this.longPressTimer = setTimeout(function() {
            if (!self.touchMoved) {
                debugLog("Long press detected");
                self._triggerFired("LONG_PRESS");
            }
        }, 3000);
    }

    _onTouchMove(e) {
        if (!this.longPressTouchStart || e.touches.length < 1) return;
        var dx = e.touches[0].clientX - this.longPressTouchStart.x;
        var dy = e.touches[0].clientY - this.longPressTouchStart.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
            this.touchMoved = true;
            if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
        }
    }

    _onTouchEnd() {
        if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
        if (this.pinchTimer) { clearTimeout(this.pinchTimer); this.pinchTimer = null; }
        this.longPressTouchStart = null;
    }

    // ——— TRIGGER 4: SWITCH TABS / APPS ———
    _onVisibilityChange() {
        if (!this.active || !aliveFlag || isDeadLocally) return;
        if (myAssassinTrigger !== "SWITCH_TABS") return;
        if (!this.visibilityArmed) return;
        var self = this;
        if (document.hidden) {
            // Must stay hidden for 1500ms — filters brief notification pull-downs
            this.visibilityTimer = setTimeout(function() {
                if (document.hidden) {
                    debugLog("Switch tabs detected");
                    self._triggerFired("SWITCH_TABS");
                }
            }, 1500);
        } else {
            // Came back too soon — cancel
            if (this.visibilityTimer) { clearTimeout(this.visibilityTimer); this.visibilityTimer = null; }
        }
    }

    // ——— TRIGGER FIRED ———
    _triggerFired(triggerId) {
        if (!aliveFlag || isDeadLocally || this.guessScreenOpen) return;
        var cooldown = localTriggerCooldown.get(triggerId);
        if (cooldown && cooldown > Date.now()) { debugLog("Cooldown active for " + triggerId); return; }
        localTriggerCooldown.set(triggerId, Date.now() + 12000);
        this.guessScreenOpen = true;
        this.active = false;
        debugLog("Trigger fired: " + triggerId);
        this._showGuessScreen();
    }

    _showGuessScreen() {
        var self = this;
        FB.getDocs(FB.query(FB.collection(roomRef, "players"), FB.where("alive", "==", true)))
            .then(function(snap) {
                var suspects = [];
                snap.forEach(function(d) {
                    if (d.id !== currentUser.uid) suspects.push({ id: d.id, name: d.data().name });
                });

                var existing = document.getElementById("guessOverlay");
                if (existing) existing.remove();

                var overlay = document.createElement("div");
                overlay.id = "guessOverlay";
                overlay.style.cssText = "position:fixed;inset:0;background:var(--black);z-index:1000;overflow-y:auto;padding:2rem 1.5rem;display:flex;flex-direction:column;max-width:480px;margin:0 auto;";

                var suspectsHTML = suspects.length > 0
                    ? suspects.map(function(s) {
                        return '<button class="suspect-btn" data-id="' + s.id + '" data-name="' + s.name + '">' +
                            '<span>' + s.name + '</span><span class="suspect-arrow">&rarr;</span></button>';
                    }).join("")
                    : '<p style="color:var(--text-dim);text-align:center;font-family:var(--font-mono);font-size:0.8rem;">No other agents alive.</p>';

                overlay.innerHTML =
                    '<div class="guess-header fade-up">' +
                    '<span class="guess-eye">&#128065;</span>' +
                    '<h2>SOMEONE MADE THEIR MOVE</h2>' +
                    '<p class="flavor-text" style="text-align:center;">A move was detected on your phone.<br>Think carefully. Who\'s been too close? Too friendly?</p>' +
                    '<h3 style="text-align:center;margin-bottom:1rem;">WHO IS YOUR ASSASSIN?</h3>' +
                    '</div>' +
                    '<div class="guess-suspects">' + suspectsHTML + '</div>' +
                    '<button class="btn btn-secondary" id="guessTakeHitBtn">Take the hit — I have no idea</button>';

                document.body.appendChild(overlay);

                overlay.querySelectorAll(".suspect-btn").forEach(function(btn) {
                    btn.addEventListener("click", function() {
                        var gid = btn.dataset.id;
                        var gname = btn.dataset.name;
                        overlay.remove();
                        self._resolveGuess(gid, gname);
                    });
                });

                var takeHitBtn = document.getElementById("guessTakeHitBtn");
                if (takeHitBtn) {
                    takeHitBtn.addEventListener("click", function() {
                        overlay.remove();
                        self._resolveGuess(null, null);
                    });
                }
            })
            .catch(function(e) {
                debugLog("showGuessScreen error: " + e.message);
                self.guessScreenOpen = false;
                self.active = aliveFlag && !isDeadLocally;
            });
    }

    async _resolveGuess(guessedId, guessedName) {
        var correctAssassin = myAssassinId;
        var guessedCorrectly = guessedId !== null && guessedId === correctAssassin;

        if (guessedId === null) {
            await this._runEliminationTransaction(currentUser.uid, true);
            showGuessResult(false, null);
        } else if (guessedCorrectly) {
            await this._runEliminationTransaction(correctAssassin, false);
            showGuessResult(true, guessedName);
        } else {
            await this._runEliminationTransaction(currentUser.uid, true);
            showGuessResult(false, guessedName);
        }

        this.guessScreenOpen = false;
        // Resume sensors only if still alive
        var self = this;
        setTimeout(function() {
            if (aliveFlag && !isDeadLocally) self.active = true;
        }, 2000);
    }

    async _runEliminationTransaction(victimId, isSelf) {
        var _FB = FB;
        try {
            await _FB.runTransaction(db, async function(transaction) {
                var victimRef = _FB.doc(_FB.collection(roomRef, "players"), victimId);
                var victimSnap = await transaction.get(victimRef);
                var roomSnap = await transaction.get(roomRef);

                if (!victimSnap.exists() || victimSnap.data().alive === false) return;
                if (roomSnap.data().status !== "active") return;

                var victimData = victimSnap.data();
                var newAliveCount = Math.max(0, (roomSnap.data().aliveCount || 1) - 1);

                // Mark victim dead
                transaction.update(victimRef, { alive: false });

                // Re-link the chain:
                // Victim's assassin now inherits victim's target
                // Victim's target's assassin field updates to victim's assassin
                var victimAssassinId = victimData.assassinId;
                var victimTargetId = victimData.targetId;

                if (victimAssassinId && victimTargetId && victimAssassinId !== victimId) {
                    var assassinRef = _FB.doc(_FB.collection(roomRef, "players"), victimAssassinId);
                    transaction.update(assassinRef, { targetId: victimTargetId });
                }

                if (victimTargetId && victimAssassinId && victimTargetId !== victimId) {
                    var newTargetRef = _FB.doc(_FB.collection(roomRef, "players"), victimTargetId);
                    transaction.update(newTargetRef, { assassinId: victimAssassinId });
                }

                // Update room alive count
                transaction.update(roomRef, {
                    aliveCount: newAliveCount,
                    lastUpdated: _FB.serverTimestamp()
                });

                // If only one player left, end the game
                if (newAliveCount <= 1) {
                    var winnerId = victimAssassinId; // The one who did the killing is last alive
                    transaction.update(roomRef, {
                        status: "ended",
                        winnerIds: winnerId ? [winnerId] : []
                    });
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
        this.guessScreenOpen = false;
        if (screen.orientation) {
            screen.orientation.removeEventListener("change", this._onOrientationChange);
        } else {
            window.removeEventListener("orientationchange", this._onOrientationChange);
        }
        document.removeEventListener("click", this._onTap);
        document.removeEventListener("touchstart", this._onTouchStart);
        document.removeEventListener("touchend", this._onTouchEnd);
        document.removeEventListener("touchmove", this._onTouchMove);
        document.removeEventListener("visibilitychange", this._onVisibilityChange);
        if (this.longPressTimer) clearTimeout(this.longPressTimer);
        if (this.pinchTimer) clearTimeout(this.pinchTimer);
        if (this.orientationDebounce) clearTimeout(this.orientationDebounce);
        if (this.visibilityTimer) clearTimeout(this.visibilityTimer);
        debugLog("SensorManager destroyed");
    }
}

// ============================================================
// GUESS RESULT SCREEN
// ============================================================

function showGuessResult(survived, guessedName) {
    var existing = document.getElementById("resultOverlay");
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.id = "resultOverlay";
    overlay.style.cssText = "position:fixed;inset:0;background:var(--black);z-index:1001;display:flex;align-items:center;justify-content:center;padding:2rem;";

    if (survived) {
        overlay.innerHTML =
            '<div class="result-screen fade-up">' +
            '<span class="result-icon">&#9989;</span>' +
            '<div class="result-title success">NICE CATCH</div>' +
            '<p class="result-sub">You spotted the shadow before it got you.<br>' +
            '<strong style="color:var(--gold);">' + guessedName + '</strong> has been neutralised.</p>' +
            '<button class="btn btn-gold" id="resultContinue">BACK TO THE HUNT</button>' +
            '</div>';
    } else {
        overlay.innerHTML =
            '<div class="result-screen fade-up">' +
            '<span class="result-icon">&#9760;</span>' +
            '<div class="result-title danger">WRONG CALL</div>' +
            '<p class="result-sub">' +
            (guessedName ? '<strong style="color:var(--red);">' + guessedName + '</strong> wasn\'t your assassin.<br>' : "") +
            'The shadows don\'t forgive mistakes.<br>You\'ve been eliminated.</p>' +
            '<button class="btn btn-secondary" id="resultContinue">SPECTATE</button>' +
            '</div>';
    }

    document.body.appendChild(overlay);
    document.getElementById("resultContinue").addEventListener("click", function() {
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
    if (unsubRoom) { unsubRoom(); unsubRoom = null; }
    if (unsubMe) { unsubMe(); unsubMe = null; }
    currentGameStatus = "ended";

    var winnerNames = [];
    try {
        var playersSnap = await FB.getDocs(FB.collection(roomRef, "players"));
        playersSnap.forEach(function(d) {
            if (winnerIds && winnerIds.indexOf(d.id) !== -1) winnerNames.push(d.data().name);
        });
    } catch(e) { debugLog("handleGameOver fetch error: " + e.message); }

    var isWinner = winnerIds && winnerIds.indexOf(currentUser.uid) !== -1;

    var winnerLines = "";
    if (winnerNames.length === 1) {
        winnerLines =
            '<span class="winner-name">' + winnerNames[0] + '</span>' +
            '<p class="flavor-text" style="text-align:center;">Every agent in the city had their name.<br>None of them were good enough.</p>';
    } else if (winnerNames.length > 1) {
        winnerLines =
            '<h3 style="text-align:center;margin-bottom:0.8rem;">SURVIVORS</h3>' +
            '<div class="survivors-list">' +
            winnerNames.map(function(n) { return '<div class="survivor-item">' + n + '</div>'; }).join("") +
            '</div>' +
            '<p class="flavor-text" style="text-align:center;">Time ran out. The contracts remain open.</p>';
    } else {
        winnerLines = '<p class="flavor-text" style="text-align:center;">No survivors. The city swallowed everyone.</p>';
    }

    render(
        '<div class="screen fade-up" style="text-align:center;">' +
        '<div style="padding-top:4rem;">' +
        '<span class="result-icon" style="font-size:4rem;display:block;margin-bottom:1rem;">' + (isWinner ? "&#127942;" : "&#9760;") + '</span>' +
        '<div class="result-title ' + (isWinner ? "success" : "") + '" style="margin-bottom:0.5rem;">' +
        (winnerIds && winnerIds.length === 1 ? "THE LAST SHADOW" : "TIME\'S UP") +
        '</div>' +
        winnerLines +
        '</div>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-primary" id="runItBackBtn">&#128260; RUN IT BACK</button>' +
        '<button class="btn-ghost" id="quitBtn">DISAPPEAR</button>' +
        '</div>'
    );

    document.getElementById("runItBackBtn").addEventListener("click", function() {
        localStorage.removeItem("shadowmark_room");
        window.location.reload();
    });
    document.getElementById("quitBtn").addEventListener("click", function() {
        localStorage.clear();
        window.location.reload();
    });
}

// ============================================================
// LEAVE ROOM
// ============================================================

async function leaveRoom() {
    if (roomRef && currentUser && playerRef) {
        try { await FB.updateDoc(playerRef, { connected: false }); } catch(e) {}
    }
    if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
    if (unsubRoom) { unsubRoom(); unsubRoom = null; }
    if (unsubMe) { unsubMe(); unsubMe = null; }
    localStorage.removeItem("shadowmark_room");
    window.location.reload();
}

// ============================================================
// BOOT
// ============================================================

function boot() {
    debugLog("Booting Shadowmark...");
    var app = FB.initializeApp(firebaseConfig);
    auth = FB.getAuth(app);
    db = FB.getFirestore(app);

    FB.onAuthStateChanged(auth, function(user) {
        if (!user) {
            debugLog("Signing in anonymously...");
            FB.signInAnonymously(auth).catch(function(e) {
                debugLog("Auth error: " + e.message);
                render(
                    '<div class="screen" style="text-align:center;justify-content:center;">' +
                    '<h2>FIREBASE ERROR</h2>' +
                    '<p class="flavor-text">' + e.message + '</p>' +
                    '<p style="font-family:var(--font-mono);font-size:0.75rem;color:var(--text-dim);">Enable Anonymous Auth in your Firebase console.</p>' +
                    '<button class="btn btn-secondary" onclick="location.reload()">RETRY</button>' +
                    '</div>'
                );
            });
            return;
        }

        currentUser = user;
        debugLog("Authenticated: " + user.uid);

        var savedName = localStorage.getItem("shadowmark_name");
        var savedRoom = localStorage.getItem("shadowmark_room");

        if (savedName) {
            currentPlayerName = savedName;
            if (savedRoom) {
                roomCode = savedRoom;
                roomRef = FB.doc(db, "rooms", savedRoom);
                FB.getDoc(roomRef).then(function(snap) {
                    if (!snap.exists() || snap.data().status === "ended") {
                        localStorage.removeItem("shadowmark_room");
                        showHome();
                    } else if (snap.data().status === "active") {
                        enterActiveGame();
                    } else {
                        goToLobby();
                    }
                }).catch(function() { showHome(); });
            } else {
                showHome();
            }
        } else {
            showNameInput();
        }
    });
}

// Poll until Firebase module has loaded
function waitForFirebase() {
    if (window._firebase) {
        FB = window._firebase;
        boot();
    } else {
        setTimeout(waitForFirebase, 50);
    }
}
waitForFirebase();
