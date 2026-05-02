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
// User yang sudah berhak akses (bertahan selama bot nyala)
const authorizedUsers = new Set([ADMIN_ID]);

// Map token -> { note, createdAt, usedBy (userId atau null) }
const accessTokens = new Map();

// User yang sedang menunggu input token
const awaitingToken = new Set();

function isAuthorized(userId) {
  return authorizedUsers.has(userId);
}

function isAdmin(userId) {
  return userId === ADMIN_ID;
}

function generateToken() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `TKN-${part(4)}-${part(4)}`;
}

function validateAndConsumeToken(token, userId) {
  const t = accessTokens.get(token.toUpperCase());
  if (!t) return false;
  if (t.usedBy && t.usedBy !== userId) return false; // token sudah dipakai user lain
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
//  KEYBOARD
// ============================================================
function mainMenuKeyboard(userId) {
  const rows = [
    [Markup.button.callback("🎲 Buat Email Baru", "create_email")],
    [Markup.button.callback("📋 Pilih Domain Sendiri", "choose_domain")],
  ];
  if (isAdmin(userId)) {
    rows.push([Markup.button.callback("⚙️ Panel Admin", "admin_panel")]);
  }
  return Markup.inlineKeyboard(rows);
}

function inboxKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📬 Cek Inbox", "check_inbox"), Markup.button.callback("🔑 Cek OTP", "check_otp")],
    [Markup.button.callback("🔔 Auto Notif (10 menit)", "auto_otp")],
    [Markup.button.callback("🆕 Buat Email Baru", "create_email")],
    [Markup.button.callback("📋 Ganti Domain", "choose_domain")],
  ]);
}

function domainKeyboard() {
  const buttons = FREE_DOMAINS.map((d) => [Markup.button.callback(`@${d}`, `domain_${d}`)]);
  buttons.push([Markup.button.callback("🔙 Kembali", "back_main")]);
  return Markup.inlineKeyboard(buttons);
}

function stopKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback("⛔ Stop Auto Notif", "stop_auto_otp")]]);
}

function adminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔑 Generate Token Baru", "admin_gen_token")],
    [Markup.button.callback("📋 Lihat Token Aktif", "admin_list_tokens")],
    [Markup.button.callback("🚫 Cabut Token", "admin_revoke_menu")],
    [Markup.button.callback("👥 Lihat User Aktif", "admin_list_users")],
    [Markup.button.callback("🔙 Kembali", "back_main")],
  ]);
}

// ============================================================
//  BOT
// ============================================================
const bot = new Telegraf(BOT_TOKEN);

// --- Middleware: cek akses ---
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Admin & user yang sudah punya token = lanjut
  if (isAuthorized(userId)) return next();

  // User sedang menunggu input token (mode teks)
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

  // User tidak dikenal → tampilkan peringatan
  await ctx.replyWithHTML(
    `🔒 <b>Bot ini bersifat pribadi dan tidak dapat diakses secara bebas.</b>\n\n` +
      `Untuk menggunakan bot ini, kamu memerlukan <b>token akses</b> dari admin.\n\n` +
      `Jika sudah punya token, kirimkan tokennya sekarang.`,
    Markup.inlineKeyboard([
      [Markup.button.callback("🔑 Masukkan Token", "enter_token")],
    ])
  );
});

// --- Tombol masukkan token ---
bot.action("enter_token", async (ctx) => {
  await ctx.answerCbQuery();
  awaitingToken.add(ctx.from.id);
  ctx.replyWithHTML(`🔑 Kirimkan token akses kamu sekarang (format: <code>TKN-XXXX-XXXX</code>):`);
});

// --- /start ---
bot.start((ctx) => {
  stopPolling(ctx.chat.id);
  ctx.replyWithHTML(
    `👋 <b>Selamat datang di Temp Mail Bot!</b>\n\n` +
      `Buat inbox sementara instan, terima email &amp; OTP otomatis.\n\n` +
      `📌 <i>Email bertahan ±24 jam</i>`,
    mainMenuKeyboard(ctx.from.id)
  );
});

// ============================================================
//  EMAIL ACTIONS
// ============================================================
bot.action("create_email", async (ctx) => {
  await ctx.answerCbQuery();
  const r = await createEmailForUser(ctx.chat.id);
  if (!r.success) return ctx.replyWithHTML(`❌ Gagal: ${r.message}`, mainMenuKeyboard(ctx.from.id));
  ctx.editMessageText(
    `✅ <b>Email siap digunakan!</b>\n\n📧 <code>${r.email}</code>\n\nTap email untuk menyalin. Pilih aksi:`,
    { parse_mode: "HTML", ...inboxKeyboard() }
  );
});

bot.action("choose_domain", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.editMessageText(`📋 <b>Pilih domain:</b>`, { parse_mode: "HTML", ...domainKeyboard() });
});

FREE_DOMAINS.forEach((domain) => {
  bot.action(`domain_${domain}`, async (ctx) => {
    await ctx.answerCbQuery();
    const r = await createEmailForUser(ctx.chat.id, domain);
    if (!r.success) return ctx.replyWithHTML(`❌ Gagal: ${r.message}`, mainMenuKeyboard(ctx.from.id));
    ctx.editMessageText(
      `✅ <b>Email siap digunakan!</b>\n\n📧 <code>${r.email}</code>\n\nTap email untuk menyalin. Pilih aksi:`,
      { parse_mode: "HTML", ...inboxKeyboard() }
    );
  });
});

bot.action("back_main", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.editMessageText(`🏠 <b>Menu Utama</b>`, { parse_mode: "HTML", ...mainMenuKeyboard(ctx.from.id) });
});

bot.action("check_inbox", async (ctx) => {
  await ctx.answerCbQuery("Mengecek inbox...");
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

bot.action("check_otp", async (ctx) => {
  await ctx.answerCbQuery("Mencari OTP...");
  const state = getState(ctx.chat.id);
  if (!state.email) return ctx.replyWithHTML(`❌ Belum ada email aktif.`, mainMenuKeyboard(ctx.from.id));
  const result = await fceGet(`/inboxes/${state.email}/otp`);
  if (!result.success || !result.otp) {
    return ctx.replyWithHTML(
      `🔍 <b>Belum ada OTP</b>\n\n📧 <code>${state.email}</code>\n\nGunakan <b>🔔 Auto Notif</b> agar OTP langsung dikirim otomatis.`,
      inboxKeyboard()
    );
  }
  ctx.replyWithHTML(
    `🔑 <b>OTP Ditemukan!</b>\n\n📧 <code>${state.email}</code>\n\nKode OTP:\n<code>${result.otp}</code>\n\nTap kode untuk menyalin.`,
    inboxKeyboard()
  );
});

bot.action("auto_otp", async (ctx) => {
  await ctx.answerCbQuery("Auto Notif aktif!");
  const state = getState(ctx.chat.id);
  if (!state.email) return ctx.replyWithHTML(`❌ Belum ada email aktif.`, mainMenuKeyboard(ctx.from.id));

  stopPolling(ctx.chat.id);
  state.seenMessageIds = state.seenMessageIds || new Set();
  state.lastOtp = state.lastOtp || null;

  const email = state.email;
  const chatId = ctx.chat.id;
  const startTime = Date.now();
  const maxDuration = 10 * 60 * 1000;
  const pollInterval = 4000;

  await ctx.replyWithHTML(
    `🔔 <b>Auto Notif Aktif</b>\n\n📧 <code>${email}</code>\n\n` +
      `Notif otomatis:\n• Email baru masuk\n• OTP terdeteksi (tap untuk copy)\n\n⏱ Aktif <b>10 menit</b>`,
    stopKeyboard()
  );

  const timer = setInterval(async () => {
    if (Date.now() - startTime > maxDuration) {
      stopPolling(chatId);
      bot.telegram.sendMessage(chatId,
        `⏰ <b>Auto Notif selesai</b> (10 menit habis)\n\n📧 <code>${email}</code>`,
        { parse_mode: "HTML", ...inboxKeyboard() }
      );
      return;
    }
    try {
      const cs = getState(chatId);
      if (cs.email !== email) { stopPolling(chatId); return; }

      const msgResult = await fceGet(`/inboxes/${email}/messages`);
      if (msgResult.success && msgResult.data?.length > 0) {
        for (const msg of msgResult.data) {
          const mid = msg.id || msg.messageId || `${msg.from}-${msg.subject}-${msg.receivedAt}`;
          if (!cs.seenMessageIds.has(mid)) {
            cs.seenMessageIds.add(mid);
            const time = msg.receivedAt || msg.date;
            await bot.telegram.sendMessage(chatId,
              `📩 <b>Email Baru Masuk!</b>\n\n📧 <code>${email}</code>\n\n` +
                `<b>Dari:</b> ${escapeHtml(msg.from || "-")}\n` +
                `<b>Subjek:</b> ${escapeHtml(truncate(msg.subject || "(tanpa subjek)", 80))}\n` +
                (time ? `<b>Waktu:</b> ${new Date(time).toLocaleString("id-ID")}\n` : "") +
                `\n🔍 <i>Sedang mencari OTP...</i>`,
              { parse_mode: "HTML" }
            );
          }
        }
      }

      const otpResult = await fceGet(`/inboxes/${email}/otp`);
      if (otpResult.success && otpResult.otp && otpResult.otp !== cs.lastOtp) {
        cs.lastOtp = otpResult.otp;
        await bot.telegram.sendMessage(chatId,
          `🔔 <b>OTP Otomatis Terdeteksi!</b>\n\n📧 <code>${email}</code>\n\n` +
            `Tap kode untuk menyalin:\n<code>${otpResult.otp}</code>`,
          { parse_mode: "HTML", ...inboxKeyboard() }
        );
      }
    } catch (_) {}
  }, pollInterval);

  getState(chatId).pollingTimer = timer;
});

bot.action("stop_auto_otp", async (ctx) => {
  await ctx.answerCbQuery("Auto Notif dihentikan.");
  stopPolling(ctx.chat.id);
  const state = getState(ctx.chat.id);
  ctx.replyWithHTML(
    `⛔ <b>Auto Notif dihentikan.</b>\n\n📧 <code>${state.email || "-"}</code>`,
    inboxKeyboard()
  );
});

// ============================================================
//  PANEL ADMIN
// ============================================================
bot.action("admin_panel", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan admin.");
  await ctx.answerCbQuery();
  const totalTokens = accessTokens.size;
  const usedTokens = [...accessTokens.values()].filter(t => t.usedBy).length;
  ctx.editMessageText(
    `⚙️ <b>Panel Admin</b>\n\n` +
      `👥 User aktif: <b>${authorizedUsers.size}</b>\n` +
      `🔑 Token dibuat: <b>${totalTokens}</b> (${usedTokens} terpakai)\n\n` +
      `Pilih aksi:`,
    { parse_mode: "HTML", ...adminKeyboard() }
  );
});

// Generate token baru
bot.action("admin_gen_token", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan admin.");
  await ctx.answerCbQuery();
  const token = generateToken();
  accessTokens.set(token, { createdAt: new Date(), usedBy: null });
  ctx.replyWithHTML(
    `✅ <b>Token Baru Dibuat!</b>\n\n` +
      `Token: <code>${token}</code>\n\n` +
      `Kirim token ini ke user yang ingin diberi akses.\n` +
      `Token hanya bisa dipakai oleh <b>1 orang</b>.`,
    adminKeyboard()
  );
});

// Lihat token aktif
bot.action("admin_list_tokens", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan admin.");
  await ctx.answerCbQuery();
  if (accessTokens.size === 0) {
    return ctx.replyWithHTML(`📋 <b>Belum ada token.</b>`, adminKeyboard());
  }
  let text = `📋 <b>Daftar Token (${accessTokens.size})</b>\n\n`;
  let i = 1;
  for (const [token, info] of accessTokens.entries()) {
    const status = info.usedBy ? `✅ Dipakai (ID: ${info.usedBy})` : "⏳ Belum dipakai";
    text += `${i}. <code>${token}</code>\n   ${status}\n\n`;
    i++;
  }
  ctx.replyWithHTML(text, adminKeyboard());
});

// Cabut token — minta input
bot.action("admin_revoke_menu", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan admin.");
  await ctx.answerCbQuery();
  getState(ctx.chat.id).awaitingRevoke = true;
  ctx.replyWithHTML(
    `🚫 <b>Cabut Token</b>\n\nKirim token yang ingin dicabut (format: <code>TKN-XXXX-XXXX</code>):`
  );
});

// Lihat user aktif
bot.action("admin_list_users", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("❌ Bukan admin.");
  await ctx.answerCbQuery();
  const users = [...authorizedUsers];
  let text = `👥 <b>User Aktif (${users.length})</b>\n\n`;
  users.forEach((uid, i) => {
    text += `${i + 1}. <code>${uid}</code>${uid === ADMIN_ID ? " 👑 Admin" : ""}\n`;
  });
  ctx.replyWithHTML(text, adminKeyboard());
});

// ============================================================
//  TEXT HANDLER (token input & cabut token)
// ============================================================
bot.on("text", (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  // Admin: cabut token
  if (isAdmin(userId)) {
    const state = getState(ctx.chat.id);
    if (state.awaitingRevoke) {
      state.awaitingRevoke = false;
      const token = text.toUpperCase();
      if (accessTokens.has(token)) {
        const info = accessTokens.get(token);
        // Cabut akses user yang pakai token ini
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

  // Fallback
  ctx.replyWithHTML(`Gunakan tombol di bawah:`, mainMenuKeyboard(userId));
});

// ============================================================
//  START
// ============================================================
bot.launch(() => {
  console.log("Bot berjalan...");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
