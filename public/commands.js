// commands.js - අලුත් commands
const axios = require('axios');

module.exports = {
  // ---------- STICKER ----------
  sticker: async (sock, msg, from, quoted, reply) => {
    if (!quoted) return reply("❌ Image/video එකකට reply කරලා .sticker");
    try {
      const stream = await sock.downloadMediaMessage({ message: quoted, key: msg.key });
      await sock.sendMessage(from, { sticker: stream }, { quoted: msg });
    } catch (e) { await reply(`❌ Sticker error: ${e.message}`); }
  },

  // ---------- AI (ChatGPT වගේ) ----------
  ai: async (sock, msg, from, args, reply) => {
    if (!args.length) return reply("❌ Usage: .ai <question>");
    try {
      const r = await axios.get(`https://api.nexoracle.com/ai/chatgpt?q=${encodeURIComponent(args.join(' '))}`);
      await reply(`🤖 *AI:*\n${r.data.result || "No response"}`);
    } catch (e) { await reply(`❌ AI error: ${e.message}`); }
  },

  // ---------- WEATHER ----------
  weather: async (sock, msg, from, args, reply) => {
    if (!args.length) return reply("❌ Usage: .weather <city>");
    try {
      const r = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${args[0]}&appid=YOUR_API_KEY&units=metric`);
      const d = r.data;
      await reply(`🌤️ *Weather: ${d.name}*\n\n🌡️ Temp: ${d.main.temp}°C\n💧 Humidity: ${d.main.humidity}%\n🌬️ Wind: ${d.wind.speed} m/s\n☁️ ${d.weather[0].description}`);
    } catch (e) { await reply(`❌ Weather error: ${e.message}`); }
  },

  // ---------- NEWS ----------
  news: async (sock, msg, from, reply) => {
    try {
      const r = await axios.get('https://newsapi.org/v2/top-headlines?country=us&apiKey=YOUR_API_KEY');
      const articles = r.data.articles.slice(0, 5).map((a, i) => `${i+1}. ${a.title}`).join('\n\n');
      await reply(`📰 *Top News:*\n\n${articles}`);
    } catch (e) { await reply(`❌ News error: ${e.message}`); }
  },

  // ---------- YOUTUBE DOWNLOAD ----------
  play: async (sock, msg, from, args, reply) => {
    if (!args.length) return reply("❌ Usage: .play <song name>");
    try {
      const r = await axios.get(`https://api.nexoracle.com/downloader/ytplay?q=${encodeURIComponent(args.join(' '))}`);
      const d = r.data.result;
      await sock.sendMessage(from, {
        audio: { url: d.download_url },
        mimetype: 'audio/mp4',
        ptt: false,
        caption: `🎵 *${d.title}*\n\n_${WATERMARK}_`
      }, { quoted: msg });
    } catch (e) { await reply(`❌ Play error: ${e.message}`); }
  },

  // ---------- IMAGE SEARCH ----------
  img: async (sock, msg, from, args, reply) => {
    if (!args.length) return reply("❌ Usage: .img <query>");
    try {
      const r = await axios.get(`https://api.nexoracle.com/search/pinterest?q=${encodeURIComponent(args.join(' '))}`);
      const url = r.data.result?.[0];
      if (!url) return reply("❌ No image found");
      await sock.sendMessage(from, { image: { url }, caption: `🖼️ *${args.join(' ')}*\n\n_${WATERMARK}_` }, { quoted: msg });
    } catch (e) { await reply(`❌ Image error: ${e.message}`); }
  },

  // ---------- QR CODE ----------
  qr: async (sock, msg, from, args, reply) => {
    if (!args.length) return reply("❌ Usage: .qr <text>");
    try {
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(args.join(' '))}`;
      await sock.sendMessage(from, { image: { url }, caption: `📱 *QR Code*\n\n_${WATERMARK}_` }, { quoted: msg });
    } catch (e) { await reply(`❌ QR error: ${e.message}`); }
  },

  // ---------- SHORT URL ----------
  short: async (sock, msg, from, args, reply) => {
    if (!args.length) return reply("❌ Usage: .short <url>");
    try {
      const r = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(args[0])}`);
      await reply(`🔗 *Short URL:*\n${r.data}`);
    } catch (e) { await reply(`❌ Short error: ${e.message}`); }
  },

  // ---------- CALCULATOR ----------
  calc: async (sock, msg, from, args, reply) => {
    if (!args.length) return reply("❌ Usage: .calc <expression>");
    try {
      const result = eval(args.join(' '));
      await reply(`🧮 *Result:* ${result}`);
    } catch (e) { await reply(`❌ Invalid expression`); }
  },

  // ---------- PASSWORD GENERATOR ----------
  pass: async (sock, msg, from, args, reply) => {
    const len = parseInt(args[0]) || 12;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let pass = "";
    for (let i = 0; i < len; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    await reply(`🔐 *Generated Password:*\n\`${pass}\``);
  },

  // ---------- TIME ----------
  time: async (sock, msg, from, reply) => {
    const now = new Date();
    await reply(`🕐 *Current Time:*\n${now.toLocaleString()}`);
  },

  // ---------- BOT INFO ----------
  info: async (sock, msg, from, reply) => {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);
    await reply(`🤖 *${BOT_NAME} INFO*\n\n👤 Owner: ${OWNER_NAME}\n📞 Help: ${HELP_NUMBER}\n⏱️ Uptime: ${h}h ${m}m ${s}s\n💾 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n\n_${WATERMARK}_`);
  },

  // ---------- TAG ALL ----------
  tagall: async (sock, msg, from, args, reply) => {
    if (!from.endsWith('@g.us')) return reply("❌ Group එකක විතරයි");
    try {
      const meta = await sock.groupMetadata(from);
      const mentions = meta.participants.map(p => p.id);
      const text = args.join(' ') || "Attention everyone!";
      await sock.sendMessage(from, {
        text: `📢 *${text}*\n\n${mentions.map(m => `@${m.split('@')[0]}`).join(' ')}\n\n_${WATERMARK}_`,
        mentions
      });
    } catch (e) { await reply(`❌ Tag error: ${e.message}`); }
  },

  // ---------- GROUP INFO ----------
  groupinfo: async (sock, msg, from, reply) => {
    if (!from.endsWith('@g.us')) return reply("❌ Group එකක විතරයි");
    try {
      const meta = await sock.groupMetadata(from);
      const admins = meta.participants.filter(p => p.admin).map(p => `@${p.id.split('@')[0]}`).join(', ');
      await reply(`📊 *GROUP INFO*\n\n📝 Name: ${meta.subject}\n👥 Members: ${meta.participants.length}\n👑 Admins: ${admins || 'None'}\n📅 Created: ${new Date(meta.creation * 1000).toLocaleDateString()}\n\n_${WATERMARK}_`);
    } catch (e) { await reply(`❌ Error: ${e.message}`); }
  }
};
