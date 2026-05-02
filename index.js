require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const fetch = require("node-fetch");

// ============================================================
//  KONFIGURASI — edit di sini atau lewat environment variable
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN || "8673639594:AAELpPmuSEm2DT0JiNUQPOpHumY4X4QKnZk";
const FCE_API_KEY =
  process.env.FCE_API_KEY ||
  "fce_65c103c6e058441f729fa73515bde90dd3fa6f3eaaaabff51ee09685ef133829";
const FCE_BASE = "https://api2.freecustom.email/v1";

// Domain gratis yang tersedia
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
//  STATE PER USER (in-memory)
// ============================================================
const userState = new Map();
// { chatId: { email, pollingTimer } }

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
//  HELPER: FCE API
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

function randomName(length = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
}

function randomDomain() {
  return FREE_DOMAINS[Math.floor(Math.random() * FREE_DOMAINS.length)];
}

// ============================================================
//  KEYBOARD HELPERS
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
    [Markup.button.callback("🔄 Auto OTP (5 menit)", "auto_otp")],
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

// ============================================================
//  BOT
// ============================================================
const bot = new Telegraf(BOT_TOKEN);

// --- /start ---
bot.start((ctx) => {
  stopPolling(ctx.chat.id);
  ctx.replyWithHTML(
    `👋 <b>Selamat datang di Email Temp Bot!</b>\n\n` +
      `Bot ini menggunakan <b>FreeCustom.Email</b> untuk membuat inbox sementara.\n\n` +
      `📌 <i>Email bertahan ±24 jam • OTP diekstrak otomatis</i>`,
    mainMenuKeyboard()
  );
});

// --- Buat email acak ---
bot.action("create_email", async (ctx) => {
  await ctx.answerCbQuery();
  stopPolling(ctx.chat.id);

  const name = randomName();
  const domain = randomDomain();
  const email = `${name}@${domain}`;

  const result = await fcePost("/inboxes", { inbox: email });

  if (!result.success) {
    return ctx.replyWithHTML(
      `❌ Gagal membuat email: ${result.message}`,
      mainMenuKeyboard()
    );
  }

  getState(ctx.chat.id).email = email;

  await ctx.editMessageText(
    `✅ <b>Email berhasil dibuat!</b>\n\n` +
      `📧 <code>${email}</code>\n\n` +
      `Klik email di atas untuk menyalinnya. Pilih aksi:`,
    { parse_mode: "HTML", ...inboxKeyboard() }
  );
});

// --- Pilih domain ---
bot.action("choose_domain", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `📋 <b>Pilih domain untuk email kamu:</b>\n\n` +
      `Nama username akan dibuat secara acak.`,
    { parse_mode: "HTML", ...domainKeyboard() }
  );
});

// --- Pilih domain spesifik ---
FREE_DOMAINS.forEach((domain) => {
  bot.action(`domain_${domain}`, async (ctx) => {
    await ctx.answerCbQuery();
    stopPolling(ctx.chat.id);

    const name = randomName();
    const email = `${name}@${domain}`;

    const result = await fcePost("/inboxes", { inbox: email });

    if (!result.success) {
      return ctx.replyWithHTML(
        `❌ Gagal membuat email: ${result.message}`,
        mainMenuKeyboard()
      );
    }

    getState(ctx.chat.id).email = email;

    await ctx.editMessageText(
      `✅ <b>Email berhasil dibuat!</b>\n\n` +
        `📧 <code>${email}</code>\n\n` +
        `Klik email di atas untuk menyalinnya. Pilih aksi:`,
      { parse_mode: "HTML", ...inboxKeyboard() }
    );
  });
});

// --- Kembali ke menu utama ---
bot.action("back_main", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `🏠 <b>Menu Utama</b>\n\nPilih aksi:`,
    { parse_mode: "HTML", ...mainMenuKeyboard() }
  );
});

// --- Cek Inbox ---
bot.action("check_inbox", async (ctx) => {
  await ctx.answerCbQuery("Mengecek inbox...");
  const state = getState(ctx.chat.id);

  if (!state.email) {
    return ctx.reply("❌ Belum ada email aktif. Buat email dulu!", mainMenuKeyboard());
  }

  const result = await fceGet(`/inboxes/${state.email}/messages`);

  if (!result.success || result.count === 0) {
    return ctx.replyWithHTML(
      `📭 <b>Inbox kosong</b>\n\n` +
        `📧 <code>${state.email}</code>\n\n` +
        `Belum ada email masuk.`,
      inboxKeyboard()
    );
  }

  let text = `📬 <b>Inbox: ${result.count} pesan</b>\n\n📧 <code>${state.email}</code>\n\n`;

  result.data.slice(0, 5).forEach((msg, i) => {
    text += `${i + 1}. <b>Dari:</b> ${escapeHtml(msg.from || "-")}\n`;
    text += `   <b>Subjek:</b> ${escapeHtml(msg.subject || "(tanpa subjek)")}\n`;
    text += `   <b>Waktu:</b> ${new Date(msg.receivedAt || msg.date).toLocaleString("id-ID")}\n\n`;
  });

  ctx.replyWithHTML(text, inboxKeyboard());
});

// --- Cek OTP ---
bot.action("check_otp", async (ctx) => {
  await ctx.answerCbQuery("Mencari OTP...");
  const state = getState(ctx.chat.id);

  if (!state.email) {
    return ctx.reply("❌ Belum ada email aktif. Buat email dulu!", mainMenuKeyboard());
  }

  const result = await fceGet(`/inboxes/${state.email}/otp`);

  if (!result.success || !result.otp) {
    return ctx.replyWithHTML(
      `🔍 <b>Tidak ada OTP ditemukan</b>\n\n` +
        `📧 <code>${state.email}</code>\n\n` +
        `Coba gunakan <b>Auto OTP</b> agar bot otomatis mendeteksi saat OTP masuk.`,
      inboxKeyboard()
    );
  }

  ctx.replyWithHTML(
    `🔑 <b>OTP Ditemukan!</b>\n\n` +
      `📧 <code>${state.email}</code>\n\n` +
      `Kode OTP kamu:\n<code>${result.otp}</code>\n\n` +
      `Klik kode di atas untuk menyalin.`,
    inboxKeyboard()
  );
});

// --- Auto OTP ---
bot.action("auto_otp", async (ctx) => {
  await ctx.answerCbQuery("Auto OTP aktif!");
  const state = getState(ctx.chat.id);

  if (!state.email) {
    return ctx.reply("❌ Belum ada email aktif. Buat email dulu!", mainMenuKeyboard());
  }

  stopPolling(ctx.chat.id);

  const email = state.email;
  const chatId = ctx.chat.id;
  const maxDuration = 5 * 60 * 1000; // 5 menit
  const interval = 5 * 1000; // 5 detik
  const startTime = Date.now();

  await ctx.replyWithHTML(
    `🔄 <b>Auto OTP Aktif</b>\n\n` +
      `📧 <code>${email}</code>\n\n` +
      `Bot akan otomatis mengirim OTP saat email masuk.\n` +
      `⏱ Berlaku selama <b>5 menit</b>.`,
    Markup.inlineKeyboard([
      [Markup.button.callback("⛔ Stop Auto OTP", "stop_auto_otp")],
    ])
  );

  const timer = setInterval(async () => {
    if (Date.now() - startTime > maxDuration) {
      stopPolling(chatId);
      bot.telegram.sendMessage(
        chatId,
        `⏰ Auto OTP selesai (5 menit habis).\n\n📧 <code>${email}</code>`,
        { parse_mode: "HTML", ...inboxKeyboard() }
      );
      return;
    }

    try {
      const result = await fceGet(`/inboxes/${email}/otp`);
      if (result.success && result.otp) {
        stopPolling(chatId);
        bot.telegram.sendMessage(
          chatId,
          `🔔 <b>OTP Masuk Otomatis!</b>\n\n` +
            `📧 <code>${email}</code>\n\n` +
            `Kode OTP kamu:\n<code>${result.otp}</code>\n\n` +
            `Klik kode di atas untuk menyalin.`,
          { parse_mode: "HTML", ...inboxKeyboard() }
        );
      }
    } catch (e) {
      // abaikan error jaringan, lanjut polling
    }
  }, interval);

  getState(chatId).pollingTimer = timer;
});

// --- Stop Auto OTP ---
bot.action("stop_auto_otp", async (ctx) => {
  await ctx.answerCbQuery("Auto OTP dihentikan.");
  stopPolling(ctx.chat.id);
  const state = getState(ctx.chat.id);
  ctx.replyWithHTML(
    `⛔ <b>Auto OTP dihentikan.</b>\n\n📧 <code>${state.email || "-"}</code>`,
    inboxKeyboard()
  );
});

// --- Fallback pesan biasa ---
bot.on("text", (ctx) => {
  ctx.replyWithHTML(
    `👋 Gunakan tombol di bawah untuk memulai:`,
    mainMenuKeyboard()
  );
});

// ============================================================
//  UTIL
// ============================================================
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ============================================================
//  START
// ============================================================
bot.launch(() => {
  console.log("Bot berjalan...");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
