const socket = io();
let currentOpponent = null;
let myCharacter = null;
let successfulHits = 0;

// Caricamento iniziale
window.onload = () => {
    const username = sessionStorage.getItem("username");
    const character = sessionStorage.getItem("character");

    // 🔒 Se non loggato, reindirizza al login
    if (!username || !character) {
        sessionStorage.clear();
        window.location.href = "login.html";
        return;
    }

    myCharacter = character;
    socket.emit("join", { username, character });
};

socket.on("playersUpdate", (players) => {
    const me = Object.values(players).find(p => p.name === sessionStorage.getItem("username"));
    if (!me) return;

    document.getElementById("playerInfo").innerText =
        `${me.name} (${me.character}) - Stanza: ${me.room} - HP: ${me.hp} - Punti: ${me.points}`;

    const list = document.getElementById("players");
    list.innerHTML = "";
    Object.values(players).forEach(p => {
        const li = document.createElement("li");
        li.innerText = `${p.name} | ${p.room} | HP: ${p.hp} | Wins: ${p.wins}`;
        list.appendChild(li);
    });
});

function move() {
    const room = document.getElementById("roomSelect").value;
    socket.emit("move", room);
    document.getElementById("currentRoom").innerText = `Ti trovi in: ${room}`;
    playSound("move");
}

function challengePlayer() {
    const target = document.getElementById("challengeTarget").value.trim();
    if (!target) return;
    socket.emit("sendChallenge", target);
}

socket.on("challengeRequest", ({ from }) => {
    if (confirm(`${from} ti ha sfidato! Vuoi accettare?`)) {
        socket.emit("respondChallenge", { from, accepted: true });
    } else {
        socket.emit("respondChallenge", { from, accepted: false });
    }
});

socket.on("startFight", ({ opponent, attacks }) => {
    currentOpponent = opponent;
    successfulHits = 0;
    document.getElementById("fightInterface").style.display = "block";

    ["attack1", "attack2", "attack3", "special1", "special2"].forEach((id, index) => {
        const button = document.getElementById(id);
        if (attacks[index]) {
            button.innerText = attacks[index]; // correzione: attacchi come stringhe
            button.disabled = true;
            button.dataset.attackIndex = index;
        }
    });

    document.getElementById("fightLog").innerText = `Stai combattendo contro ${opponent}. Attendi il tuo turno...`;
});

socket.on("yourTurn", () => {
    document.getElementById("fightLog").innerText = "È il tuo turno! Scegli un attacco:";
    document.querySelectorAll(".attack-button").forEach(button => {
        const idx = parseInt(button.dataset.attackIndex);
        if (button.id.startsWith("special") && successfulHits < 2) {
            button.disabled = true;
        } else {
            button.disabled = false;
        }
    });
});

socket.on("fightUpdate", (text) => {
    document.getElementById("fightLog").innerText = text;
    addVisualEffect("fightFlash");
    playSound("hit");
});

socket.on("fightEnd", (result) => {
    document.getElementById("fightLog").innerText = result;
    document.getElementById("fightInterface").style.display = "none";
    currentOpponent = null;
    successfulHits = 0;
});

function sendAttack(index) {
    const isSpecial = index >= 3;
    if (isSpecial && successfulHits < 2) {
        alert("Gli attacchi speciali si sbloccano dopo 2 colpi normali riusciti!");
        return;
    }

    if (!isSpecial) successfulHits++;

    socket.emit("fightAction", {
        index: parseInt(index),
        actionType: isSpecial ? "special" : "normal"
    });

    document.querySelectorAll(".attack-button").forEach(btn => btn.disabled = true);
}

function addVisualEffect(effectType) {
    const elem = document.createElement("div");
    elem.className = effectType;
    document.body.appendChild(elem);
    setTimeout(() => document.body.removeChild(elem), 800);
}

function playSound(name) {
    const audio = new Audio(`sounds/${name}.mp3`);
    audio.play().catch(() => {}); // ignora errori su autoplay
}
