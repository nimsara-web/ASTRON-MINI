const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion, jidNormalizedUser, normalizeMessageContent, downloadMediaMessage, getContentType } = require('baileys');
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
// 👇 ඔයාගේ image/voice URLs මෙතන දාන්න
const CONNECT_IMAGE = "https://raw.githubusercontent.com/nimsara-web/Im-Nim/refs/heads/main/Data/New/WhatsApp%20Image%202026-09-24%20at%201.11.32%20AM.jpeg";
const CONNECT_VOICE = "https://github.com/nimsara-web/Im-Nim/raw/refs/heads/main/Nimoradata/0923.MP3";
const MENU_IMAGE = "https://raw.githubusercontent.com/nimsara-web/Im-Nim/refs/heads/main/Data/New/WhatsApp%20Image%202026-09-24%20at%201.11.32%20AM.jpeg";
const MENU_VOICE = "https://github.com/nimsara-web/Im-Nim/raw/refs/heads/main/Nimoradata/0923.MP3";

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

// ==================== CHANNEL CONTEXT ====================
function getChannelContext() {
  return {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: LOG_CHANNEL,
      newsletterName: BOT_NAME,
      serverMessageId: -1
    }
  };
}

// ==================== SAFE SEND ====================
async function safeSend(sock, jid, content, options = {}) {
  try {
    return await sock.sendMessage(jid, content, options);
  } catch (e) {
    console.log(`⚠️ SafeSend failed:`, e.message);
    try {
      if (content.image || content.video || content.audio || content.document || content.sticker) {
        return await sock.sendMessage(jid, { text: content.caption || "📎 Media", contextInfo: getChannelContext() }, options);
      }
    } catch (e2) {}
    return null;
  }
}

// ==================== BOT STATE ====================
let sock = null;
let pairingCode = null;
let isConnected = false;
let botStarted = false;
const deletedMsgs = new Map(); // deleted message recover සඳහා

// ==================== START BOT ====================
async function startBot() {
  if (botStarted) return;
  botStarted = true;

  await mongoose.connect(MONGO_URL);
  console.log("✅ MongoDB connected");

  const { state, saveCreds } = await useMultiFileAuthState('./session');

  let version;
  try {
    const waVersion = await fetchLatestWaWebVersion();
    version = waVersion.version || waVersion;
    console.log(`📱 WA Version: ${Array.isArray(version) ? version.join('.') : version}`);
  } catch (e) {
    version = [2, 3000, 1042466098];
  }

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ["Mac OS", "Chrome", "14.4.1"]
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
      } catch (e) {
        await sock.sendMessage(ownerJid, { text: `*${BOT_NAME}* connected ✅\n\n_${WATERMARK}_` }).catch(() => {});
      }
      if (CONNECT_VOICE) {
        await sock.sendMessage(ownerJid, { audio: { url: CONNECT_VOICE }, mimetype: 'audio/mp4', ptt: true }).catch(() => {});
      }
    }
    if (connection === 'close') {
      isConnected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️ Closed. Code: ${code}`);
      if (code === DisconnectReason.restartRequired || code === 515) {
        setTimeout(() => { botStarted = false; startBot(); }, 3000);
      } else if (code !== DisconnectReason.loggedOut) {
        botStarted = false;
        setTimeout(() => startBot(), 5000);
      }
    }
  });

  // ====== ANTI-DELETE (AUTO SEND එපා - cache විතරයි) ======
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      if (u.update?.message === null || u.update?.messageStubType === 1) {
        const cached = msgCache.get(u.key.id);
        if (cached && cached.message) {
          // 👇 Auto-send කරන්නේ නෑ. cache එකේ තියනවා, .remsg එකෙන් ගන්නවා
          deletedMsgs.set(u.key.id, { msg: cached, from: cached.key.remoteJid, sender: jidNormalizedUser(cached.key.participant || cached.key.remoteJid) });
          // cache එකේ තියෙන්න දෙන්න
        }
      }
    }
  });

  // ====== GROUP WELCOME / GOODBYE ======
  sock.ev.on('group-participants.update', async (update) => {
    const { id, participants, action } = update;
    for (const p of participants) {
      try {
        if (action === 'add') await sock.sendMessage(id, { text: `👋 Welcome @${p.split('@')[0]}!\n\n_${WATERMARK}_`, mentions: [p] });
        else if (action === 'remove') await sock.sendMessage(id, { text: `👋 Goodbye @${p.split('@')[0]}!\n\n_${WATERMARK}_`, mentions: [p] });
      } catch (e) {}
    }
  });

  // ====== MESSAGE HANDLER ======
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        const from = msg.key.remoteJid;
        const sender = jidNormalizedUser(msg.key.participant || from);
        const isStatus = from === 'status@broadcast';
        const settings = await getSettings(sender);

        // 👇 BOT MODE CHECK
        if (settings.botMode === 'private' && sender !== OWNER_NUMBER + "@s.whatsapp.net") {
          continue; // private mode එකේ owner ට විතරයි
        }
        if (settings.botMode === 'group' && !from.endsWith('@g.us')) {
          continue; // group mode එකේ group වලට විතරයි
        }
        if (settings.botMode === 'inbox' && from.endsWith('@g.us')) {
          continue; // inbox mode එකේ DM වලට විතරයි
        }

        if (!isStatus) {
          msgCache.set(msg.key.id, msg);
          if (msgCache.size > 500) msgCache.delete(msgCache.keys().next().value);
        }

        // 👀 View-once silent download to owner
        const normalized = normalizeMessageContent(msg.message);
        if (msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2) {
          try {
            const onceMsg = { ...msg, message: normalized };
            const buffer = await downloadMediaMessage(onceMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
            const type = getContentType(normalized);
            const ownerJid = OWNER_NUMBER + "@s.whatsapp.net";
            if (type === 'imageMessage') {
              await sock.sendMessage(ownerJid, { image: buffer, caption: `👀 View-once from ${sender}\n\n_${WATERMARK}_` });
            } else if (type === 'videoMessage') {
              await sock.sendMessage(ownerJid, { video: buffer, caption: `👀 View-once from ${sender}\n\n_${WATERMARK}_` });
            } else if (type === 'audioMessage') {
              await sock.sendMessage(ownerJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
            }
          } catch (e) { console.log("View-once download error:", e.message); }
        }

        if (isStatus && settings.autoStatusView) {
          try { await sock.readMessages([msg.key]); } catch (e) {}
        }
        if (settings.autoRead && !isStatus) {
          try { await sock.readMessages([msg.key]); } catch (e) {}
        }

        const text = normalized.conversation || normalized.extendedTextMessage?.text || "";

        if (!isStatus && settings.autoReply && !text.startsWith(settings.prefix)) {
          await sock.sendMessage(from, { text: `${settings.autoReplyText}\n📞 Help: ${HELP_NUMBER}\n\n_${WATERMARK}_`, contextInfo: getChannelContext() }, { quoted: msg }).catch(() => {});
        }

        // 👇 PREFIX CHECK
        if (!text.startsWith(settings.prefix)) continue;
        if (settings.autoCmdRead) {
          try { await sock.readMessages([msg.key]); } catch (e) {}
        }

        const cmd = text.slice(settings.prefix.length).trim().split(/ +/)[0].toLowerCase();
        const args = text.slice(settings.prefix.length).trim().split(/ +/).slice(1);
        const reply = (t) => sock.sendMessage(from, { text: t + `\n\n_${WATERMARK}_`, contextInfo: getChannelContext() }, { quoted: msg }).catch(() => {});
        const qCtx = normalized.extendedTextMessage?.contextInfo;
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
              `*⚙️ SETTINGS*\n• ${settings.prefix}autostatus on/off\n• ${settings.prefix}autoread on/off\n• ${settings.prefix}autocmdread on/off\n• ${settings.prefix}autoreply on/off\n• ${settings.prefix}mode private/public/group/inbox\n• ${settings.prefix}prefix <new>\n\n` +
              `*🛠️ TOOLS*\n• ${settings.prefix}ping\n• ${settings.prefix}alive\n• ${settings.prefix}owner\n• ${settings.prefix}settings\n• ${settings.prefix}remsg (reply to deleted)\n• ${settings.prefix}forward <jid/link/number>\n• ${settings.prefix}translate <lang>\n• ${settings.prefix}statussave\n• ${settings.prefix}save (reply to status/media)\n• ${settings.prefix}vv (reply to view-once)\n• 👀 (reply to view-once)\n\n` +
              `_${WATERMARK}_`;
            await safeSend(sock, from, { image: { url: MENU_IMAGE }, caption: menu, contextInfo: getChannelContext() }, { quoted: msg });
            if (MENU_VOICE) await safeSend(sock, from, { audio: { url: MENU_VOICE }, mimetype: 'audio/mp4', ptt: true, contextInfo: getChannelContext() }, { quoted: msg });
            break;
          }
          case 'ping': await reply(`🏓 Pong! ${Date.now() - msg.messageTimestamp * 1000}ms`); break;
          case 'alive': {
            const caption = `✨ *${BOT_NAME}* is Alive!\n\n👤 Owner: ${OWNER_NAME}\n📞 Help: ${HELP_NUMBER}\n⚡ Status: Online\n\n_${WATERMARK}_`;
            await safeSend(sock, from, { image: { url: CONNECT_IMAGE }, caption, contextInfo: getChannelContext() }, { quoted: msg });
            if (CONNECT_VOICE) await safeSend(sock, from, { audio: { url: CONNECT_VOICE }, mimetype: 'audio/mp4', ptt: true, contextInfo: getChannelContext() }, { quoted: msg });
            break;
          }
          case 'owner': {
            const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${OWNER_NAME}\nTEL;type=CELL;type=VOICE;waid=${OWNER_NUMBER}:+${OWNER_NUMBER}\nEND:VCARD`;
            await safeSend(sock, from, { contacts: { displayName: OWNER_NAME, contacts: [{ vcard }] }, caption: `👤 *Owner:* ${OWNER_NAME}\n📞 ${HELP_NUMBER}\n\n_${WATERMARK}_`, contextInfo: getChannelContext() }, { quoted: msg });
            break;
          }
          case 'settings': {
            const s = await getSettings(sender);
            await reply(`⚙️ *YOUR SETTINGS*\n\n• Auto Status View: ${s.autoStatusView ? '✅ ON' : '❌ OFF'}\n• Auto Read: ${s.autoRead ? '✅ ON' : '❌ OFF'}\n• Auto Cmd Read: ${s.autoCmdRead ? '✅ ON' : '❌ OFF'}\n• Auto Reply: ${s.autoReply ? '✅ ON' : '❌ OFF'}\n• Bot Mode: ${s.botMode}\n• Prefix: ${s.prefix}\n• Owner: ${s.owner}`);
            break;
          }
          case 'prefix': {
            if (!args[0]) return reply("❌ Usage: .prefix <new>");
            // 👇 prefix change - owner ට විතරයි
            if (sender !== OWNER_NUMBER + "@s.whatsapp.net") return reply("❌ Only owner can change prefix");
            settings.prefix = args[0];
            await settings.save();
            await reply(`✅ Prefix changed to: ${args[0]}`);
            break;
          }
          case 'mode': {
            if (!['private','public','group','inbox'].includes(args[0])) return reply("❌ private/public/group/inbox");
            if (sender !== OWNER_NUMBER + "@s.whatsapp.net") return reply("❌ Only owner can change mode");
            settings.botMode = args[0];
            await settings.save();
            await reply(`✅ Mode: ${args[0]}`);
            break;
          }
          case 'autostatus': settings.autoStatusView = args[0] === 'on'; await settings.save(); await reply(`✅ Auto status view: ${args[0]}`); break;
          case 'autoread': settings.autoRead = args[0] === 'on'; await settings.save(); await reply(`✅ Auto read: ${args[0]}`); break;
          case 'autocmdread': settings.autoCmdRead = args[0] === 'on'; await settings.save(); await reply(`✅ Auto cmd read: ${args[0]}`); break;
          case 'autoreply': settings.autoReply = args[0] === 'on'; await settings.save(); await reply(`✅ Auto reply: ${args[0]}`); break;
          case 'remsg': {
            // 👇 .remsg - deleted message recover (cache එකෙන්)
            if (!quoted) return reply("❌ Deleted message එකකට reply කරලා .remsg");
            const qType = Object.keys(quoted)[0];
            const qContent = quoted[qType];
            if (qType === 'conversation') return reply(`📩 *Recovered:*\n${qContent}`);
            if (qType === 'extendedTextMessage') return reply(`📩 *Recovered:*\n${qContent.text}`);
            // media forward
            try {
              await sock.sendMessage(from, { forward: { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false }, message: quoted }, force: true });
            } catch (e) { await reply(`❌ Failed: ${e.message}`); }
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
            // 👇 .save - status/media save
            if (!quoted) return reply("❌ Media/status message එකකට reply කරලා .save");
            try {
              const targetJid = qCtx?.remoteJid || from;
              await sock.sendMessage(sender, { forward: { key: { remoteJid: targetJid, id: qCtx.stanzaId, fromMe: false }, message: quoted }, force: true });
              await reply("✅ Saved to DM");
            } catch (e) { await reply(`❌ Failed: ${e.message}`); }
            break;
          }
          case 'vv': {
            // 👇 .vv - view-once unwrap කරලා normal media විදියට එවන්න
            if (!quoted) return reply("❌ View-once message එකකට reply කරලා .vv");
            try {
              const onceContent = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted;
              const normalizedOnce = normalizeMessageContent(onceContent);
              const onceType = getContentType(normalizedOnce);
              // forward normal message විදියට
              await sock.sendMessage(from, { forward: { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false }, message: normalizedOnce }, force: true });
              await reply(`✅ View-once ${onceType?.replace('Message','') || 'media'} converted`);
            } catch (e) { await reply(`❌ Failed: ${e.message}`); }
            break;
          }
          case '👀': {
            // 👀 view-once - owner ට silent download
            if (!quoted) return reply("❌ View-once message එකකට reply කරලා 👀");
            try {
              const onceContent = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted;
              const normalizedOnce = normalizeMessageContent(onceContent);
              const onceType = getContentType(normalizedOnce);
              const onceMsg = { ...msg, message: normalizedOnce };
              const buffer = await downloadMediaMessage(onceMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
              const ownerJid = OWNER_NUMBER + "@s.whatsapp.net";
              if (onceType === 'imageMessage') {
                await sock.sendMessage(ownerJid, { image: buffer, caption: `👀 View-once from ${sender}\n\n_${WATERMARK}_` });
              } else if (onceType === 'videoMessage') {
                await sock.sendMessage(ownerJid, { video: buffer, caption: `👀 View-once from ${sender}\n\n_${WATERMARK}_` });
              } else if (onceType === 'audioMessage') {
                await sock.sendMessage(ownerJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
              }
              await reply("✅ View-once sent to your DM");
            } catch (e) { await reply(`❌ Failed: ${e.message}`); }
            break;
          }
          // commands.js
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
      } catch (loopErr) {
        console.log("⚠️ Handler error:", loopErr.message);
      }
    }
  });
}

// ==================== WEBSITE ====================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/pair', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: "Number required" });
  try {
    if (!sock) await startBot();
    if (isConnected) return res.json({ message: "Bot already connected ✅", connected: true });
    if (sock.authState.creds.registered) return res.json({ message: "Session exists. Restarting...", connected: true });
    const cleanNumber = number.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 10) return res.status(400).json({ error: "Invalid number format. Use 947XXXXXXXX" });
    const code = await sock.requestPairingCode(cleanNumber);
    pairingCode = code;
    console.log(`🔑 PAIR CODE for ${cleanNumber}: ${code}`);
    res.json({ code, number: cleanNumber });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ connected: isConnected, registered: sock?.authState?.creds?.registered || false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Website running on port ${PORT}`));

startBot();
