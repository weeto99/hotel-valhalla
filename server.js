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
  console.log("🟢 Nuovo client:", socket.id);

  socket.on("join", ({ username, character }) => {
    const user = users.find(u => u.username === username);
    if (!user) return;

    const characterData = characters[character];
    players[socket.id] = {
      id: socket.id,
      name: username,
      character,
      room: "Hall",
      hp: 100,
      points: 0,
      wins: 0,
      specialsReady: 0,
      characterData,
      normalHits: 0
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
      io.to(id).emit("startFight", {
        opponent: opponent.name,
        attacks: [
          ...self.characterData.attacks,
          ...self.characterData.specials
        ]
      });
    });

    const first = fights[fightId].players[0];
    io.to(first).emit("yourTurn");
  });

  socket.on("fightAction", ({ index }) => {
    const fightEntry = Object.entries(fights).find(([_, f]) => f.players.includes(socket.id));
    if (!fightEntry) return;
    const [fightId, fight] = fightEntry;
    const attackerId = socket.id;
    const defenderId = fight.players.find(id => id !== attackerId);

    if (fight.players[fight.turn] !== attackerId) return;

    const attacker = players[attackerId];
    const defender = players[defenderId];
    if (!attacker || !defender) return;

    const isSpecial = index >= 3;
    if (isSpecial && attacker.normalHits < 2) {
      io.to(attackerId).emit("fightUpdate", "Attacco speciale non ancora sbloccato!");
      return;
    }

    const allAttacks = [...attacker.characterData.attacks, ...attacker.characterData.specials];
    const attackName = allAttacks[index];
    const hit = Math.random() < 0.75;
    let log = `${attacker.name} usa ${attackName}`;

    if (hit) {
      let damage = 20;
      attacker.normalHits = isSpecial ? 0 : attacker.normalHits + 1;

      // Bonus passivi
      if (attacker.character === "Thor" && attacker.hp < 50) damage *= 1.1;
      if (attacker.character === "Tyr") damage += 5;
      if (attacker.character === "Fenrir") damage *= 1 + attacker.points * 0.05;
      if (attacker.character === "Sif" && Math.random() < 0.15) damage *= 2;

      defender.hp -= Math.floor(damage);
      log += ` e colpisce ${defender.name} per ${Math.floor(damage)} danni!`;

      if (attacker.character === "Hel" && isSpecial) {
        defender.hp -= 5;
        log += ` (avvelenamento!)`;
      }
    } else {
      log += " ma manca!";
    }

    if (defender.hp <= 0) {
      log += `\n💀 ${defender.name} è stato sconfitto!`;
      attacker.points += 10;
      attacker.wins += 1;
      defender.hp = 100;
      defender.room = "Hall";
      delete fights[fightId];
    } else {
      fight.turn = fight.players.indexOf(defenderId);
      io.to(defenderId).emit("yourTurn");
    }

    io.to(attackerId).emit("fightUpdate", log);
    io.to(defenderId).emit("fightUpdate", log);
    io.emit("playersUpdate", players);
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("playersUpdate", players);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server attivo su http://localhost:${PORT}`);
});
