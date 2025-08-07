const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});

const USERS_FILE = path.join(__dirname, "users.json");
const CHARACTERS_FILE = path.join(__dirname, "characters.json");

let characters = JSON.parse(fs.readFileSync(CHARACTERS_FILE, "utf-8"));
let users = fs.existsSync(USERS_FILE)
  ? JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"))
  : [];

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (user) {
    return res.json({ success: true, character: user.character });
  } else {
    return res.json({ success: false, message: "Credenziali errate." });
  }
});

app.post("/register", (req, res) => {
  const { username, password, character } = req.body;
  if (users.find(u => u.username === username)) {
    return res.json({ success: false, message: "Username già in uso." });
  }
  if (users.find(u => u.character === character)) {
    return res.json({ success: false, message: "Questo personaggio è già stato scelto." });
  }

  users.push({ username, password, character });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return res.json({ success: true });
});

let players = {};
let fights = {};

io.on("connection", (socket) => {
  console.log("🟢 Connessione socket:", socket.id);

  socket.on("join", ({ username, character }) => {
    const user = users.find(u => u.username === username);
    if (!user) return;

    // Rimuove eventuali sessioni attive precedenti dello stesso utente
    for (const [id, player] of Object.entries(players)) {
      if (player.name === username) {
        delete players[id];
        console.log(`⚠️ Sessione precedente di ${username} rimossa`);
      }
    }

    const characterData = characters[character];
    players[socket.id] = {
      id: socket.id,
      name: username,
      character,
      room: "Hall",
      hp: 100,
      points: 0,
      wins: 0,
      characterData,
      normalHits: 0,
      status: {}
    };

    io.emit("playersUpdate", players);
  });

  socket.on("move", (room) => {
    if (players[socket.id]) {
      players[socket.id].room = room;
      io.emit("playersUpdate", players);
    }
  });

  socket.on("sendChallenge", (targetName) => {
    const challenger = players[socket.id];
    const targetEntry = Object.entries(players).find(([_, p]) => p.name === targetName);
    if (!challenger || !targetEntry) return;
    const [targetId, target] = targetEntry;

    if (challenger.room !== "Arena" || target.room !== "Arena") return;
    io.to(targetId).emit("challengeRequest", { from: challenger.name });
  });

  socket.on("respondChallenge", ({ from, accepted }) => {
    const target = players[socket.id];
    const challengerEntry = Object.entries(players).find(([_, p]) => p.name === from);
    if (!challengerEntry) return;
    const [challengerId, challenger] = challengerEntry;

    if (!accepted) {
      io.to(challengerId).emit("fightEnd", `${target.name} ha rifiutato la sfida.`);
      return;
    }

    const fightId = `${challengerId}_${socket.id}`;
    fights[fightId] = {
      players: [challengerId, socket.id],
      turn: 0
    };

    [challengerId, socket.id].forEach((id, i) => {
      const opponent = players[fights[fightId].players[1 - i]];
      const self = players[id];
      const allAttacks = [
        ...self.characterData.attacks.normal.map(a => a.name),
        ...self.characterData.attacks.special.map(a => a.name)
      ];
      io.to(id).emit("startFight", {
        opponent: opponent.name,
        attacks: allAttacks
      });
    });

    const first = fights[fightId].players[0];
    io.to(first).emit("yourTurn");
  });

  socket.on("fightAction", ({ index, actionType }) => {
    const fightEntry = Object.entries(fights).find(([_, f]) => f.players.includes(socket.id));
    if (!fightEntry) return;
    const [fightId, fight] = fightEntry;
    const attackerId = socket.id;
    const defenderId = fight.players.find(id => id !== attackerId);

    if (fight.players[fight.turn] !== attackerId) return;

    const attacker = players[attackerId];
    const defender = players[defenderId];
    if (!attacker || !defender) return;

    const isSpecial = actionType === "special";
    if (isSpecial && attacker.normalHits < 2) {
      io.to(attackerId).emit("fightUpdate", "❌ Attacco speciale non disponibile!");
      return;
    }

    const attackData = isSpecial
      ? attacker.characterData.attacks.special[index - 3]
      : attacker.characterData.attacks.normal[index];

    let log = `${attacker.name} usa ${attackData.name}!`;
    let hit = true;

    // Effetti difensivi
    if (defender.character === "Loki" && Math.random() < 0.1) {
      hit = false;
      log += ` Ma ${defender.name} schiva con un'illusione!`;
    }

    if (defender.status.evadeNext) {
      hit = false;
      log += ` Ma ${defender.name} evita l'attacco!`;
      delete defender.status.evadeNext;
    }

    if (hit && attackData.damage > 0) {
      let damage = attackData.damage;

      // Modifica danno per passivi
      if (attacker.character === "Thor" && attacker.hp < 50) damage *= 1.1;
      if (attacker.character === "Tyr") damage += 5;
      if (attacker.character === "Fenrir") damage *= 1 + attacker.points * 0.05;
      if (attacker.character === "Sif" && Math.random() < 0.15) damage *= 2;

      if (defender.character === "Frigg") damage *= 0.9;
      if (defender.status.reduce50) damage *= 0.5;

      defender.hp -= Math.floor(damage);
      log += ` Colpito per ${Math.floor(damage)} HP!`;

      if (!isSpecial) attacker.normalHits++;

      // Effetti speciali attivi
      if (attacker.character === "Freya" && attackData.effect?.includes("Cura")) {
        let heal = attackData.effect.includes("30") ? 30 : 10;
        attacker.hp = Math.min(100, attacker.hp + heal);
        log += ` (${attacker.name} cura ${heal} HP)`;
      }

      if (attackData.effect?.includes("Evita")) {
        defender.status.evadeNext = true;
      }

      if (attackData.effect?.includes("50%")) {
        if (Math.random() < 0.5) {
          defender.status.confused = true;
          log += ` (${defender.name} è confuso!)`;
        }
      }

      if (attackData.effect?.includes("Stordisce")) {
        defender.status.stunned = true;
        log += ` (${defender.name} è stordito!)`;
      }

      if (attackData.effect?.includes("Riduce")) {
        defender.status.reduce50 = true;
      }

      if (attacker.character === "Hel" && isSpecial) {
        defender.hp -= 5;
        log += ` (${defender.name} viene avvelenato!)`;
      }
    }

    if (!hit && !isSpecial) attacker.normalHits++;

    if (defender.hp <= 0) {
      log += `\n💀 ${defender.name} è stato sconfitto!`;
      attacker.points += 10;
      attacker.wins++;
      defender.hp = 100;
      defender.room = "Hall";
      delete fights[fightId];
    } else {
      fight.turn = fight.players.indexOf(defenderId);
      if (defender.status.stunned) {
        delete defender.status.stunned;
        log += `\n${defender.name} è stordito e salta il turno!`;
        fight.turn = fight.players.indexOf(attackerId); // Salta turno
      } else {
        io.to(defenderId).emit("yourTurn");
      }
    }

    io.to(attackerId).emit("fightUpdate", log);
    io.to(defenderId).emit("fightUpdate", log);
    io.emit("playersUpdate", players);
  });

  socket.on("disconnect", () => {
    const disconnectedPlayer = players[socket.id];
    if (disconnectedPlayer) {
      const username = disconnectedPlayer.name;
      delete players[socket.id];

      for (const [fightId, fight] of Object.entries(fights)) {
        if (fight.players.includes(socket.id)) {
          const otherId = fight.players.find(id => id !== socket.id);
          io.to(otherId).emit("fightEnd", `${username} si è disconnesso.`);
          delete fights[fightId];
        }
      }

      io.emit("playersUpdate", players);
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server attivo su http://localhost:${PORT}`);
});
