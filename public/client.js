const socket = io();
let currentOpponent = null;
let myCharacter = null;

// Caricamento iniziale
window.onload = () => {
    const username = sessionStorage.getItem("username");
    const character = sessionStorage.getItem("character");

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
    if (target) {
        socket.emit("sendChallenge", target);
    }
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
    document.getElementById("fightInterface").style.display = "block";

    const attackButtons = ["attack1", "attack2", "attack3", "special1", "special2"];
    attackButtons.forEach((id, index) => {
        const btn = document.getElementById(id);
        if (attacks[index]) {
            btn.innerText = attacks[index];
            btn.disabled = true;
            btn.dataset.attackIndex = index;
        } else {
            btn.style.display = "none";
        }
    });

    document.getElementById("fightLog").innerText = `Stai combattendo contro ${opponent}. Attendi il tuo turno...`;
});

socket.on("yourTurn", () => {
    document.getElementById("fightLog").innerText = "È il tuo turno! Scegli un attacco:";
    document.querySelectorAll(".attack-button").forEach(button => {
        const idx = parseInt(button.dataset.attackIndex);
        button.disabled = false;
        if (button.id.startsWith("special")) {
            // Il server verificherà se è disponibile
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
});

function sendAttack(index) {
    const parsedIndex = parseInt(index);
    const isSpecial = parsedIndex >= 3;

    socket.emit("fightAction", {
        index: parsedIndex,
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
    audio.play().catch(() => {});
}
