const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser } = require('@whiskeysockets/baileys');
const mongoose = require('mongoose');
const pino = require('pino');
const express = require('express');
const path = require('path');

// ==================== CONFIG ====================
const MONGO_URL = "mongodb+srv://YOUR_USER:YOUR_PASS@cluster.mongodb.net/astron"; // <-- ඔයාගේ URL
const BOT_NAME = "ASTRON MINI";
const OWNER_NAME = "Nimsara";
const OWNER_NUMBER = "94784280074";
const HELP_NUMBER = "0784280074";
const WATERMARK = "Created By Nimsara";
const LOG_CHANNEL = "120363362308230584@newsletter"; // ඔයාගේ channel JID
const CONNECT_IMAGE = "https://i.ibb.co/placeholder/astron.jpg";   // <-- IMAGE URL
const CONNECT_VOICE = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"; // <-- VOICE URL
const MENU_IMAGE = "https://i.ibb.co/placeholder/menu.jpg";        // <-- MENU IMAGE URL
const MENU_VOICE = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"; // <-- MENU VOICE URL

// ==================== MONGO SETTINGS ====================
const SettingsSchema = new mongoose.Schema({
  jid: { type: String, unique: true },
  autoStatusView: { type: Boolean, default: true },
  autoRead: { type: Boolean, default: false },
  autoCmdRead: { type: Boolean, default: true },
  autoReply: { type: Boolean, default: false },
  botMode: { type: String, default: "public" },
  prefix: { type: String, default: "." },
  owner: { type: String, default: OWNER_NUMBER }
});
const Settings = mongoose.model('Settings', SettingsSchema);
async function getSettings(jid) {
  let s = await Settings.findOne({ jid });
  if (!s) s = await Settings.create({ jid });
  return s;
}

// ==================== LOG TO CHANNEL ====================
async function logToChannel(sock, msg, from, sender) {
  try {
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "[media]";
    await sock.sendMessage(LOG_CHANNEL, {
      text: `📥 *NEW MESSAGE*\n\n👤 From: ${sender}\n📍 Chat: ${from}\n💬 Text: ${text}\n\n_${WATERMARK}_`
    });
    if (msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage) {
      await sock.sendMessage(LOG_CHANNEL, { forward: msg, force: true });
    }
  } catch (e) { console.log("Channel log error:", e.message); }
}

// ==================== START BOT ====================
let sock = null;
async function startBot() {
  await mongoose.connect(MONGO_URL);
  console.log("✅ MongoDB connected");

  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ["Astron MINI", "Chrome", "1.0.0"]
  });

  if (!sock.authState.creds.registered) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("📱 WhatsApp number (947XXXXXXXX): ", async (num) => {
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
      await sock.sendMessage(ownerJid, {
        image: { url: CONNECT_IMAGE },
        caption: `*${BOT_NAME}* connected ✅\n\n👤 Owner: ${OWNER_NAME}\n📞 Help: ${HELP_NUMBER}\n\n_${WATERMARK}_`
      });
      await sock.sendMessage(ownerJid, { audio: { url: CONNECT_VOICE }, mimetype: 'audio/mp4', ptt: true });
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) startBot();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;
      const from = msg.key.remoteJid;
      const sender = jidNormalizedUser(msg.key.participant || from);
      const isStatus = from === 'status@broadcast';
      const settings = await getSettings(sender);

      if (!isStatus) await logToChannel(sock, msg, from, sender);
      if (isStatus && settings.autoStatusView) await sock.readMessages([msg.key]);
      if (settings.autoRead && !isStatus) await sock.readMessages([msg.key]);

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      if (!text.startsWith(settings.prefix)) continue;
      if (settings.autoCmdRead) await sock.readMessages([msg.key]);

      const cmd = text.slice(settings.prefix.length).trim().split(/ +/)[0].toLowerCase();
      const args = text.slice(settings.prefix.length).trim().split(/ +/).slice(1);
      const reply = (t) => sock.sendMessage(from, { text: t + `\n\n_${WATERMARK}_` }, { quoted: msg });
      const qCtx = msg.message.extendedTextMessage?.contextInfo;
      const quoted = qCtx?.quotedMessage;

      switch (cmd) {
        case 'menu': {
          const menu = `╭─「 *${BOT_NAME}* 」\n│ 👤 Owner: ${OWNER_NAME}\n│ 📞 Help: ${HELP_NUMBER}\n╰────────────\n\n` +
            `*⚙️ SETTINGS*\n• ${settings.prefix}autostatus on/off\n• ${settings.prefix}autoread on/off\n• ${settings.prefix}autocmdread on/off\n• ${settings.prefix}autoreply on/off\n• ${settings.prefix}mode private/public/group/inbox\n• ${settings.prefix}prefix <new>\n\n` +
            `*🛠️ TOOLS*\n• ${settings.prefix}ping\n• ${settings.prefix}remsg (reply to deleted)\n• ${settings.prefix}forward <jid/link/number>\n• ${settings.prefix}translate <lang> (reply)\n• ${settings.prefix}statussave (reply to status)\n• 👀 (reply to view-once)\n\n` +
            `_${WATERMARK}_`;
          await sock.sendMessage(from, { image: { url: MENU_IMAGE }, caption: menu }, { quoted: msg });
          if (MENU_VOICE) await sock.sendMessage(from, { audio: { url: MENU_VOICE }, mimetype: 'audio/mp4', ptt: true }, { quoted: msg });
          break;
        }
        case 'ping':
          await reply(`🏓 Pong! ${Date.now() - msg.messageTimestamp * 1000}ms`);
          break;
        case 'prefix':
          if (!args[0]) return reply("❌ Usage: .prefix <new>");
          settings.prefix = args[0]; await settings.save();
          await reply(`✅ Prefix: ${args[0]}`);
          break;
        case 'mode':
          if (!['private','public','group','inbox'].includes(args[0])) return reply("❌ private/public/group/inbox");
          settings.botMode = args[0]; await settings.save();
          await reply(`✅ Mode: ${args[0]}`);
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
        case 'remsg': {
          if (!quoted) return reply("❌ Deleted message එකකට reply කරලා .remsg දාන්න");
          const qType = Object.keys(quoted)[0];
          const qContent = quoted[qType];
          if (qType === 'conversation') return reply(`📩 *Recovered:*\n${qContent}`);
          if (qType === 'extendedTextMessage') return reply(`📩 *Recovered:*\n${qContent.text}`);
          await sock.sendMessage(from, { forward: { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false }, message: quoted }, force: true });
          break;
        }
        case 'forward': {
          if (!args[0]) return reply("❌ Usage: .forward <jid/link/number> (reply to msg)");
          if (!quoted) return reply("❌ Forward කරන්න message එකකට reply කරන්න");
          let target = args[0];
          if (target.includes('chat.whatsapp.com')) {
            const code = target.split('/').pop();
            target = await sock.groupAcceptInvite(code).catch(() => null);
            if (!target) return reply("❌ Group link invalid");
          } else if (/^\d+$/.test(target)) target = target + "@s.whatsapp.net";
          try {
            await sock.sendMessage(target, { forward: { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false, participant: qCtx.participant }, message: quoted }, force: true });
            await reply(`✅ Forwarded to ${target}`);
          } catch (e) { await reply(`❌ Failed: ${e.message}`); }
          break;
        }
        case 'translate': {
          if (!args[0]) return reply("❌ Usage: .translate <lang> (reply)");
          if (!quoted) return reply("❌ Message එකකට reply කරන්න");
          const qText = quoted.conversation || quoted.extendedTextMessage?.text;
          if (!qText) return reply("❌ Text message එකකට reply කරන්න");
          try {
            const translate = require('translate-google');
            const result = await translate(qText, { to: args[0] });
            await reply(`🌐 *Translated (${args[0]}):*\n${result}`);
          } catch (e) { await reply(`❌ Translate error: ${e.message}`); }
          break;
        }
        case 'statussave': {
          if (!quoted) return reply("❌ Status එකකට reply කරලා .statussave");
          try {
            await sock.sendMessage(sender, { forward: { key: { remoteJid: 'status@broadcast', id: qCtx.stanzaId, fromMe: false }, message: quoted }, force: true });
            await reply("✅ Status saved to DM");
          } catch (e) { await reply(`❌ Failed: ${e.message}`); }
          break;
        }
        case '👀': {
          if (!quoted) return reply("❌ View-once message එකකට reply කරලා 👀");
          const onceType = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted;
          try {
            await sock.sendMessage(sender, { forward: { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false }, message: onceType }, force: true });
            await reply("✅ View-once sent to DM");
          } catch (e) { await reply(`❌ Failed: ${e.message}`); }
          break;
        }
      }
    }
  });
}

// ==================== WEBSITE (Express) ====================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pairing code API
app.post('/api/pair', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: "Number required" });
  if (!sock) return res.status(500).json({ error: "Bot not initialized" });
  try {
    const code = await sock.requestPairingCode(number.replace(/[^0-9]/g, ''));
    res.json({ code });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(3000, () => console.log("🌐 Website: http://localhost:3000"));

startBot();
