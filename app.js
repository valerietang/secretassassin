// ============================================================
// SHADOWMARK — Core Game Logic
// ============================================================

const DEBUG_MODE = false;

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
        action: "rotate their phone sideways (or back)",
        hud: "rotate their phone",
        tip: "\"Turn your phone sideways to see this\" or \"flip it back, looks better portrait\"",
        icon: "rotate",
        emoji: "&#128241;"
    },
    TRIPLE_TAP: {
        id: "TRIPLE_TAP",
        action: "triple-tap their screen",
        hud: "triple-tap their screen",
        tip: "\"Tap here three times to confirm\" or pretend it's a UI gesture",
        icon: "tap",
        emoji: "&#128077;"
    },
    LONG_PRESS: {
        id: "LONG_PRESS",
        action: "hold their finger on the screen for 3 seconds",
        hud: "press and hold their screen",
        tip: "\"Press and hold that\" while showing them something on your phone",
        icon: "hold",
        emoji: "&#9995;"
    },
    SWITCH_TABS: {
        id: "SWITCH_TABS",
        action: "switch apps or open another tab",
        hud: "leave this app — even briefly",
        tip: "\"Google this for me\" or \"open your camera and take a photo\"",
        icon: "tabs",
        emoji: "&#128247;"
    },
    PINCH_ZOOM: {
        id: "PINCH_ZOOM",
        action: "pinch-zoom on their screen",
        hud: "pinch-zoom on their screen",
        tip: "\"Zoom in on this\" while showing them a photo, map, or small text",
        icon: "pinch",
        emoji: "&#128072;"
    }
};
const TRIGGER_KEYS = Object.keys(TRIGGERS);

// ============================================================
// GLOBALS
// ============================================================
let FB = null, db = null, auth = null;
let currentUser = null, currentPlayerName = "";
let roomCode = localStorage.getItem("shadowmark_room") || null;
let roomRef = null, playerRef = null;
let unsubPlayers = null, unsubRoom = null, unsubMe = null, unsubSpectator = null;
let currentGameStatus = "lobby";
let aliveFlag = true, isDeadLocally = false;
let myTarget = null, myAssassinId = null, myAssassinTrigger = null, myTargetsTrigger = null;
let timerInterval = null, endTimestamp = null;
let sensorManager = null;
let localTriggerCooldown = new Map();
let gameOverHandled = false;
let isHost = false;
let myTrigger = null; // My own trigger (revealed on death)
let ordersDrawerOpen = false;
let missionTip = "";
let missionMethodText = "";
let missionTargetName = "";

// ============================================================
// UTILITIES
// ============================================================
function debugLog(msg) {
    if (!DEBUG_MODE) return;
    console.log("[SM]", msg);
    var p = document.getElementById("debugLogPanel");
    if (p) { p.innerHTML += "> " + new Date().toLocaleTimeString() + " " + msg + "<br>"; p.scrollTop = p.scrollHeight; }
}

function showToast(msg) {
    var c = document.getElementById("toastContainer");
    if (!c) return;
    var t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    c.appendChild(t);
    setTimeout(function() { t.remove(); }, 3200);
}

function render(html) {
    var r = document.getElementById("appRoot");
    if (r) r.innerHTML = html;
}

function dp() { return DEBUG_MODE ? '<div class="debug-panel" id="debugLogPanel"></div>' : ""; }

function gestureAnimHTML(icon) {
    switch(icon) {
        case "rotate": return '<span class="gesture-anim anim-rotate">&#128241;</span>';
        case "tap":    return '<span class="gesture-anim anim-tap"><span class="anim-tap-ring">&#128077;</span></span>';
        case "hold":   return '<span class="gesture-anim" style="position:relative;display:inline-block;"><span style="font-size:3.5rem;">&#9995;</span><span class="anim-hold-ring"></span></span>';
        case "tabs":   return '<span class="gesture-anim anim-tabs">&#128247;</span>';
        case "pinch":  return '<span class="gesture-anim anim-pinch">&#128072;&#128072;</span>';
        default:       return '<span class="gesture-anim">&#10067;</span>';
    }
}

// ============================================================
// INTRO (first-time only)
// ============================================================
function shouldShowIntro() { return !localStorage.getItem("shadowmark_seen_intro"); }

function showIntro() {
    localStorage.setItem("shadowmark_seen_intro", "1");
    var slides = [
        { icon:"&#128299;", title:"YOU HAVE A TARGET", body:"Someone at this gathering has been marked. That someone is your target. Only you know." },
        { icon:"&#128065;", title:"SOMEONE HAS YOU", body:"Right now, someone here is hunting you. They're watching. Waiting for you to slip." },
        { icon:"&#129333;", title:"MAKE THEM SLIP", body:"Get your target to perform a physical gesture on their phone. Without them realising. That's the kill." }
    ];
    var current = 0;

    function buildSlides() {
        return slides.map(function(s, i) {
            return '<div class="intro-slide' + (i === 0 ? " active" : "") + '" id="introSlide' + i + '">' +
                '<span class="intro-icon">' + s.icon + '</span>' +
                '<div class="intro-title">' + s.title + '</div>' +
                '<p class="intro-body">' + s.body + '</p>' +
                '</div>';
        }).join("");
    }

    function buildDots() {
        return slides.map(function(_, i) {
            return '<div class="intro-dot' + (i === 0 ? " active" : "") + '" id="introDot' + i + '"></div>';
        }).join("");
    }

    render(
        '<div class="screen fade-up">' +
        '<div style="display:flex;justify-content:flex-end;padding-bottom:0.5rem;">' +
        '<button class="btn-ghost" id="introSkipBtn">SKIP</button>' +
        '</div>' +
        '<div class="intro-wrap">' +
        '<div class="intro-slides" id="introSlidesWrap">' + buildSlides() + '</div>' +
        '<div class="intro-dots">' + buildDots() + '</div>' +
        '<div class="intro-nav">' +
        '<button class="btn btn-secondary" id="introPrevBtn" style="display:none;">BACK</button>' +
        '<button class="btn btn-primary" id="introNextBtn">NEXT</button>' +
        '</div>' +
        '</div>' +
        '</div>'
    );

    function goTo(idx) {
        var prev = document.getElementById("introSlide" + current);
        var prevDot = document.getElementById("introDot" + current);
        if (prev) prev.classList.add("exit");
        setTimeout(function() { if (prev) { prev.classList.remove("active", "exit"); } }, 400);
        if (prevDot) prevDot.classList.remove("active");
        current = idx;
        var next = document.getElementById("introSlide" + current);
        var nextDot = document.getElementById("introDot" + current);
        if (next) { setTimeout(function() { next.classList.add("active"); }, 50); }
        if (nextDot) nextDot.classList.add("active");
        var prevBtn = document.getElementById("introPrevBtn");
        var nextBtn = document.getElementById("introNextBtn");
        if (prevBtn) prevBtn.style.display = current > 0 ? "block" : "none";
        if (nextBtn) nextBtn.textContent = current === slides.length - 1 ? "LET'S GO" : "NEXT";
    }

    document.getElementById("introNextBtn").addEventListener("click", function() {
        if (current < slides.length - 1) { goTo(current + 1); }
        else { showNameInput(); }
    });
    document.getElementById("introPrevBtn").addEventListener("click", function() {
        if (current > 0) goTo(current - 1);
    });
    document.getElementById("introSkipBtn").addEventListener("click", showNameInput);
}

// ============================================================
// NAME INPUT
// ============================================================
function showNameInput() {
    render(
        '<div class="screen fade-up">' +
        '<div class="screen-header" style="padding-top:3.5rem;">' +
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
    var inp = document.getElementById("playerNameInput");
    document.getElementById("confirmNameBtn").addEventListener("click", confirmName);
    inp.addEventListener("keypress", function(e) { if (e.key === "Enter") confirmName(); });
    inp.focus();
}

function confirmName() {
    var name = document.getElementById("playerNameInput").value.trim().toUpperCase();
    if (!name) { showToast("You need a name, agent."); return; }
    currentPlayerName = name;
    localStorage.setItem("shadowmark_name", name);
    // Check for pending join from link
    var pendingRoom = sessionStorage.getItem("shadowmark_pending_join");
    if (pendingRoom) { sessionStorage.removeItem("shadowmark_pending_join"); joinRoom(pendingRoom); }
    else showHome();
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
        dp() + '</div>'
    );
    document.getElementById("createRoomBtn").addEventListener("click", createNewRoom);
    document.getElementById("joinRoomBtn").addEventListener("click", function() {
        var c = document.getElementById("joinCodeInput").value.trim().toUpperCase();
        if (c) joinRoom(c);
    });
    document.getElementById("joinCodeInput").addEventListener("keypress", function(e) {
        if (e.key === "Enter") { var c = e.target.value.trim().toUpperCase(); if (c) joinRoom(c); }
    });
}

// ============================================================
// ROOM CREATION & JOINING
// ============================================================
async function createNewRoom() {
    if (!currentUser) return;
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
    var code = "";
    for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    try {
        await FB.setDoc(FB.doc(db, "rooms", code), {
            hostId: currentUser.uid, status: "lobby",
            createdAt: FB.serverTimestamp(), aliveCount: 0,
            winnerIds: [], killFeed: []
        });
        await joinRoom(code);
    } catch(e) { debugLog("createRoom err: " + e.message); showToast("Error creating room. Try again."); }
}

async function joinRoom(code) {
    if (!code || !currentUser) return;
    roomCode = code;
    localStorage.setItem("shadowmark_room", code);
    roomRef = FB.doc(db, "rooms", code);
    var snap;
    try { snap = await FB.getDoc(roomRef); }
    catch(e) { showToast("Couldn't reach the server."); return; }
    if (!snap.exists()) { showToast("No safehouse found with that code."); return; }
    var room = snap.data();
    if (room.status === "ended") { showToast("That operation is over."); return; }
    playerRef = FB.doc(FB.collection(roomRef, "players"), currentUser.uid);
    isHost = (room.hostId === currentUser.uid);
    if (room.status === "active") {
        var ex = await FB.getDoc(playerRef);
        if (ex.exists() && ex.data().alive) { enterActiveGame(); return; }
        showToast("Operation already in progress.");
        return;
    }
    var existing = await FB.getDoc(playerRef);
    if (!existing.exists()) {
        await FB.setDoc(playerRef, {
            name: currentPlayerName, alive: true, isHost: isHost,
            joinedAt: FB.serverTimestamp(), sensorReady: false, connected: true,
            lastSeen: FB.serverTimestamp(), targetId: null, assassinId: null, assassinTriggerId: null
        });
    } else {
        await FB.updateDoc(playerRef, { connected: true, lastSeen: FB.serverTimestamp(), name: currentPlayerName });
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
    var shareURL = window.location.origin + window.location.pathname + "?join=" + roomCode;
    render(
        '<div class="screen fade-up">' +
        '<div class="how-it-works">' +
        '<div class="how-it-works-title">HOW IT WORKS</div>' +
        '<ul class="how-it-works-steps">' +
        '<li>You get a secret target and a gesture to make them perform</li>' +
        '<li>Your assassin is trying to make YOU perform YOUR gesture</li>' +
        '<li>Make your target slip without getting caught first</li>' +
        '</ul>' +
        '</div>' +
        '<div class="room-code-display">' +
        '<div class="room-code-value">' + roomCode + '</div>' +
        '<div class="room-code-hint">Share this code — or send the link below</div>' +
        '</div>' +
        '<div class="share-row">' +
        '<button class="btn btn-secondary" id="shareLinkBtn">&#128279; SHARE LINK</button>' +
        '<button class="btn btn-secondary" id="copyCodeBtn">&#128203; COPY CODE</button>' +
        '</div>' +
        '<h3 style="margin-bottom:0.6rem;">AGENTS</h3>' +
        '<div id="lobbyPlayerList" class="player-list">' +
        '<p style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.72rem;">Awaiting agents...</p>' +
        '</div>' +
        '<div id="sensorStatusArea"></div>' +
        '<div id="lobbyFooter" class="lobby-footer"></div>' +
        '<button class="btn btn-gold" id="readyBtn">&#10003; I\'M READY</button>' +
        '<button class="btn btn-primary" id="startGameBtn" disabled>&#9654; UNLEASH CHAOS</button>' +
        '<button class="btn-ghost" id="leaveLobbyBtn">&#8617; ABORT MISSION</button>' +
        dp() + '</div>'
    );

    // Share link
    document.getElementById("shareLinkBtn").addEventListener("click", function() {
        if (navigator.share) {
            navigator.share({ title: "SHADOWMARK", text: "Join my game — code: " + roomCode, url: shareURL })
                .catch(function() {});
        } else {
            navigator.clipboard.writeText(shareURL).then(function() { showToast("Link copied to clipboard."); })
                .catch(function() { showToast("Room code: " + roomCode); });
        }
    });

    document.getElementById("copyCodeBtn").addEventListener("click", function() {
        navigator.clipboard.writeText(roomCode).then(function() { showToast("Code copied: " + roomCode); })
            .catch(function() { showToast("Code: " + roomCode); });
    });

    document.getElementById("readyBtn").addEventListener("click", markReady);
    document.getElementById("startGameBtn").addEventListener("click", startGameTransaction);
    document.getElementById("leaveLobbyBtn").addEventListener("click", leaveRoom);
}

async function markReady() {
    var btn = document.getElementById("readyBtn");
    if (btn) { btn.disabled = true; btn.textContent = "ARMING..."; }
    var timeout = setTimeout(function() {
        if (btn) { btn.disabled = false; btn.textContent = "I'M READY"; }
        showToast("Connection slow — try again.");
    }, 5000);
    try {
        await FB.updateDoc(playerRef, { sensorReady: true, connected: true });
        clearTimeout(timeout);
        var area = document.getElementById("sensorStatusArea");
        if (area) area.innerHTML = '<div class="armed-confirm">&#10003; LOCKED IN</div>';
        if (btn) { btn.disabled = true; btn.textContent = "&#10003; READY"; }
    } catch(e) {
        clearTimeout(timeout);
        if (btn) { btn.disabled = false; btn.textContent = "I'M READY"; }
        showToast("Error. Try again.");
    }
}

function subscribeLobby() {
    if (unsubPlayers) unsubPlayers();
    if (unsubRoom) unsubRoom();

    unsubRoom = FB.onSnapshot(roomRef, function(snap) {
        var data = snap.data();
        if (!data) return;
        if (data.status === "active" && currentGameStatus !== "active") {
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
                var statusLine = p.sensorReady ? "locked and loaded." : "still deciding if they want to do this.";
                html += '<div class="player-item">' +
                    '<div class="player-item-left">' +
                    '<span class="player-name">' + p.name + '</span>' +
                    '<span class="player-status-line">' + statusLine + '</span>' +
                    '</div>' +
                    '<div class="player-badges">' +
                    (p.isHost ? '<span class="badge badge-host">HOST</span>' : "") +
                    (p.sensorReady ? '<span class="badge badge-armed">READY</span>' : '<span class="badge badge-pending">WAITING</span>') +
                    '</div></div>';
            });
            container.innerHTML = html || '<p style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.72rem;">Awaiting agents...</p>';
        }

        var armedCount = players.filter(function(p) { return p.sensorReady; }).length;
        var needMore = Math.max(0, 3 - armedCount);
        var amHost = players.some(function(p) { return p.id === currentUser.uid && p.isHost; });
        isHost = amHost;
        var allReady = armedCount === players.length && players.length >= 3;
        var startBtn = document.getElementById("startGameBtn");
        var footer = document.getElementById("lobbyFooter");

        if (startBtn) {
            if (amHost && armedCount >= 3) {
                startBtn.disabled = false;
                startBtn.classList.add("pulsing");
                startBtn.textContent = "UNLEASH CHAOS (" + armedCount + " READY)";
            } else if (amHost) {
                startBtn.disabled = true;
                startBtn.classList.remove("pulsing");
                startBtn.textContent = "WAITING FOR " + needMore + " MORE...";
            } else {
                startBtn.disabled = true;
                startBtn.classList.remove("pulsing");
                startBtn.textContent = "WAITING FOR HOST...";
            }
        }

        if (footer) {
            if (allReady) {
                footer.textContent = "ALL AGENTS ARMED — HOST, START WHEN READY";
                footer.classList.add("all-ready");
            } else {
                footer.textContent = armedCount + " / " + players.length + " READY";
                footer.classList.remove("all-ready");
            }
        }
    });
}

// ============================================================
// START GAME
// ============================================================
async function startGameTransaction() {
    if (!roomRef) return;
    var startBtn = document.getElementById("startGameBtn");
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = "STARTING..."; startBtn.classList.remove("pulsing"); }

    var playersSnap = await FB.getDocs(FB.collection(roomRef, "players"));
    var players = [];
    playersSnap.forEach(function(d) {
        var data = d.data();
        if (data.alive !== false && data.sensorReady === true) players.push({ id: d.id, data: data });
    });

    if (players.length < 3) {
        showToast("Need at least 3 ready agents.");
        if (startBtn) { startBtn.disabled = false; startBtn.textContent = "UNLEASH CHAOS"; }
        return;
    }

    var shuffled = players.map(function(p) { return p.id; });
    for (var i = shuffled.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }

    var targetMap = {}, assassinMap = {};
    for (var k = 0; k < shuffled.length; k++) {
        targetMap[shuffled[k]] = shuffled[(k + 1) % shuffled.length];
        assassinMap[shuffled[(k + 1) % shuffled.length]] = shuffled[k];
    }

    var triggerAssignment = {};
    shuffled.forEach(function(pid) {
        triggerAssignment[pid] = TRIGGER_KEYS[Math.floor(Math.random() * TRIGGER_KEYS.length)];
    });

    var endTime = FB.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
    var batch = FB.writeBatch(db);
    batch.update(roomRef, {
        status: "active", startedAt: FB.Timestamp.now(), endTime: endTime,
        aliveCount: shuffled.length, lastUpdated: FB.serverTimestamp(), killFeed: []
    });
    shuffled.forEach(function(pid) {
        batch.update(FB.doc(FB.collection(roomRef, "players"), pid), {
            targetId: targetMap[pid], assassinId: assassinMap[pid],
            assassinTriggerId: triggerAssignment[pid]
        });
    });

    try {
        await batch.commit();
        debugLog("Game started: " + shuffled.length + " players");
    } catch(e) {
        debugLog("Start err: " + e.message);
        showToast("Failed to start. Try again.");
        if (startBtn) { startBtn.disabled = false; startBtn.textContent = "UNLEASH CHAOS"; }
    }
}

// ============================================================
// ACTIVE GAME ENTRY
// ============================================================
async function enterActiveGame() {
    if (currentGameStatus === "active") return;
    currentGameStatus = "active";
    gameOverHandled = false;
    if (!playerRef) playerRef = FB.doc(FB.collection(roomRef, "players"), currentUser.uid);
    try {
        var snap = await FB.getDoc(playerRef);
        if (snap.exists()) {
            var d = snap.data();
            aliveFlag = d.alive; isDeadLocally = !aliveFlag;
            myTarget = d.targetId; myAssassinId = d.assassinId;
            myAssassinTrigger = d.assassinTriggerId; myTrigger = d.assassinTriggerId;
            isHost = d.isHost || false;
        }
    } catch(e) { debugLog("enterActiveGame err: " + e.message); }

    // Check if returning player who was already dead
    if (isDeadLocally) { showGameHUD(); subscribeActiveGame(); return; }

    var hasPlayed = localStorage.getItem("shadowmark_played_before");
    if (hasPlayed) { showMissionDirect(); }
    else { localStorage.setItem("shadowmark_played_before", "1"); showMissionSequential(0); }
}

// ============================================================
// MISSION — SEQUENTIAL (first time or new players)
// ============================================================
async function showMissionSequential(step) {
    await loadMissionData();

    var steps = [
        function() { return showMissionStep1(); },
        function() { return showMissionStep2(); },
        function() { return showMissionStep3(); }
    ];
    steps[step]();
}

async function loadMissionData() {
    if (!myTarget) return;
    try {
        var tSnap = await FB.getDoc(FB.doc(FB.collection(roomRef, "players"), myTarget));
        if (tSnap.exists()) {
            missionTargetName = tSnap.data().name;
            myTargetsTrigger = tSnap.data().assassinTriggerId;
            var tdef = TRIGGERS[myTargetsTrigger];
            if (tdef) { missionMethodText = tdef.action; missionTip = tdef.tip; }
        }
    } catch(e) { debugLog("loadMissionData err: " + e.message); }
}

function stepDots(current) {
    var html = '<div class="mission-step-dots">';
    for (var i = 0; i < 3; i++) html += '<div class="mission-step-dot' + (i === current ? " active" : "") + '"></div>';
    html += '</div>';
    return html;
}

function showMissionStep1() {
    render(
        '<div class="screen fade-up">' +
        '<div class="mission-reveal-screen">' +
        stepDots(0) +
        '<div class="mission-step-label">YOUR TARGET IS</div>' +
        '<div class="mission-big-name">' + (missionTargetName || "UNKNOWN") + '</div>' +
        '<p class="flavor-text" style="margin-top:1rem;">Find them. Watch them. Don\'t let on.</p>' +
        '</div>' +
        '<button class="btn btn-primary" id="mStep1Btn">NEXT &rarr;</button>' +
        '</div>'
    );
    document.getElementById("mStep1Btn").addEventListener("click", function() { showMissionStep2(); });
}

function showMissionStep2() {
    var tdef = TRIGGERS[myTargetsTrigger] || {};
    render(
        '<div class="screen fade-up">' +
        '<div class="mission-reveal-screen">' +
        stepDots(1) +
        '<div class="mission-step-label">MAKE THEM</div>' +
        '<div class="mission-big-gesture">' + (tdef.action || "---") + '</div>' +
        gestureAnimHTML(tdef.icon || "") +
        '<div class="mission-cover-label">Cover story</div>' +
        '<div class="mission-cover-text">' + (tdef.tip || "") + '</div>' +
        '</div>' +
        '<button class="btn btn-primary" id="mStep2Btn">NEXT &rarr;</button>' +
        '</div>'
    );
    document.getElementById("mStep2Btn").addEventListener("click", function() { showMissionStep3(); });
}

function showMissionStep3() {
    render(
        '<div class="screen fade-up">' +
        '<div class="mission-reveal-screen">' +
        stepDots(2) +
        '<div class="mission-step-label">REMEMBER</div>' +
        '<div class="mission-big-gesture" style="font-size:1.6rem;line-height:1.4;">Someone here is hunting you.<br>They know what makes you slip.</div>' +
        '<div class="mission-weakness-box">' +
        '<div class="mission-weakness-label">Your weakness</div>' +
        '<div class="mission-weakness-value">&#128274; CLASSIFIED</div>' +
        '</div>' +
        '<p class="flavor-text" style="margin-top:1rem;font-size:0.88rem;">Your assassin knows. You don\'t.<br>Stay paranoid. Stay alive.</p>' +
        '</div>' +
        '<div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.12em;color:var(--text-dim);text-align:center;margin-bottom:0.8rem;">&#9888; Keep your screen awake during the hunt</div>' +
        '<button class="btn btn-primary" id="mStep3Btn">&#128274; START THE HUNT</button>' +
        '</div>'
    );
    document.getElementById("mStep3Btn").addEventListener("click", function() {
        startArmingCountdown();
    });
}

// Returning players — condensed single screen
async function showMissionDirect() {
    await loadMissionData();
    var tdef = TRIGGERS[myTargetsTrigger] || {};
    render(
        '<div class="screen fade-up">' +
        '<h3 style="margin-bottom:1.5rem;">YOUR ORDERS</h3>' +
        '<div class="mission-card">' +
        '<div class="mission-card-header"><div class="mission-label">TARGET</div></div>' +
        '<div class="mission-target" style="padding-left:0.8rem;">' + (missionTargetName || "UNKNOWN") + '</div>' +
        '<div class="mission-method-label">MAKE THEM</div>' +
        '<div class="mission-method" style="padding-left:0.8rem;">' +
        '<span class="mission-gesture-mini">' + (tdef.emoji || "") + '</span>' +
        '<span>' + (missionMethodText || "---") + '</span>' +
        '</div>' +
        '<div style="padding:0.8rem;background:rgba(255,255,255,0.02);border-left:2px solid var(--border);margin-top:1rem;">' +
        '<span class="label">Cover story</span>' +
        '<span style="font-family:var(--font-body);font-style:italic;font-size:0.92rem;color:var(--text-muted);">' + missionTip + '</span>' +
        '</div>' +
        '</div>' +
        '<p class="flavor-text" style="font-size:0.88rem;">Your assassin is already watching.<br>&#9888; Keep your screen awake.</p>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-primary" id="startHuntBtn">&#128274; START THE HUNT</button>' +
        '</div>'
    );
    document.getElementById("startHuntBtn").addEventListener("click", function() { startArmingCountdown(); });
}

// Arming countdown — shows 8s progress bar, then goes live
function startArmingCountdown() {
    var total = 8000;
    var start = Date.now();
    render(
        '<div class="screen" style="justify-content:center;align-items:center;text-align:center;">' +
        '<h3 style="margin-bottom:2rem;">SENSORS ARMING</h3>' +
        '<div class="arm-countdown">' +
        '<div class="arm-bar-wrap"><div class="arm-bar-fill" id="armBarFill"></div></div>' +
        '<div class="arm-countdown-num" id="armCountNum">8</div>' +
        '</div>' +
        '<p class="flavor-text" style="margin-top:2rem;">Get into position.<br>The hunt begins shortly.</p>' +
        '</div>'
    );

    var iv = setInterval(function() {
        var elapsed = Date.now() - start;
        var pct = Math.min(100, (elapsed / total) * 100);
        var remaining = Math.max(0, Math.ceil((total - elapsed) / 1000));
        var bar = document.getElementById("armBarFill");
        var num = document.getElementById("armCountNum");
        if (bar) bar.style.width = pct + "%";
        if (num) { num.textContent = remaining; num.style.color = remaining <= 2 ? "var(--green)" : "var(--text-dim)"; }
        if (elapsed >= total) {
            clearInterval(iv);
            startSensors();
            showGameHUD();
            subscribeActiveGame();
        }
    }, 100);
}

// ============================================================
// GAME HUD
// ============================================================
function showGameHUD() {
    var hostBadgeHTML = isHost
        ? '<button class="host-badge-btn" id="hostPanelBtn" title="Long press for host controls">HOST</button>'
        : "";
    render(
        '<div class="screen fade-up" id="gameHUDScreen">' +
        '<div class="hud">' +
        '<span class="hud-alive" id="aliveCountHUD">&#128101; --</span>' +
        '<span class="hud-timer" id="timerDisplay">10:00</span>' +
        '<div class="hud-right">' +
        '<span class="hud-status" id="statusBadge">HUNTING</span>' +
        hostBadgeHTML +
        '</div>' +
        '</div>' +
        '<div id="eliminatedBanner"></div>' +
        '<div class="mission-card" id="missionCard">' +
        '<div class="mission-card-header">' +
        '<div class="mission-label">TARGET</div>' +
        '<button class="orders-btn" id="ordersBtn">FULL ORDERS &#9650;</button>' +
        '</div>' +
        '<div class="mission-target" id="targetName">---</div>' +
        '<div class="mission-method-label">MAKE THEM</div>' +
        '<div class="mission-method" id="missionText"><span class="mission-gesture-mini" id="missionEmoji"></span><span id="missionAction">---</span></div>' +
        '</div>' +
        '<p class="flavor-text" id="flavorLine">Stay close. Stay quiet. Wait for your moment.</p>' +
        '<div id="spectatorSection"></div>' +
        dp() + '</div>'
    );

    refreshMissionCard();

    // Orders drawer
    document.getElementById("ordersBtn").addEventListener("click", openOrdersDrawer);

    // Host panel — long press
    if (isHost) {
        var hpBtn = document.getElementById("hostPanelBtn");
        if (hpBtn) {
            var hpTimer = null;
            hpBtn.addEventListener("touchstart", function(e) {
                e.preventDefault();
                hpTimer = setTimeout(openHostPanel, 800);
            }, { passive: false });
            hpBtn.addEventListener("touchend", function() { if (hpTimer) clearTimeout(hpTimer); });
            hpBtn.addEventListener("touchcancel", function() { if (hpTimer) clearTimeout(hpTimer); });
            // Desktop fallback
            hpBtn.addEventListener("click", openHostPanel);
        }
    }
}

// Orders drawer
function openOrdersDrawer() {
    if (ordersDrawerOpen) return;
    ordersDrawerOpen = true;
    // Pause sensors briefly
    if (sensorManager) sensorManager.pause(600);

    var tdef = TRIGGERS[myTargetsTrigger] || {};
    var backdrop = document.createElement("div");
    backdrop.className = "orders-drawer-backdrop visible";
    backdrop.id = "ordersBackdrop";
    document.body.appendChild(backdrop);

    var drawer = document.createElement("div");
    drawer.className = "orders-drawer";
    drawer.id = "ordersDrawer";
    drawer.innerHTML =
        '<div class="orders-drawer-handle"></div>' +
        '<div class="drawer-field"><div class="drawer-label">Target</div><div class="drawer-value" style="font-family:var(--font-display);font-size:2rem;letter-spacing:0.12em;">' + (missionTargetName || "---") + '</div></div>' +
        '<div class="drawer-field"><div class="drawer-label">Make them</div><div class="drawer-value">' + gestureAnimHTML(tdef.icon || "") + ' ' + (missionMethodText || "---") + '</div></div>' +
        '<div class="drawer-field"><div class="drawer-label">Cover story</div><div class="drawer-cover">' + (missionTip || "---") + '</div></div>' +
        '<div class="drawer-weakness"><span style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.2em;color:var(--text-dim);">YOUR WEAKNESS — </span>&#128274; classified. Your assassin knows. You don\'t.</div>';
    document.body.appendChild(drawer);
    setTimeout(function() { drawer.classList.add("open"); }, 10);

    function close() {
        drawer.classList.remove("open");
        backdrop.classList.remove("visible");
        setTimeout(function() { drawer.remove(); backdrop.remove(); ordersDrawerOpen = false; }, 320);
    }
    backdrop.addEventListener("click", close);
}

// Host panel
async function openHostPanel() {
    var panel = document.createElement("div");
    panel.className = "host-panel-overlay";
    panel.id = "hostPanelOverlay";

    var playersSnap = await FB.getDocs(FB.collection(roomRef, "players"));
    var alivePlayers = [];
    playersSnap.forEach(function(d) { if (d.data().alive && d.id !== currentUser.uid) alivePlayers.push({ id: d.id, name: d.data().name }); });

    var removeOptions = alivePlayers.map(function(p) {
        return '<option value="' + p.id + '">' + p.name + '</option>';
    }).join("");

    panel.innerHTML =
        '<div class="host-panel">' +
        '<h3>HOST CONTROLS</h3>' +
        '<p class="host-panel-warning">Use these only if something went wrong. Force-ending declares current alive players as winners.</p>' +
        '<button class="btn btn-secondary" id="forceEndBtn">FORCE END GAME</button>' +
        (removeOptions ? '<select id="removePlayerSelect" style="width:100%;background:var(--surface);color:var(--text);border:1px solid var(--border);padding:0.7rem;font-family:var(--font-mono);font-size:0.8rem;margin-bottom:0.7rem;">' + removeOptions + '</select>' +
        '<button class="btn btn-secondary" id="removePlayerBtn">REMOVE SELECTED PLAYER</button>' : "") +
        '<button class="btn-ghost" id="closeHostPanelBtn">CANCEL</button>' +
        '</div>';
    document.body.appendChild(panel);

    document.getElementById("forceEndBtn").addEventListener("click", async function() {
        panel.remove();
        await endGameByTimer();
    });

    if (removeOptions) {
        document.getElementById("removePlayerBtn").addEventListener("click", async function() {
            var sel = document.getElementById("removePlayerSelect");
            if (!sel) return;
            var pid = sel.value;
            var pname = sel.options[sel.selectedIndex].text;
            panel.remove();
            await forceRemovePlayer(pid, pname);
        });
    }

    document.getElementById("closeHostPanelBtn").addEventListener("click", function() { panel.remove(); });
}

async function forceRemovePlayer(playerId, playerName) {
    try {
        await FB.runTransaction(db, async function(transaction) {
            var victimRef = FB.doc(FB.collection(roomRef, "players"), playerId);
            var victimSnap = await transaction.get(victimRef);
            var roomSnap = await transaction.get(roomRef);
            if (!victimSnap.exists() || !victimSnap.data().alive) return;
            if (roomSnap.data().status !== "active") return;
            var vd = victimSnap.data();
            var newCount = Math.max(0, (roomSnap.data().aliveCount || 1) - 1);
            transaction.update(victimRef, { alive: false });
            if (vd.assassinId && vd.targetId && vd.assassinId !== playerId) {
                transaction.update(FB.doc(FB.collection(roomRef, "players"), vd.assassinId), { targetId: vd.targetId });
            }
            if (vd.targetId && vd.assassinId && vd.targetId !== playerId) {
                transaction.update(FB.doc(FB.collection(roomRef, "players"), vd.targetId), { assassinId: vd.assassinId });
            }
            transaction.update(roomRef, { aliveCount: newCount, lastUpdated: FB.serverTimestamp() });
            if (newCount <= 1) transaction.update(roomRef, { status: "ended", winnerIds: vd.assassinId ? [vd.assassinId] : [] });
        });
        showToast(playerName + " removed from the game.");
    } catch(e) { debugLog("forceRemove err: " + e.message); showToast("Failed to remove player."); }
}

async function refreshMissionCard() {
    if (!playerRef) return;
    try {
        var snap = await FB.getDoc(playerRef);
        if (!snap.exists()) return;
        var data = snap.data();
        myTarget = data.targetId; myAssassinId = data.assassinId;
        myAssassinTrigger = data.assassinTriggerId; myTrigger = data.assassinTriggerId;
        aliveFlag = data.alive; isDeadLocally = !aliveFlag;

        if (myTarget) {
            var tSnap = await FB.getDoc(FB.doc(FB.collection(roomRef, "players"), myTarget));
            if (tSnap.exists()) {
                var td = tSnap.data();
                myTargetsTrigger = td.assassinTriggerId;
                missionTargetName = td.name;
                var tdef = TRIGGERS[myTargetsTrigger] || {};
                missionMethodText = tdef.action || "---";
                missionTip = tdef.tip || "";
                var el = document.getElementById("targetName");
                var ma = document.getElementById("missionAction");
                var me = document.getElementById("missionEmoji");
                if (el) el.textContent = td.name;
                if (ma) ma.textContent = tdef.hud || "---";
                if (me) me.innerHTML = tdef.emoji || "";
            }
        }

        if (!aliveFlag) {
            document.body.classList.add("is-dead");
            var banner = document.getElementById("eliminatedBanner");
            if (banner) banner.innerHTML = '<div class="eliminated-banner"><p>&#9760; YOU HAVE BEEN ELIMINATED</p></div>';
            var sb = document.getElementById("statusBadge");
            if (sb) { sb.textContent = "ELIMINATED"; sb.style.color = "var(--text-dim)"; }
            var fl = document.getElementById("flavorLine");
            if (fl) fl.textContent = "Your contract is fulfilled. Watch the others fall.";
            showSpectatorChain();
        }
    } catch(e) { debugLog("refreshMissionCard err: " + e.message); }
}

// Spectator chain for dead players
async function showSpectatorChain() {
    var section = document.getElementById("spectatorSection");
    if (!section) return;

    try {
        var snap = await FB.getDocs(FB.collection(roomRef, "players"));
        var players = {};
        snap.forEach(function(d) { players[d.id] = Object.assign({ id: d.id }, d.data()); });

        var html = '<div class="spectator-section">' +
            '<div class="spectator-title">LIVE ASSASSINATION CHAIN</div>';

        Object.values(players).forEach(function(p) {
            if (!p.targetId) return;
            var target = players[p.targetId];
            if (!target) return;
            html += '<div class="chain-item">' +
                '<span class="chain-hunter' + (!p.alive ? " chain-dead" : "") + '">' + p.name + '</span>' +
                '<span class="chain-arrow">&#10132;</span>' +
                '<span class="chain-prey' + (!target.alive ? " chain-dead" : "") + '">' + target.name + '</span>' +
                '</div>';
        });

        html += '<p class="spectator-warning">Dead agents don\'t talk.<br>Don\'t be the one who ruins it.</p></div>';
        section.innerHTML = html;

        // Subscribe for live updates
        if (unsubSpectator) unsubSpectator();
        unsubSpectator = FB.onSnapshot(FB.collection(roomRef, "players"), function(s) {
            var ps = {};
            s.forEach(function(d) { ps[d.id] = Object.assign({ id: d.id }, d.data()); });
            var sec = document.getElementById("spectatorSection");
            if (!sec) return;
            var h = '<div class="spectator-section"><div class="spectator-title">LIVE ASSASSINATION CHAIN</div>';
            Object.values(ps).forEach(function(p) {
                if (!p.targetId) return;
                var t = ps[p.targetId];
                if (!t) return;
                h += '<div class="chain-item">' +
                    '<span class="chain-hunter' + (!p.alive ? " chain-dead" : "") + '">' + p.name + '</span>' +
                    '<span class="chain-arrow">&#10132;</span>' +
                    '<span class="chain-prey' + (!t.alive ? " chain-dead" : "") + '">' + t.name + '</span>' +
                    '</div>';
            });
            h += '<p class="spectator-warning">Dead agents don\'t talk.<br>Don\'t be the one who ruins it.</p></div>';
            sec.innerHTML = h;
        });
    } catch(e) { debugLog("spectatorChain err: " + e.message); }
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
        var el = document.getElementById("aliveCountHUD");
        if (el && data.aliveCount !== undefined) el.innerHTML = "&#128101; " + data.aliveCount + " alive";
        if (data.status === "ended" && !gameOverHandled) {
            gameOverHandled = true;
            handleGameOver(data.winnerIds, data.killFeed);
        }
    });

    unsubMe = FB.onSnapshot(playerRef, function(snap) {
        if (!snap.exists()) return;
        var me = snap.data();
        if (aliveFlag && me.alive === false && !isDeadLocally) {
            isDeadLocally = true; aliveFlag = false;
            if (sensorManager) sensorManager.destroy();
            document.body.classList.add("is-dead");
            showToast("&#9760; You've been eliminated.");
            // Reveal their trigger
            var tdef = TRIGGERS[myTrigger];
            if (tdef) setTimeout(function() { showToast("Your weakness was: " + tdef.action); }, 1500);
            refreshMissionCard();
        }
        if (aliveFlag && me.targetId && myTarget && me.targetId !== myTarget) {
            showToast("&#127919; Target down. New assignment incoming.");
        }
        aliveFlag = me.alive; myTarget = me.targetId;
        myAssassinId = me.assassinId; myAssassinTrigger = me.assassinTriggerId;
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
        if (diff < 60000) el.classList.add("urgent"); else el.classList.remove("urgent");
    }
    if (diff <= 0 && currentGameStatus === "active") endGameByTimer();
}

async function endGameByTimer() {
    if (gameOverHandled) return;
    currentGameStatus = "ended"; gameOverHandled = true;
    try {
        var roomSnap = await FB.getDoc(roomRef);
        if (roomSnap.exists() && roomSnap.data().status !== "ended") {
            var aq = await FB.getDocs(FB.query(FB.collection(roomRef, "players"), FB.where("alive", "==", true)));
            var winners = [];
            aq.forEach(function(d) { winners.push(d.id); });
            await FB.updateDoc(roomRef, { status: "ended", winnerIds: winners });
        }
    } catch(e) { debugLog("endGameByTimer err: " + e.message); }
}

// ============================================================
// SENSOR MANAGER
// ============================================================
function startSensors() {
    if (sensorManager) sensorManager.destroy();
    sensorManager = new SensorManager();
    sensorManager.init();
}

class SensorManager {
    constructor() {
        this.active = false;
        this.paused = false;
        this.guessScreenOpen = false;
        this.lastOrientation = null;
        this.orientationDebounce = null;
        this.tapTimes = [];
        this.longPressTimer = null;
        this.touchMoved = false;
        this.longPressTouchStart = null;
        this.visibilityTimer = null;
        this.visibilityArmed = false;
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
        if (screen.orientation) {
            screen.orientation.addEventListener("change", this._onOrientationChange);
        } else {
            window.addEventListener("orientationchange", this._onOrientationChange);
        }
        document.addEventListener("click", this._onTap);
        document.addEventListener("touchstart", this._onTouchStart, { passive: false });
        document.addEventListener("touchend", this._onTouchEnd);
        document.addEventListener("touchmove", this._onTouchMove, { passive: true });
        document.addEventListener("visibilitychange", this._onVisibilityChange);
        // Sensors activate after arming countdown (already handled by the 8s countdown UI)
        // Add a tiny extra buffer so the transition animation doesn't trigger anything
        var self = this;
        setTimeout(function() {
            self.active = true;
            debugLog("Sensors live");
            setTimeout(function() { self.visibilityArmed = true; debugLog("Visibility armed"); }, 7000);
        }, 500);
    }

    // Brief pause — used when opening drawers/panels
    pause(ms) {
        var self = this;
        this.paused = true;
        setTimeout(function() { self.paused = false; }, ms || 500);
    }

    _currentOrientation() {
        if (screen.orientation) return screen.orientation.type.indexOf("portrait") !== -1 ? "portrait" : "landscape";
        return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    }

    _gate() { return this.active && !this.paused && aliveFlag && !isDeadLocally && !this.guessScreenOpen; }

    // ——— ROTATE DEVICE ———
    _onOrientationChange() {
        if (!this._gate() || myAssassinTrigger !== "ROTATE_DEVICE") return;
        var self = this;
        if (this.orientationDebounce) clearTimeout(this.orientationDebounce);
        this.orientationDebounce = setTimeout(function() {
            var newOri = self._currentOrientation();
            if (newOri !== self.lastOrientation) {
                debugLog("Rotate: " + self.lastOrientation + "->" + newOri);
                self.lastOrientation = newOri;
                self._triggerFired("ROTATE_DEVICE");
            }
        }, 500);
    }

    // ——— TRIPLE TAP ———
    _onTap(e) {
        if (!this._gate() || myAssassinTrigger !== "TRIPLE_TAP") return;
        var tag = e.target.tagName.toLowerCase();
        if (tag === "button" || tag === "input" || tag === "a" || tag === "select") return;
        var now = Date.now();
        this.tapTimes.push(now);
        this.tapTimes = this.tapTimes.filter(function(t) { return now - t < 600; });
        if (this.tapTimes.length >= 3) { this.tapTimes = []; debugLog("Triple tap"); this._triggerFired("TRIPLE_TAP"); }
    }

    // ——— LONG PRESS + PINCH ZOOM ———
    _onTouchStart(e) {
        if (!this._gate()) return;

        if (myAssassinTrigger === "PINCH_ZOOM" && e.touches.length >= 2) {
            e.preventDefault();
            if (this.pinchTimer) clearTimeout(this.pinchTimer);
            var self = this;
            this.pinchTimer = setTimeout(function() {
                if (!self._gate()) return;
                debugLog("Pinch zoom");
                self._triggerFired("PINCH_ZOOM");
            }, 300);
            return;
        }

        if (myAssassinTrigger !== "LONG_PRESS" || e.touches.length !== 1) return;
        e.preventDefault();
        this.touchMoved = false;
        this.longPressTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (this.longPressTimer) clearTimeout(this.longPressTimer);
        var self = this;
        this.longPressTimer = setTimeout(function() {
            if (!self.touchMoved && self._gate()) { debugLog("Long press"); self._triggerFired("LONG_PRESS"); }
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

    // ——— SWITCH TABS ———
    _onVisibilityChange() {
        if (!this._gate() || myAssassinTrigger !== "SWITCH_TABS" || !this.visibilityArmed) return;
        var self = this;
        if (document.hidden) {
            this.visibilityTimer = setTimeout(function() {
                if (document.hidden && self._gate()) { debugLog("Switch tabs"); self._triggerFired("SWITCH_TABS"); }
            }, 1500);
        } else {
            if (this.visibilityTimer) { clearTimeout(this.visibilityTimer); this.visibilityTimer = null; }
        }
    }

    _triggerFired(id) {
        if (!this._gate()) return;
        var cd = localTriggerCooldown.get(id);
        if (cd && cd > Date.now()) { debugLog("Cooldown: " + id); return; }
        localTriggerCooldown.set(id, Date.now() + 12000);
        this.guessScreenOpen = true;
        this.active = false;
        debugLog("Trigger fired: " + id);
        this._showGuessScreen();
    }

    _showGuessScreen() {
        var self = this;
        FB.getDocs(FB.query(FB.collection(roomRef, "players"), FB.where("alive", "==", true)))
            .then(function(snap) {
                var suspects = [];
                snap.forEach(function(d) {
                    // Exclude self and (in games with 4+ players) exclude own target
                    var isOwnTarget = d.id === myTarget && snap.size > 3;
                    if (d.id !== currentUser.uid && !isOwnTarget) {
                        suspects.push({ id: d.id, name: d.data().name });
                    }
                });
                // In 3-player games include the target in the list
                if (suspects.length === 0) {
                    snap.forEach(function(d) {
                        if (d.id !== currentUser.uid) suspects.push({ id: d.id, name: d.data().name });
                    });
                }

                var existing = document.getElementById("guessOverlay");
                if (existing) existing.remove();

                var overlay = document.createElement("div");
                overlay.id = "guessOverlay";
                overlay.style.cssText = "position:fixed;inset:0;background:var(--black);z-index:1000;overflow-y:auto;padding:1.5rem;display:flex;flex-direction:column;max-width:480px;margin:0 auto;";

                var suspectsHTML = suspects.map(function(s) {
                    return '<button class="suspect-btn" data-id="' + s.id + '" data-name="' + s.name + '">' +
                        '<span>' + s.name + '</span><span class="suspect-arrow">&rarr;</span></button>';
                }).join("");

                overlay.innerHTML =
                    '<div class="guess-timer-bar"><div class="guess-timer-fill" id="guessTimerFill"></div></div>' +
                    '<div class="guess-header">' +
                    '<span class="guess-eye">&#128065;</span>' +
                    '<h2 style="margin-bottom:0.5rem;">SOMEONE MADE THEIR MOVE</h2>' +
                    '</div>' +
                    '<p class="guess-context">A move was detected on your phone. <strong>Name them correctly and they\'re out. Get it wrong — you are.</strong></p>' +
                    '<h3 style="text-align:center;margin:1rem 0 0.5rem;">WHO IS YOUR ASSASSIN?</h3>' +
                    '<div class="guess-suspects">' + suspectsHTML + '</div>' +
                    '<button class="btn btn-secondary" id="guessTakeHitBtn">Take the hit — I have no idea</button>';

                document.body.appendChild(overlay);

                // 45-second timer — starts on first touch
                var timerTotal = 45000;
                var timerStart = null;
                var timerIv = null;
                var timerFired = false;

                function startGuessTimer() {
                    if (timerStart) return;
                    timerStart = Date.now();
                    timerIv = setInterval(function() {
                        var elapsed = Date.now() - timerStart;
                        var pct = Math.max(0, 100 - (elapsed / timerTotal) * 100);
                        var fill = document.getElementById("guessTimerFill");
                        if (fill) fill.style.width = pct + "%";
                        if (elapsed >= timerTotal && !timerFired) {
                            timerFired = true;
                            clearInterval(timerIv);
                            overlay.remove();
                            self._resolveGuess(null, null); // Auto take the hit
                        }
                    }, 500);
                }

                overlay.addEventListener("touchstart", function() { startGuessTimer(); }, { once: true });
                overlay.addEventListener("click", function() { startGuessTimer(); }, { once: true });
                // Start timer after 2s regardless (handles case where player doesn't touch)
                setTimeout(startGuessTimer, 2000);

                overlay.querySelectorAll(".suspect-btn").forEach(function(btn) {
                    btn.addEventListener("click", function() {
                        if (timerIv) clearInterval(timerIv);
                        var gid = btn.dataset.id, gname = btn.dataset.name;
                        overlay.remove();
                        self._resolveGuess(gid, gname);
                    });
                });

                var thb = document.getElementById("guessTakeHitBtn");
                if (thb) thb.addEventListener("click", function() {
                    if (timerIv) clearInterval(timerIv);
                    overlay.remove();
                    self._resolveGuess(null, null);
                });
            })
            .catch(function(e) {
                debugLog("showGuessScreen err: " + e.message);
                self.guessScreenOpen = false;
                self.active = aliveFlag && !isDeadLocally;
            });
    }

    async _resolveGuess(guessedId, guessedName) {
        var correct = myAssassinId;
        var guessedRight = guessedId !== null && guessedId === correct;
        if (guessedId === null) {
            await this._runElimination(currentUser.uid, true, null);
            showGuessResult(false, null);
        } else if (guessedRight) {
            await this._runElimination(correct, false, currentUser.uid);
            showGuessResult(true, guessedName);
        } else {
            await this._runElimination(currentUser.uid, true, null);
            showGuessResult(false, guessedName);
        }
        this.guessScreenOpen = false;
        var self = this;
        setTimeout(function() { if (aliveFlag && !isDeadLocally) self.active = true; }, 1500);
    }

    async _runElimination(victimId, isSelf, killerId) {
        try {
            await FB.runTransaction(db, async function(transaction) {
                var victimRef = FB.doc(FB.collection(roomRef, "players"), victimId);
                var victimSnap = await transaction.get(victimRef);
                var roomSnap = await transaction.get(roomRef);
                if (!victimSnap.exists() || victimSnap.data().alive === false) return;
                if (roomSnap.data().status !== "active") return;
                var vd = victimSnap.data();
                var newCount = Math.max(0, (roomSnap.data().aliveCount || 1) - 1);
                transaction.update(victimRef, { alive: false });
                if (vd.assassinId && vd.targetId && vd.assassinId !== victimId) {
                    transaction.update(FB.doc(FB.collection(roomRef, "players"), vd.assassinId), { targetId: vd.targetId });
                }
                if (vd.targetId && vd.assassinId && vd.targetId !== victimId) {
                    transaction.update(FB.doc(FB.collection(roomRef, "players"), vd.targetId), { assassinId: vd.assassinId });
                }

                // Kill feed entry
                var killer = killerId || vd.assassinId;
                var killerSnap = killer ? await transaction.get(FB.doc(FB.collection(roomRef, "players"), killer)) : null;
                var killerName = (killerSnap && killerSnap.exists()) ? killerSnap.data().name : "unknown";
                var triggerDef = TRIGGERS[vd.assassinTriggerId] || {};
                var feedEntry = {
                    killerName: killerName, victimName: vd.name,
                    trigger: triggerDef.action || "unknown method",
                    ts: Date.now(), selfElim: isSelf && !killerId
                };

                transaction.update(roomRef, {
                    aliveCount: newCount,
                    lastUpdated: FB.serverTimestamp(),
                    killFeed: FB.arrayUnion(feedEntry)
                });

                if (newCount <= 1) {
                    var winnerId = vd.assassinId;
                    transaction.update(roomRef, { status: "ended", winnerIds: winnerId ? [winnerId] : [] });
                }
            });
        } catch(e) { debugLog("runElimination err: " + e.message); }
        if (isSelf) { isDeadLocally = true; aliveFlag = false; this.destroy(); }
    }

    destroy() {
        this.active = false; this.guessScreenOpen = false;
        if (screen.orientation) { screen.orientation.removeEventListener("change", this._onOrientationChange); }
        else { window.removeEventListener("orientationchange", this._onOrientationChange); }
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
// GUESS RESULT
// ============================================================
function showGuessResult(survived, guessedName) {
    var ex = document.getElementById("resultOverlay");
    if (ex) ex.remove();
    var overlay = document.createElement("div");
    overlay.id = "resultOverlay";
    overlay.style.cssText = "position:fixed;inset:0;background:var(--black);z-index:1001;display:flex;align-items:center;justify-content:center;padding:2rem;";
    if (survived) {
        overlay.innerHTML =
            '<div class="result-screen fade-up">' +
            '<span class="result-icon">&#9989;</span>' +
            '<div class="result-title success">NICE CATCH</div>' +
            '<p class="result-sub">You made them.<br><strong style="color:var(--gold);">' + guessedName + '</strong> has been neutralised.</p>' +
            '<button class="btn btn-gold" id="resultContinue">BACK TO THE HUNT</button>' +
            '</div>';
    } else {
        overlay.innerHTML =
            '<div class="result-screen fade-up">' +
            '<span class="result-icon">&#9760;</span>' +
            '<div class="result-title danger">WRONG CALL</div>' +
            '<p class="result-sub">' +
            (guessedName ? '<strong style="color:var(--red);">' + guessedName + '</strong> wasn\'t your assassin.<br>' : "") +
            'The shadows don\'t forgive mistakes.</p>' +
            (myTrigger && TRIGGERS[myTrigger] ? '<p style="font-family:var(--font-mono);font-size:0.7rem;letter-spacing:0.1em;color:var(--text-dim);margin-top:0.8rem;">Your weakness was: ' + TRIGGERS[myTrigger].action + '</p>' : "") +
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
async function handleGameOver(winnerIds, killFeed) {
    if (timerInterval) clearInterval(timerInterval);
    if (sensorManager) sensorManager.destroy();
    if (unsubRoom) { unsubRoom(); unsubRoom = null; }
    if (unsubMe) { unsubMe(); unsubMe = null; }
    if (unsubSpectator) { unsubSpectator(); unsubSpectator = null; }
    currentGameStatus = "ended";

    var winnerNames = [];
    try {
        var ps = await FB.getDocs(FB.collection(roomRef, "players"));
        ps.forEach(function(d) {
            if (winnerIds && winnerIds.indexOf(d.id) !== -1) winnerNames.push(d.data().name);
        });
    } catch(e) { debugLog("handleGameOver fetch err: " + e.message); }

    var isWinner = winnerIds && winnerIds.indexOf(currentUser.uid) !== -1;

    var winnerBlock = "";
    if (winnerNames.length === 1) {
        winnerBlock =
            '<span class="winner-name">' + winnerNames[0] + '</span>' +
            '<p class="flavor-text" style="text-align:center;margin-bottom:1.5rem;">Every agent in the city had their name.<br>None of them were good enough.</p>';
    } else if (winnerNames.length > 1) {
        winnerBlock =
            '<h3 style="text-align:center;margin-bottom:0.6rem;">SURVIVORS</h3>' +
            '<div class="survivors-list">' +
            winnerNames.map(function(n) { return '<div class="survivor-item">' + n + '</div>'; }).join("") +
            '</div>' +
            '<p class="flavor-text" style="text-align:center;margin-bottom:1.5rem;">Time ran out. The contracts remain open.</p>';
    } else {
        winnerBlock = '<p class="flavor-text" style="text-align:center;margin-bottom:1.5rem;">No survivors. The city swallowed everyone.</p>';
    }

    // Kill feed
    var killFeedBlock = "";
    if (killFeed && killFeed.length > 0) {
        // Sort chronologically
        var sorted = killFeed.slice().sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });
        killFeedBlock =
            '<div class="kill-feed">' +
            '<div class="kill-feed-title">HOW IT WENT DOWN</div>' +
            sorted.map(function(k) {
                return '<div class="kill-entry">' +
                    '<span class="kill-killer">' + (k.killerName || "?") + '</span>' +
                    '<span class="kill-verb"> got </span>' +
                    '<span class="kill-victim">' + (k.victimName || "?") + '</span>' +
                    '<span class="kill-method">via ' + (k.trigger || "unknown") + '</span>' +
                    '</div>';
            }).join("") +
            '</div>';
    }

    // Play again logic
    var playAgainBlock = "";
    if (isHost) {
        playAgainBlock = '<button class="btn btn-primary" id="playAgainBtn">&#128260; PLAY AGAIN</button>';
    } else {
        playAgainBlock =
            '<button class="btn btn-primary" id="playAgainBtn" disabled>&#128260; PLAY AGAIN</button>' +
            '<p class="play-again-waiting" id="playAgainWaiting">Waiting for host to restart...</p>';
    }

    render(
        '<div class="screen fade-up" style="text-align:center;">' +
        '<div style="padding-top:3rem;">' +
        '<span class="result-icon" style="font-size:4rem;display:block;margin-bottom:1rem;">' + (isWinner ? "&#127942;" : "&#9760;") + '</span>' +
        '<div class="result-title ' + (isWinner ? "success" : "") + '" style="margin-bottom:0.4rem;">' +
        (winnerIds && winnerIds.length === 1 ? "THE LAST SHADOW" : "TIME\'S UP") +
        '</div>' +
        winnerBlock +
        killFeedBlock +
        '</div>' +
        '<div class="spacer"></div>' +
        playAgainBlock +
        '<button class="btn btn-secondary" id="exitMenuBtn" style="margin-top:0.5rem;">EXIT TO MENU</button>' +
        '</div>'
    );

    // Play again — host resets the room back to lobby
    var pab = document.getElementById("playAgainBtn");
    if (pab) {
        pab.addEventListener("click", async function() {
            if (!isHost) return;
            pab.disabled = true; pab.textContent = "RESETTING...";
            try {
                // Reset room to lobby
                await FB.updateDoc(roomRef, {
                    status: "lobby", winnerIds: [], killFeed: [], aliveCount: 0
                });
                // Reset all player docs
                var snap = await FB.getDocs(FB.collection(roomRef, "players"));
                var batch = FB.writeBatch(db);
                snap.forEach(function(d) {
                    batch.update(d.ref, {
                        alive: true, sensorReady: false, targetId: null,
                        assassinId: null, assassinTriggerId: null, connected: true
                    });
                });
                await batch.commit();
                // Reset local state and go to lobby
                currentGameStatus = "lobby";
                gameOverHandled = false;
                aliveFlag = true; isDeadLocally = false;
                myTarget = null; myAssassinId = null; myAssassinTrigger = null;
                myTargetsTrigger = null; myTrigger = null;
                localTriggerCooldown = new Map();
                document.body.classList.remove("is-dead");
                if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
                endTimestamp = null;
                goToLobby();
            } catch(e) {
                debugLog("playAgain err: " + e.message);
                showToast("Failed to reset. Try again.");
                pab.disabled = false; pab.textContent = "PLAY AGAIN";
            }
        });
    }

    // Non-host: watch for room to go back to lobby
    if (!isHost) {
        var unsubRestart = FB.onSnapshot(roomRef, function(snap) {
            var d = snap.data();
            if (d && d.status === "lobby") {
                unsubRestart();
                currentGameStatus = "lobby";
                gameOverHandled = false;
                aliveFlag = true; isDeadLocally = false;
                myTarget = null; myAssassinId = null; myAssassinTrigger = null;
                myTargetsTrigger = null; myTrigger = null;
                localTriggerCooldown = new Map();
                document.body.classList.remove("is-dead");
                if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
                endTimestamp = null;
                goToLobby();
            }
        });
    }

    document.getElementById("exitMenuBtn").addEventListener("click", function() {
        localStorage.removeItem("shadowmark_room");
        currentGameStatus = "lobby";
        document.body.classList.remove("is-dead");
        showHome();
    });
}

// ============================================================
// LEAVE ROOM
// ============================================================
async function leaveRoom() {
    if (playerRef) { try { await FB.updateDoc(playerRef, { connected: false }); } catch(e) {} }
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
    debugLog("Booting...");
    var app = FB.initializeApp(firebaseConfig);
    auth = FB.getAuth(app);
    db = FB.getFirestore(app);

    // Handle ?join= URL parameter
    var urlParams = new URLSearchParams(window.location.search);
    var joinParam = urlParams.get("join");
    if (joinParam) {
        sessionStorage.setItem("shadowmark_pending_join", joinParam.toUpperCase());
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    FB.onAuthStateChanged(auth, function(user) {
        if (!user) {
            FB.signInAnonymously(auth).catch(function(e) {
                render(
                    '<div class="screen" style="text-align:center;justify-content:center;">' +
                    '<h2>FIREBASE ERROR</h2><p class="flavor-text">' + e.message + '</p>' +
                    '<p style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-dim);">Enable Anonymous Auth in your Firebase console.</p>' +
                    '<button class="btn btn-secondary" onclick="location.reload()">RETRY</button>' +
                    '</div>'
                );
            });
            return;
        }

        currentUser = user;
        debugLog("Auth: " + user.uid);

        var savedName = localStorage.getItem("shadowmark_name");
        var savedRoom = localStorage.getItem("shadowmark_room");
        var pendingJoin = sessionStorage.getItem("shadowmark_pending_join");

        if (savedName) {
            currentPlayerName = savedName;
            if (pendingJoin) {
                sessionStorage.removeItem("shadowmark_pending_join");
                joinRoom(pendingJoin);
            } else if (savedRoom) {
                roomCode = savedRoom;
                roomRef = FB.doc(db, "rooms", savedRoom);
                FB.getDoc(roomRef).then(function(snap) {
                    if (!snap.exists() || snap.data().status === "ended") {
                        localStorage.removeItem("shadowmark_room");
                        showHome();
                    } else if (snap.data().status === "active") {
                        playerRef = FB.doc(FB.collection(roomRef, "players"), currentUser.uid);
                        isHost = snap.data().hostId === currentUser.uid;
                        enterActiveGame();
                    } else {
                        playerRef = FB.doc(FB.collection(roomRef, "players"), currentUser.uid);
                        isHost = snap.data().hostId === currentUser.uid;
                        goToLobby();
                    }
                }).catch(function() { showHome(); });
            } else {
                showHome();
            }
        } else {
            if (shouldShowIntro()) showIntro();
            else showNameInput();
        }
    });
}

function waitForFirebase() {
    if (window._firebase) { FB = window._firebase; boot(); }
    else setTimeout(waitForFirebase, 50);
}
waitForFirebase();












