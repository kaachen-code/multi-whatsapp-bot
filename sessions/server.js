import express from "express";
import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode";
import fs from "fs-extra";

const app = express();
const port = process.env.PORT || 3000;

let bots = {};
let qrCodes = {};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🏠 Halaman utama: daftar semua bot
app.get("/", async (req, res) => {
  const botList = Object.entries(bots).map(([id, bot]) => {
    let status = bot.isConnected ? "✅ Connected" : "⌛ Waiting QR";
    return `<div style="border:1px solid #ccc; padding:10px; border-radius:10px; margin:10px;">
      <h3>${id}</h3>
      <p>Status: ${status}</p>
      ${!bot.isConnected && qrCodes[id] ? `<img src="${qrCodes[id]}" width="200"/>` : ""}
    </div>`;
  });

  const html = `
  <html>
  <head>
    <title>Multi WhatsApp Bot</title>
    <style>
      body { font-family: sans-serif; max-width: 600px; margin:auto; padding:20px; }
      button { background:#007bff; color:white; border:none; padding:10px 15px; border-radius:6px; cursor:pointer; }
      button:hover { background:#0056b3; }
    </style>
  </head>
  <body>
    <h1>🤖 Multi WhatsApp Bot</h1>
    <p>Total sesi aktif: ${Object.keys(bots).length}</p>
    <form action="/new" method="post">
      <button type="submit">➕ Tambah Bot Baru</button>
    </form>
    <hr/>
    ${botList.join("") || "<p>Belum ada bot yang aktif.</p>"}
  </body>
  </html>`;
  res.send(html);
});

// 🔹 Tambah bot baru
app.post("/new", async (req, res) => {
  const id = `bot_${Date.now()}`;
  await startBot(id);
  res.redirect("/");
});

// 🔹 Fungsi utama membuat bot
async function startBot(id) {
  const sessionPath = `./sessions/${id}`;
  await fs.ensureDir(sessionPath);

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const sock = makeWASocket({
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
  });

  bots[id] = sock;
  bots[id].isConnected = false;

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr } = update;
    if (qr) {
      const qrImg = await qrcode.toDataURL(qr);
      qrCodes[id] = qrImg;
      console.log(`📱 QR baru untuk ${id}`);
    }
    if (connection === "open") {
      bots[id].isConnected = true;
      delete qrCodes[id];
      console.log(`✅ ${id} terhubung!`);
    } else if (connection === "close") {
      bots[id].isConnected = false;
      console.log(`❌ ${id} terputus, mencoba ulang...`);
      startBot(id);
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const text = msg.message.conversation || "";
    const from = msg.key.remoteJid;

    switch (text.toLowerCase()) {
      case "hai":
        await sock.sendMessage(from, { text: `Hai juga dari ${id}! 👋` });
        break;
      case "ping":
        await sock.sendMessage(from, { text: `Pong dari ${id}! 🏓` });
        break;
      default:
        await sock.sendMessage(from, { text: `Perintah tidak dikenal oleh ${id}` });
    }
  });
}

// 🔹 Load semua sesi lama saat startup
async function loadExistingSessions() {
  await fs.ensureDir("./sessions");
  const dirs = fs.readdirSync("./sessions");
  for (const dir of dirs) {
    await startBot(dir);
  }
}

loadExistingSessions();

app.listen(port, () => console.log(`🌐 Server berjalan di http://localhost:${port}`));
