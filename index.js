// index.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser } = require('@whiskeysockets/baileys');
const mongoose = require('mongoose');
const pino = require('pino');
const fs = require('fs');

// ====== CONFIG ======
const MONGO_URL = "mongodb+srv://nimora:NimoraMD2026@cluster0.pjilbw4.mongodb.net/?appName=Cluster0"; // <-- ඔයාගේ MongoDB URL දාන්න
const BOT_NAME = "ASTRON MINI";
const OWNER_NAME = "Nimsara";
const OWNER_NUMBER = "94784280074";
const HELP_NUMBER = "0784280074";
const WATERMARK = "Created By Nimsara";

// ====== MONGO SETTINGS SCHEMA ======
const SettingsSchema = new mongoose.Schema({
  jid: { type: String, unique: true },
  autoStatusView: { type: Boolean, default: true },
  autoRead: { type: Boolean, default: false },
  autoCmdRead: { type: Boolean, default: true },
  autoReply: { type: Boolean, default: false },
  botMode: { type: String, default: "public" }, // private/public/group/inbox
  prefix: { type: String, default: "." },
  owner: { type: String, default: OWNER_NUMBER }
});
const Settings = mongoose.model('Settings', SettingsSchema);

async function getSettings(jid) {
  let s = await Settings.findOne({ jid });
  if (!s) s = await Settings.create({ jid });
  return s;
}

// ====== START BOT ======
async function startBot() {
  await mongoose.connect(MONGO_URL);
  console.log("✅ MongoDB connected");

  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ["Astron MINI", "Chrome", "1.0.0"]
  });

  // Pairing code (number එක console එකෙන් ගන්න)
  if (!sock.authState.creds.registered) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("📱 ඔයාගේ WhatsApp number එක (947XXXXXXXX): ", async (num) => {
      const code = await sock.requestPairingCode(num.replace(/[^0-9]/g, ''));
      console.log(`🔑 PAIR CODE: ${code}`);
      rl.close();
    });
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') {
      console.log(`✅ ${BOT_NAME} connected!`);
      const ownerJid = OWNER_NUMBER + "@s.whatsapp.net";
      // Connect message + image + voice
      await sock.sendMessage(ownerJid, {
        image: { url: "https://i.ibb.co/placeholder/astron.jpg" }, // <-- IMAGE URL දාන්න
        caption: `*${BOT_NAME}* connected ✅\n\n👤 Owner: ${OWNER_NAME}\n📞 Help: ${HELP_NUMBER}\n\n${WATERMARK}`
      });
      await sock.sendMessage(ownerJid, {
        audio: { url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" }, // <-- VOICE URL දාන්න
        mimetype: 'audio/mp4',
        ptt: true
      });
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) startBot();
    }
  });

  // ====== AUTO STATUS VIEW ======
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;
      const from = msg.key.remoteJid;
      const sender = msg.key.participant || from;
      const isStatus = from === 'status@broadcast';

      const settings = await getSettings(jidNormalizedUser(sender));

      // auto status view
      if (isStatus && settings.autoStatusView) {
        await sock.readMessages([msg.key]);
      }

      // auto read
      if (settings.autoRead && !isStatus) await sock.readMessages([msg.key]);

      // ====== COMMAND HANDLER ======
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      if (!text.startsWith(settings.prefix)) continue;
      if (settings.autoCmdRead) await sock.readMessages([msg.key]);

      const cmd = text.slice(settings.prefix.length).trim().split(/ +/)[0].toLowerCase();
      const args = text.slice(settings.prefix.length).trim().split(/ +/).slice(1);
      const reply = (t) => sock.sendMessage(from, { text: t + `\n\n_${WATERMARK}_` }, { quoted: msg });

      switch (cmd) {
        case 'menu': {
          const menu = `╭─「 *${BOT_NAME}* 」\n│ 👤 Owner: ${OWNER_NAME}\n│ 📞 Help: ${HELP_NUMBER}\n╰────────────\n\n` +
            `*⚙️ SETTINGS*\n• ${settings.prefix}autostatus on/off\n• ${settings.prefix}autoread on/off\n• ${settings.prefix}autocmdread on/off\n• ${settings.prefix}autoreply on/off\n• ${settings.prefix}mode private/public/group/inbox\n• ${settings.prefix}prefix <new>\n\n` +
            `*🛠️ TOOLS*\n• ${settings.prefix}ping\n• ${settings.prefix}remsg (reply to deleted)\n• ${settings.prefix}forward <jid/link>\n• ${settings.prefix}translate <lang> (reply)\n• ${settings.prefix}statussave (reply to status)\n\n` +
            `_${WATERMARK}_`;
          await sock.sendMessage(from, {
            image: { url: "https://i.ibb.co/placeholder/menu.jpg" }, // <-- MENU IMAGE URL
            caption: menu
          }, { quoted: msg });
          break;
        }
        case 'ping':
          await reply(`🏓 Pong! ${Date.now() - msg.messageTimestamp * 1000}ms`);
          break;
        case 'prefix':
          if (!args[0]) return reply("❌ Usage: .prefix <new>");
          settings.prefix = args[0]; await settings.save();
          await reply(`✅ Prefix changed to: ${args[0]}`);
          break;
        case 'mode':
          if (!['private','public','group','inbox'].includes(args[0])) return reply("❌ private/public/group/inbox");
          settings.botMode = args[0]; await settings.save();
          await reply(`✅ Bot mode: ${args[0]}`);
          break;
        case 'autostatus':
          settings.autoStatusView = args[0] === 'on'; await settings.save();
          await reply(`✅ Auto status view: ${args[0]}`);
          break;
        case 'autoread':
          settings.autoRead = args[0] === 'on'; await settings.save();
          await reply(`✅ Auto read: ${args[0]}`);
          break;
        case 'autocmdread':
          settings.autoCmdRead = args[0] === 'on'; await settings.save();
          await reply(`✅ Auto cmd read: ${args[0]}`);
          break;
        case 'autoreply':
          settings.autoReply = args[0] === 'on'; await settings.save();
          await reply(`✅ Auto reply: ${args[0]}`);
          break;
        // ... (remsg, forward, translate, statussave ඔයා add කරගන්න)
      }
    }
  });
}

startBot();
