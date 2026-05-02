require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const fetch = require("node-fetch");

// ============================================================
//  KONFIGURASI
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN || "8673639594:AAELpPmuSEm2DT0JiNUQPOpHumY4X4QKnZk";
const FCE_API_KEY =
  process.env.FCE_API_KEY ||
  "fce_65c103c6e058441f729fa73515bde90dd3fa6f3eaaaabff51ee09685ef133829";
const FCE_BASE = "https://api2.freecustom.email/v1";

// Domain gratis
const FREE_DOMAINS = [
  "ditube.info",
  "ditplay.info",
  "ditapi.info",
  "ditcloud.info",
  "ditdrive.info",
  "ditgame.info",
  "ditlearn.info",
  "ditpay.info",
  "junkstopper.info",
  "addmy.space",
  "attachmy.site",
];

// ============================================================
//  NAMA MANUSIA (Indo + Internasional)
// ============================================================
const FIRST_NAMES = [
  // Indonesia
  "budi","siti","ahmad","dewi","rizki","andi","fitri","hendra","maya","yusuf",
  "rudi","lina","dani","bagas","ayu","dian","rama","sari","wahyu","agus",
  "rina","joko","nurul","fauzi","citra","bayu","indah","teguh","fajar","reza",
  "nisa","irwan","putri","hadi","vina","dedy","mira","ferdi","gilang","taufik",
  "rini","kevin","nanda","haris","zahra","ilham","wulan","andre","siska","bimo",
  "laila","dimas","tiara","arif","elsa","yoga","anggi","deva","nadia","raka",
  "selvi","guntur","yeni","aldi","tari","fandi","rian","desy","erwin","kiki",
  // Internasional
  "john","sarah","michael","emma","david","olivia","james","sophia","robert","ava",
  "william","charlotte","thomas","grace","harry","alice","ryan","megan","kevin","laura",
  "daniel","jessica","chris","amanda","mark","rachel","brian","melissa","paul","emily",
  "jason","ashley","eric","stephanie","adam","nicole","joshua","brittany","stephen","samantha",
  "jake","natalie","kyle","hannah","nathan","victoria","tyler","madison","sean","alexis",
];

const LAST_NAMES = [
  // Indonesia
  "santoso","kusuma","pratama","wijaya","setiawan","rahayu","permata","lestari",
  "hidayat","putra","saputra","nugroho","kurniawan","handoko","wicaksono","susanto",
  "purnama","pranata","hakim","firmansyah","gunawan","halim","budiman","suharto",
  "mulyadi","hartono","sugiarto","surya","wahyudi","ramadan","salim","iskandar",
  // Internasional
  "smith","johnson","brown","davis","wilson","anderson","taylor","thomas","jackson",
  "white","harris","martin","thompson","garcia","martinez","robinson","clark","lewis",
  "walker","hall","allen","young","king","wright","scott","green","baker","adams",
  "nelson","hill","carter","mitchell","perez","roberts","turner","phillips","campbell",
];

// Nama yang sudah dipakai (global, tidak akan berulang)
const usedNames = new Set();

function generateHumanName() {
  const maxTry = 300;
  for (let i = 0; i < maxTry; i++) {
    const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];

    // Format acak: budi.santoso / budi_santoso / budisant / budi.s92
    const formats = [
      `${first}.${last}`,
      `${first}_${last}`,
      `${first}${last}`,
      `${first}.${last[0]}${String(Math.floor(Math.random() * 90) + 10)}`,
      `${first}${String(Math.floor(Math.random() * 900) + 100)}`,
      `${first}.${last}${String(Math.floor(Math.random() * 90) + 10)}`,
    ];

    const name = formats[Math.floor(Math.random() * formats.length)];

    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  // Fallback dengan timestamp unik
  const ts = Date.now().toString(36);
  return `user.${ts}`;
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
  const state = getState(chatId);
  if (state.pollingTimer) {
    clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }
}

// ============================================================
//  FCE API
// ============================================================
async function fcePost(path, body) {
  const res = await fetch(`${FCE_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FCE_API_KEY}`,
      "Content-Type": "application/json",
    },
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
//  UTIL
// ============================================================
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(str, max = 100) {
  const s = String(str || "");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ============================================================
//  KEYBOARD
// ============================================================
function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🎲 Buat Email Baru", "create_email")],
    [Markup.button.callback("📋 Pilih Domain Sendiri", "choose_domain")],
  ]);
}

function inboxKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📬 Cek Inbox", "check_inbox"),
      Markup.button.callback("🔑 Cek OTP", "check_otp"),
    ],
    [Markup.button.callback("🔔 Auto Notif (10 menit)", "auto_otp")],
    [Markup.button.callback("🆕 Buat Email Baru", "create_email")],
    [Markup.button.callback("📋 Ganti Domain", "choose_domain")],
  ]);
}

function domainKeyboard() {
  const buttons = FREE_DOMAINS.map((d) => [
    Markup.button.callback(`@${d}`, `domain_${d}`),
  ]);
  buttons.push([Markup.button.callback("🔙 Kembali", "back_main")]);
  return Markup.inlineKeyboard(buttons);
}

function stopKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⛔ Stop Auto Notif", "stop_auto_otp")],
  ]);
}

// ============================================================
//  BUAT EMAIL (shared logic)
// ============================================================
async function createEmail(ctx, domain) {
  stopPolling(ctx.chat.id);

  const name = generateHumanName();
  const chosenDomain = domain || randomDomain();
  const email = `${name}@${chosenDomain}`;

  const result = await fcePost("/inboxes", { inbox: email });

  if (!result.success) {
    return { success: false, message: result.message };
  }

  const state = getState(ctx.chat.id);
  state.email = email;
  state.seenMessageIds = new Set();
  state.lastOtp = null;

  return { success: true, email };
}

// ============================================================
//  BOT
// ============================================================
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  stopPolling(ctx.chat.id);
  ctx.replyWithHTML(
    `👋 <b>Selamat datang di Temp Mail Bot!</b>\n\n` +
      `Buat inbox sementara instan, terima email &amp; OTP otomatis.\n\n` +
      `📌 <i>Email bertahan ±24 jam</i>`,
    mainMenuKeyboard()
  );
});

// --- Buat email acak ---
bot.action("create_email", async (ctx) => {
  await ctx.answerCbQuery();
  const r = await createEmail(ctx);
  if (!r.success) {
    return ctx.replyWithHTML(`❌ Gagal: ${r.message}`, mainMenuKeyboard());
  }
  await ctx.editMessageText(
    `✅ <b>Email siap digunakan!</b>\n\n` +
      `📧 <code>${r.email}</code>\n\n` +
      `Tap email di atas untuk menyalin. Pilih aksi:`,
    { parse_mode: "HTML", ...inboxKeyboard() }
  );
});

// --- Pilih domain ---
bot.action("choose_domain", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `📋 <b>Pilih domain:</b>`,
    { parse_mode: "HTML", ...domainKeyboard() }
  );
});

FREE_DOMAINS.forEach((domain) => {
  bot.action(`domain_${domain}`, async (ctx) => {
    await ctx.answerCbQuery();
    const r = await createEmail(ctx, domain);
    if (!r.success) {
      return ctx.replyWithHTML(`❌ Gagal: ${r.message}`, mainMenuKeyboard());
    }
    await ctx.editMessageText(
      `✅ <b>Email siap digunakan!</b>\n\n` +
        `📧 <code>${r.email}</code>\n\n` +
        `Tap email di atas untuk menyalin. Pilih aksi:`,
      { parse_mode: "HTML", ...inboxKeyboard() }
    );
  });
});

bot.action("back_main", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `🏠 <b>Menu Utama</b>`,
    { parse_mode: "HTML", ...mainMenuKeyboard() }
  );
});

// --- Cek Inbox ---
bot.action("check_inbox", async (ctx) => {
  await ctx.answerCbQuery("Mengecek inbox...");
  const state = getState(ctx.chat.id);

  if (!state.email) {
    return ctx.replyWithHTML(`❌ Belum ada email aktif.`, mainMenuKeyboard());
  }

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
    text += `   ${time ? new Date(time).toLocaleString("id-ID") : ""}\n\n`;
  });

  ctx.replyWithHTML(text, inboxKeyboard());
});

// --- Cek OTP manual ---
bot.action("check_otp", async (ctx) => {
  await ctx.answerCbQuery("Mencari OTP...");
  const state = getState(ctx.chat.id);

  if (!state.email) {
    return ctx.replyWithHTML(`❌ Belum ada email aktif.`, mainMenuKeyboard());
  }

  const result = await fceGet(`/inboxes/${state.email}/otp`);

  if (!result.success || !result.otp) {
    return ctx.replyWithHTML(
      `🔍 <b>Belum ada OTP</b>\n\n📧 <code>${state.email}</code>\n\n` +
        `Gunakan <b>🔔 Auto Notif</b> agar bot otomatis kirim OTP saat masuk.`,
      inboxKeyboard()
    );
  }

  ctx.replyWithHTML(
    `🔑 <b>OTP Ditemukan!</b>\n\n📧 <code>${state.email}</code>\n\n` +
      `Kode OTP:\n<code>${result.otp}</code>\n\n` +
      `Tap kode untuk menyalin.`,
    inboxKeyboard()
  );
});

// --- Auto Notif: deteksi email masuk + OTP otomatis ---
bot.action("auto_otp", async (ctx) => {
  await ctx.answerCbQuery("Auto Notif aktif!");
  const state = getState(ctx.chat.id);

  if (!state.email) {
    return ctx.replyWithHTML(`❌ Belum ada email aktif.`, mainMenuKeyboard());
  }

  stopPolling(ctx.chat.id);
  state.seenMessageIds = state.seenMessageIds || new Set();
  state.lastOtp = state.lastOtp || null;

  const email = state.email;
  const chatId = ctx.chat.id;
  const maxDuration = 10 * 60 * 1000; // 10 menit
  const pollInterval = 4 * 1000;       // 4 detik
  const startTime = Date.now();

  await ctx.replyWithHTML(
    `🔔 <b>Auto Notif Aktif</b>\n\n📧 <code>${email}</code>\n\n` +
      `Bot akan kirim notif otomatis:\n` +
      `• Saat ada email baru masuk\n` +
      `• Saat OTP terdeteksi (langsung bisa dicopy)\n\n` +
      `⏱ Aktif selama <b>10 menit</b>`,
    stopKeyboard()
  );

  const timer = setInterval(async () => {
    // Hentikan otomatis setelah 10 menit
    if (Date.now() - startTime > maxDuration) {
      stopPolling(chatId);
      bot.telegram.sendMessage(
        chatId,
        `⏰ <b>Auto Notif selesai</b> (10 menit habis)\n\n📧 <code>${email}</code>`,
        { parse_mode: "HTML", ...inboxKeyboard() }
      );
      return;
    }

    try {
      const currentState = getState(chatId);
      // Pastikan masih email yang sama (user belum ganti email)
      if (currentState.email !== email) {
        stopPolling(chatId);
        return;
      }

      // --- Cek pesan baru ---
      const msgResult = await fceGet(`/inboxes/${email}/messages`);
      if (msgResult.success && msgResult.data && msgResult.data.length > 0) {
        for (const msg of msgResult.data) {
          const msgId = msg.id || msg.messageId || `${msg.from}-${msg.subject}-${msg.receivedAt}`;
          if (!currentState.seenMessageIds.has(msgId)) {
            currentState.seenMessageIds.add(msgId);

            // Kirim notif email baru
            const time = msg.receivedAt || msg.date;
            await bot.telegram.sendMessage(
              chatId,
              `📩 <b>Email Baru Masuk!</b>\n\n` +
                `📧 <code>${email}</code>\n\n` +
                `<b>Dari:</b> ${escapeHtml(msg.from || "-")}\n` +
                `<b>Subjek:</b> ${escapeHtml(truncate(msg.subject || "(tanpa subjek)", 80))}\n` +
                (time ? `<b>Waktu:</b> ${new Date(time).toLocaleString("id-ID")}\n` : "") +
                `\n🔍 <i>Sedang mencari OTP...</i>`,
              { parse_mode: "HTML" }
            );
          }
        }
      }

      // --- Cek OTP baru ---
      const otpResult = await fceGet(`/inboxes/${email}/otp`);
      if (otpResult.success && otpResult.otp && otpResult.otp !== currentState.lastOtp) {
        currentState.lastOtp = otpResult.otp;
        await bot.telegram.sendMessage(
          chatId,
          `🔔 <b>OTP Otomatis Terdeteksi!</b>\n\n📧 <code>${email}</code>\n\n` +
            `Tap kode di bawah untuk menyalin:\n<code>${otpResult.otp}</code>`,
          { parse_mode: "HTML", ...inboxKeyboard() }
        );
      }
    } catch (e) {
      // abaikan error jaringan sementara
    }
  }, pollInterval);

  getState(chatId).pollingTimer = timer;
});

// --- Stop Auto Notif ---
bot.action("stop_auto_otp", async (ctx) => {
  await ctx.answerCbQuery("Auto Notif dihentikan.");
  stopPolling(ctx.chat.id);
  const state = getState(ctx.chat.id);
  ctx.replyWithHTML(
    `⛔ <b>Auto Notif dihentikan.</b>\n\n📧 <code>${state.email || "-"}</code>`,
    inboxKeyboard()
  );
});

// --- Fallback ---
bot.on("text", (ctx) => {
  ctx.replyWithHTML(`Gunakan tombol di bawah:`, mainMenuKeyboard());
});

// ============================================================
//  START
// ============================================================
bot.launch(() => {
  console.log("Bot berjalan...");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
