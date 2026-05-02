require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const fetch = require("node-fetch");

// ============================================================
//  KONFIGURASI
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const FCE_API_KEY = process.env.FCE_API_KEY;
const FCE_BASE = "https://api2.freecustom.email/v1";

const ADMIN_ID = 6533320536;

// ============================================================
//  AKSES & TOKEN MANAGEMENT
// ============================================================
const authorizedUsers = new Set([ADMIN_ID]);
const accessTokens = new Map();
const awaitingToken = new Set();

function isAuthorized(userId) { return authorizedUsers.has(userId); }
function isAdmin(userId) { return userId === ADMIN_ID; }

function generateToken() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `TKN-${part(4)}-${part(4)}`;
}

function validateAndConsumeToken(token, userId) {
  const t = accessTokens.get(token.toUpperCase());
  if (!t) return false;
  if (t.usedBy && t.usedBy !== userId) return false;
  t.usedBy = userId;
  authorizedUsers.add(userId);
  return true;
}

// ============================================================
//  DOMAIN & NAMA
// ============================================================
const FREE_DOMAINS = [
  "ditube.info", "ditplay.info", "ditapi.info", "ditcloud.info",
  "ditdrive.info", "ditgame.info", "ditlearn.info", "ditpay.info",
  "junkstopper.info", "addmy.space", "attachmy.site",
];

const FIRST_NAMES = [
  "budi","siti","ahmad","dewi","rizki","andi","fitri","hendra","maya","yusuf",
  "rudi","lina","dani","bagas","ayu","dian","rama","sari","wahyu","agus",
  "rina","joko","nurul","fauzi","citra","bayu","indah","teguh","fajar","reza",
  "nisa","irwan","putri","hadi","vina","dedy","mira","ferdi","gilang","taufik",
  "rini","nanda","haris","zahra","ilham","wulan","andre","siska","bimo","laila",
  "dimas","tiara","arif","elsa","yoga","anggi","deva","nadia","raka","selvi",
  "guntur","yeni","aldi","tari","fandi","rian","desy","erwin","kiki","lucky",
  "john","sarah","michael","emma","david","olivia","james","sophia","robert","ava",
  "william","charlotte","thomas","grace","harry","alice","ryan","megan","kevin","laura",
  "daniel","jessica","chris","amanda","mark","rachel","brian","melissa","paul","emily",
  "jason","ashley","eric","stephanie","adam","nicole","joshua","brittany","sean","samantha",
  "jake","natalie","kyle","hannah","nathan","victoria","tyler","madison","alexis","vanessa",
];

const LAST_NAMES = [
  "santoso","kusuma","pratama","wijaya","setiawan","rahayu","permata","lestari",
  "hidayat","putra","saputra","nugroho","kurniawan","handoko","wicaksono","susanto",
  "purnama","pranata","hakim","firmansyah","gunawan","halim","budiman","suharto",
  "mulyadi","hartono","sugiarto","surya","wahyudi","ramadan","salim","iskandar",
  "smith","johnson","brown","davis","wilson","anderson","taylor","thomas","jackson",
  "white","harris","martin","thompson","garcia","martinez","robinson","clark","lewis",
  "walker","hall","allen","young","king","wright","scott","green","baker","adams",
  "nelson","hill","carter","mitchell","perez","roberts","turner","phillips","campbell",
];

const usedNames = new Set();

function generateHumanName() {
  for (let i = 0; i < 300; i++) {
    const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const formats = [
      `${first}.${last}`,
      `${first}_${last}`,
      `${first}${last}`,
      `${first}.${last[0]}${Math.floor(Math.random() * 90) + 10}`,
      `${first}${Math.floor(Math.random() * 900) + 100}`,
      `${first}.${last}${Math.floor(Math.random() * 90) + 10}`,
    ];
    const name = formats[Math.floor(Math.random() * formats.length)];
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  return `user.${Date.now().toString(36)}`;
}

function randomDomain() {
  return FREE_DOMAINS[Math.floor(Math.random() * FREE_DOMAINS.length)];
}

// ============================================================
//  STATE PER USER
// ============================================================
const userState = new Map();

function getState(chatId) {
  if (!userState.has(chatId)) userState.set(chatId, {});
  return userState.get(chatId);
}

function stopPolling(chatId) {
  const s = getState(chatId);
  if (s.pollingTimer) { clearInterval(s.pollingTimer); s.pollingTimer = null; }
}

// ============================================================
//  FCE API
// ============================================================
async function fcePost(path, body) {
  const res = await fetch(`${FCE_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${FCE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function fceGet(path) {
  const res = await fetch(`${FCE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${FCE_API_KEY}` },
  });
  return res.json();
}

// ============================================================
//  AUTO POLLING — langsung aktif saat email dibuat
// ============================================================
function startAutoPolling(chatId, email) {
  stopPolling(chatId);

  const state = getState(chatId);
  state.seenMessageIds = new Set();
  state.lastOtp = null;

  // Polling aktif selama 24 jam (sesuai lifetime email)
  const maxDuration = 24 * 60 * 60 * 1000;
  const startTime = Date.now();
  const pollInterval = 4000;

  const timer = setInterval(async () => {
    // Berhenti jika sudah 24 jam atau email berubah
    if (Date.now() - startTime > maxDuration) {
      stopPolling(chatId);
      return;
    }

    const cs = getState(chatId);
    if (cs.email !== email) { stopPolling(chatId); return; }
    if (!cs.pollingTimer) return;

    try {
      // Cek email baru masuk
      const msgResult = await fceGet(`/inboxes/${email}/messages`);
      if (msgResult.success && msgResult.data?.length > 0) {
        for (const msg of msgResult.data) {
          const mid = msg.id || msg.messageId || `${msg.from}-${msg.subject}-${msg.receivedAt}`;
          if (!cs.seenMessageIds.has(mid)) {
            cs.seenMessageIds.add(mid);
            const time = msg.receivedAt || msg.date;
            await bot.telegram.sendMessage(chatId,
              `📩 <b>Email Baru Masuk!</b>\n\n` +
              `📧 <code>${email}</code>\n\n` +
              `<b>Dari:</b> ${escapeHtml(msg.from || "-")}\n` +
              `<b>Subjek:</b> ${escapeHtml(truncate(msg.subject || "(tanpa subjek)", 80))}\n` +
              (time ? `<b>Waktu:</b> ${new Date(time).toLocaleString("id-ID")}\n` : ""),
              { parse_mode: "HTML", ...inboxKeyboard() }
            );
          }
        }
      }

      // Cek OTP baru
      const otpResult = await fceGet(`/inboxes/${email}/otp`);
      if (otpResult.success && otpResult.otp && otpResult.otp !== cs.lastOtp) {
        cs.lastOtp = otpResult.otp;
        await bot.telegram.sendMessage(chatId,
          `🔔 <b>OTP Masuk!</b>\n\n` +
          `📧 <code>${email}</code>\n\n` +
          `Tap kode untuk menyalin:\n<code>${otpResult.otp}</code>`,
          { parse_mode: "HTML", ...inboxKeyboard() }
        );
      }
    } catch (_) {}
  }, pollInterval);

  state.pollingTimer = timer;
}

async function createEmailForUser(chatId, domain) {
  stopPolling(chatId);
  const name = generateHumanName();
  const chosenDomain = domain || randomDomain();
  const email = `${name}@${chosenDomain}`;
  const result = await fcePost("/inboxes", { inbox: email });
  if (!result.success) return { success: false, message: result.message };
  const state = getState(chatId);
  state.email = email;
  state.seenMessageIds = new Set();
  state.lastOtp = null;

  // Langsung mulai polling otomatis
  startAutoPolling(chatId, email);

  return { success: true, email };
}

// ============================================================
//  UTIL
// ============================================================
function escapeHtml(t) {
  return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function truncate(str, max = 100) {
  const s = String(str || "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ============================================================
//  REPLY KEYBOARD
// ============================================================
function mainMenuKeyboard(userId) {
  const rows = [
    ["🎲 Buat Email Baru", "📋 Pilih Domain"],
  ];
  if (isAdmin(userId)) {
    rows.push(["⚙️ Panel Admin"]);
  }
  return Markup.keyboard(rows).resize();
}

function inboxKeyboard() {
  return Markup.keyboard([
    ["📬 Cek Inbox", "🔑 Cek OTP"],
    ["🆕 Buat Email Baru", "📋 Ganti Domain"],
    ["⛔ Stop Notif", "🏠 Menu Utama"],
  ]).resize();
}

function domainKeyboard() {
  const rows = [];
  for (let i = 0; i < FREE_DOMAINS.length; i += 2) {
    const row = [`@${FREE_DOMAINS[i]}`];
    if (FREE_DOMAINS[i + 1]) row.push(`@${FREE_DOMAINS[i + 1]}`);
    rows.push(row);
  }
  rows.push(["🏠 Menu Utama"]);
  return Markup.keyboard(rows).resize();
}

function adminKeyboard() {
  return Markup.keyboard([
    ["🔑 Generate Token", "📋 Lihat Token"],
    ["🚫 Cabut Token", "👥 Lihat User"],
    ["🏠 Menu Utama"],
  ]).resize();
}

// ============================================================
//  BOT
// ============================================================
const bot = new Telegraf(BOT_TOKEN);

// --- Middleware: cek akses ---
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (isAuthorized(userId)) return next();

  if (awaitingToken.has(userId) && ctx.message?.text) {
    const token = ctx.message.text.trim().toUpperCase();
    if (validateAndConsumeToken(token, userId)) {
      awaitingToken.delete(userId);
      return ctx.replyWithHTML(
        `✅ <b>Token valid! Akses diberikan.</b>\n\nSelamat datang! Gunakan bot dengan bebas.`,
        mainMenuKeyboard(userId)
      );
    } else {
      return ctx.replyWithHTML(
        `❌ <b>Token tidak valid atau sudah dipakai.</b>\n\nMinta token baru ke admin.`
      );
    }
  }

  await ctx.replyWithHTML(
    `🔒 <b>Bot ini bersifat pribadi.</b>\n\n` +
      `Untuk menggunakan bot ini, kamu memerlukan <b>token akses</b> dari admin.\n\n` +
      `Kirimkan tokennya sekarang (format: <code>TKN-XXXX-XXXX</code>).`,
    Markup.removeKeyboard()
  );
  awaitingToken.add(userId);
});

// --- /start ---
bot.start((ctx) => {
  stopPolling(ctx.chat.id);
  ctx.replyWithHTML(
    `👋 <b>Selamat datang di Temp Mail Bot!</b>\n\n` +
      `Buat inbox sementara instan — OTP masuk langsung dikirim ke sini otomatis.\n\n` +
      `📌 <i>Email bertahan ±24 jam</i>`,
    mainMenuKeyboard(ctx.from.id)
  );
});

// ============================================================
//  HANDLER TOMBOL
// ============================================================

bot.hears("🏠 Menu Utama", (ctx) => {
  ctx.replyWithHTML(`🏠 <b>Menu Utama</b>`, mainMenuKeyboard(ctx.from.id));
});

// Buat Email — langsung mulai polling otomatis
bot.hears(["🎲 Buat Email Baru", "🆕 Buat Email Baru"], async (ctx) => {
  const r = await createEmailForUser(ctx.chat.id);
  if (!r.success) return ctx.replyWithHTML(`❌ Gagal: ${r.message}`, mainMenuKeyboard(ctx.from.id));
  ctx.replyWithHTML(
    `✅ <b>Email siap digunakan!</b>\n\n` +
    `📧 <code>${r.email}</code>\n\n` +
    `🔔 <i>Notif OTP otomatis aktif — kamu akan langsung diberitahu saat ada email atau OTP masuk.</i>`,
    inboxKeyboard()
  );
});

// Pilih Domain — langsung mulai polling otomatis
bot.hears(["📋 Pilih Domain", "📋 Ganti Domain"], (ctx) => {
  ctx.replyWithHTML(`📋 <b>Pilih domain:</b>`, domainKeyboard());
});

FREE_DOMAINS.forEach((domain) => {
  bot.hears(`@${domain}`, async (ctx) => {
    const r = await createEmailForUser(ctx.chat.id, domain);
    if (!r.success) return ctx.replyWithHTML(`❌ Gagal: ${r.message}`, mainMenuKeyboard(ctx.from.id));
    ctx.replyWithHTML(
      `✅ <b>Email siap digunakan!</b>\n\n` +
      `📧 <code>${r.email}</code>\n\n` +
      `🔔 <i>Notif OTP otomatis aktif — kamu akan langsung diberitahu saat ada email atau OTP masuk.</i>`,
      inboxKeyboard()
    );
  });
});

// Cek Inbox (manual)
bot.hears("📬 Cek Inbox", async (ctx) => {
  const state = getState(ctx.chat.id);
  if (!state.email) return ctx.replyWithHTML(`❌ Belum ada email aktif.`, mainMenuKeyboard(ctx.from.id));
  const result = await fceGet(`/inboxes/${state.email}/messages`);
  if (!result.success || result.count === 0) {
    return ctx.replyWithHTML(
      `📭 <b>Inbox kosong</b>\n\n📧 <code>${state.email}</code>\n\nBelum ada email masuk.`,
      inboxKeyboard()
    );
  }
  let text = `📬 <b>${result.count} pesan masuk</b>\n\n📧 <code>${state.email}</code>\n\n`;
  result.data.slice(0, 5).forEach((msg, i) => {
    text += `<b>${i + 1}.</b> Dari: <i>${escapeHtml(msg.from || "-")}</i>\n`;
    text += `   Subjek: ${escapeHtml(truncate(msg.subject || "(tanpa subjek)", 60))}\n`;
    const time = msg.receivedAt || msg.date;
    if (time) text += `   ${new Date(time).toLocaleString("id-ID")}\n`;
    text += "\n";
  });
  ctx.replyWithHTML(text, inboxKeyboard());
});

// Cek OTP (manual)
bot.hears("🔑 Cek OTP", async (ctx) => {
  const state = getState(ctx.chat.id);
  if (!state.email) return ctx.replyWithHTML(`❌ Belum ada email aktif.`, mainMenuKeyboard(ctx.from.id));
  const result = await fceGet(`/inboxes/${state.email}/otp`);
  if (!result.success || !result.otp) {
    return ctx.replyWithHTML(
      `🔍 <b>Belum ada OTP</b>\n\n📧 <code>${state.email}</code>\n\nTenang, notif OTP otomatis sudah aktif dan akan masuk sendiri.`,
      inboxKeyboard()
    );
  }
  ctx.replyWithHTML(
    `🔑 <b>OTP Ditemukan!</b>\n\n📧 <code>${state.email}</code>\n\nKode OTP:\n<code>${result.otp}</code>\n\nTap kode untuk menyalin.`,
    inboxKeyboard()
  );
});

// Stop Notif
bot.hears("⛔ Stop Notif", (ctx) => {
  stopPolling(ctx.chat.id);
  const state = getState(ctx.chat.id);
  ctx.replyWithHTML(
    `⛔ <b>Notif otomatis dihentikan.</b>\n\n📧 <code>${state.email || "-"}</code>\n\nKamu bisa cek inbox/OTP manual kapanpun.`,
    inboxKeyboard()
  );
});

// ============================================================
//  PANEL ADMIN
// ============================================================
bot.hears("⚙️ Panel Admin", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.replyWithHTML(`❌ Bukan admin.`);
  const totalTokens = accessTokens.size;
  const usedTokens = [...accessTokens.values()].filter(t => t.usedBy).length;
  ctx.replyWithHTML(
    `⚙️ <b>Panel Admin</b>\n\n` +
      `👥 User aktif: <b>${authorizedUsers.size}</b>\n` +
      `🔑 Token dibuat: <b>${totalTokens}</b> (${usedTokens} terpakai)\n\n` +
      `Pilih aksi:`,
    adminKeyboard()
  );
});

bot.hears("🔑 Generate Token", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.replyWithHTML(`❌ Bukan admin.`);
  const token = generateToken();
  accessTokens.set(token, { createdAt: new Date(), usedBy: null });
  ctx.replyWithHTML(
    `✅ <b>Token Baru Dibuat!</b>\n\n` +
      `Token: <code>${token}</code>\n\n` +
      `Token hanya bisa dipakai oleh <b>1 orang</b>.`,
    adminKeyboard()
  );
});

bot.hears("📋 Lihat Token", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.replyWithHTML(`❌ Bukan admin.`);
  if (accessTokens.size === 0) return ctx.replyWithHTML(`📋 <b>Belum ada token.</b>`, adminKeyboard());
  let text = `📋 <b>Daftar Token (${accessTokens.size})</b>\n\n`;
  let i = 1;
  for (const [token, info] of accessTokens.entries()) {
    const status = info.usedBy ? `✅ Dipakai (ID: ${info.usedBy})` : "⏳ Belum dipakai";
    text += `${i}. <code>${token}</code>\n   ${status}\n\n`;
    i++;
  }
  ctx.replyWithHTML(text, adminKeyboard());
});

bot.hears("🚫 Cabut Token", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.replyWithHTML(`❌ Bukan admin.`);
  getState(ctx.chat.id).awaitingRevoke = true;
  ctx.replyWithHTML(`🚫 Ketik token yang ingin dicabut (format: <code>TKN-XXXX-XXXX</code>):`);
});

bot.hears("👥 Lihat User", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.replyWithHTML(`❌ Bukan admin.`);
  const users = [...authorizedUsers];
  let text = `👥 <b>User Aktif (${users.length})</b>\n\n`;
  users.forEach((uid, i) => {
    text += `${i + 1}. <code>${uid}</code>${uid === ADMIN_ID ? " 👑 Admin" : ""}\n`;
  });
  ctx.replyWithHTML(text, adminKeyboard());
});

// ============================================================
//  TEXT HANDLER
// ============================================================
bot.on("text", (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  if (isAdmin(userId)) {
    const state = getState(ctx.chat.id);
    if (state.awaitingRevoke) {
      state.awaitingRevoke = false;
      const token = text.toUpperCase();
      if (accessTokens.has(token)) {
        const info = accessTokens.get(token);
        if (info.usedBy) authorizedUsers.delete(info.usedBy);
        accessTokens.delete(token);
        return ctx.replyWithHTML(
          `✅ Token <code>${token}</code> berhasil dicabut.` +
            (info.usedBy ? `\n👤 User <code>${info.usedBy}</code> dikeluarkan.` : ""),
          adminKeyboard()
        );
      } else {
        return ctx.replyWithHTML(`❌ Token tidak ditemukan.`, adminKeyboard());
      }
    }
  }

  ctx.replyWithHTML(`Gunakan tombol di bawah 👇`, mainMenuKeyboard(userId));
});

// ============================================================
//  START
// ============================================================
bot.launch(() => {
  console.log("Bot berjalan...");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
