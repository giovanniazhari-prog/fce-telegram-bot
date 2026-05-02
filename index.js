require("dotenv").config();

  const { Telegraf, Markup } = require("telegraf");
  const fetch = require("node-fetch");

  // ============================================================
  //  KONFIGURASI
  // ============================================================
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const TMAIL_BASE = "https://free-temp-mail.eu.org";

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
    "free-temp-mail.eu.org",
    "sam1.eu.org",
    "temporaryemail.dpdns.org",
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
  //  FREE-TEMP-MAIL SESSION MANAGEMENT
  // ============================================================

  /**
   * Inisialisasi sesi baru untuk pengguna: GET homepage → ambil cookies + CSRF + snapshot Livewire
   */
  async function initSession() {
    const res = await fetch(`${TMAIL_BASE}/`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html",
      },
      redirect: "follow",
    });
    const html = await res.text();

    // Ambil cookies dari response
    const rawCookies = res.headers.raw?.()["set-cookie"] || [];
    let xsrfRaw = "";
    let sessionVal = "";
    for (const c of rawCookies) {
      const xsrfMatch = c.match(/^XSRF-TOKEN=([^;]+)/);
      const sessMatch = c.match(/^tmail_session=([^;]+)/);
      if (xsrfMatch) xsrfRaw = xsrfMatch[1];
      if (sessMatch) sessionVal = sessMatch[1];
    }

    // Ambil snapshot Livewire frontend.actions
    const lwMatch = html.match(/wire:snapshot="([^"]+)"/);
    if (!lwMatch) throw new Error("Tidak bisa menemukan Livewire snapshot");
    const snapshot = JSON.parse(lwMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

    return {
      xsrfRaw,
      xsrfDecoded: decodeURIComponent(xsrfRaw),
      sessionVal,
      snapshot,
      cookieHeader: `XSRF-TOKEN=${xsrfRaw}; tmail_session=${sessionVal}`,
    };
  }

  /**
   * Panggil Livewire update endpoint
   */
  async function livewireUpdate(session, snapshot, updates, calls, referer = "/") {
    const payload = {
      components: [{
        snapshot: JSON.stringify(snapshot),
        updates,
        calls,
      }],
    };

    const res = await fetch(`${TMAIL_BASE}/livewire/update`, {
      method: "POST",
      headers: {
        Cookie: session.cookieHeader,
        "X-XSRF-TOKEN": session.xsrfDecoded,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        Referer: `${TMAIL_BASE}${referer}`,
        "X-Livewire": "true",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Livewire error: ${res.status}`);
    const data = await res.json();
    const comp = data.components?.[0];
    if (!comp) throw new Error("Respons Livewire tidak valid");
    return {
      snapshot: JSON.parse(comp.snapshot),
      effects: comp.effects || {},
    };
  }

  /**
   * Ambil snapshot frontend.app dari halaman /mailbox
   */
  async function getMailboxSnapshot(session) {
    const res = await fetch(`${TMAIL_BASE}/mailbox`, {
      headers: {
        Cookie: session.cookieHeader,
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html",
      },
    });
    const html = await res.text();

    const lwMatches = html.match(/wire:snapshot="([^"]+)"/g) || [];
    for (const m of lwMatches) {
      const encoded = m.replace('wire:snapshot="', '').slice(0, -1);
      const decoded = encoded.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const parsed = JSON.parse(decoded);
      if (parsed.memo?.name === "frontend.app") return parsed;
    }
    return null;
  }

  // ============================================================
  //  BUAT EMAIL BARU
  // ============================================================
  async function createEmailForUser(chatId, domain) {
    stopPolling(chatId);
    const state = getState(chatId);

    // Inisialisasi sesi HTTP baru per user
    const session = await initSession();
    const username = generateHumanName();
    const chosenDomain = domain || randomDomain();

    // Panggil Livewire create
    const result = await livewireUpdate(
      session,
      session.snapshot,
      { user: username, domain: chosenDomain },
      [{ path: "", method: "create", params: [] }],
      "/"
    );

    const email = result.snapshot.data?.email;
    if (!email) return { success: false, message: "Gagal membuat email" };

    // Simpan state
    state.email = email;
    state.session = session;
    state.seenMessageIds = new Set();
    state.lastOtp = null;

    // Mulai auto polling
    startAutoPolling(chatId, email);

    return { success: true, email };
  }

  // ============================================================
  //  CEK INBOX (ambil pesan dari Livewire frontend.app)
  // ============================================================
  async function fetchInbox(chatId) {
    const state = getState(chatId);
    if (!state.email || !state.session) return { success: false, messages: [] };

    try {
      // Perbarui snapshot frontend.app dari halaman mailbox
      const appSnap = await getMailboxSnapshot(state.session);
      if (!appSnap) return { success: false, messages: [] };

      const result = await livewireUpdate(
        state.session,
        appSnap,
        {},
        [{ path: "", method: "fetch", params: [] }],
        "/mailbox"
      );

      const rawMessages = result.snapshot.data?.messages;
      const messages = Array.isArray(rawMessages?.[0]) ? rawMessages[0] : [];
      return { success: true, messages };
    } catch (e) {
      return { success: false, messages: [] };
    }
  }

  // ============================================================
  //  DETEKSI OTP DARI ISI PESAN
  // ============================================================
  function extractOtp(text) {
    if (!text) return null;
    const patterns = [
      /\b(\d{4,8})\b/,
      /OTP[^\d]*(\d{4,8})/i,
      /kode[^\d]*(\d{4,8})/i,
      /code[^\d]*(\d{4,8})/i,
      /verifikasi[^\d]*(\d{4,8})/i,
      /verification[^\d]*(\d{4,8})/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1];
    }
    return null;
  }

  // ============================================================
  //  AUTO POLLING
  // ============================================================
  function startAutoPolling(chatId, email) {
    stopPolling(chatId);

    const state = getState(chatId);
    state.seenMessageIds = new Set();
    state.lastOtp = null;

    const maxDuration = 24 * 60 * 60 * 1000;
    const startTime = Date.now();
    const pollInterval = 8000;

    const timer = setInterval(async () => {
      if (Date.now() - startTime > maxDuration) { stopPolling(chatId); return; }

      const cs = getState(chatId);
      if (cs.email !== email) { stopPolling(chatId); return; }
      if (!cs.pollingTimer) return;

      try {
        const { success, messages } = await fetchInbox(chatId);
        if (!success) return;

        for (const msg of messages) {
          const mid = msg.id || msg.email_id || `${msg.from}-${msg.subject}`;
          if (!cs.seenMessageIds.has(mid)) {
            cs.seenMessageIds.add(mid);
            const time = msg.created_at || msg.date || msg.receivedAt;
            await bot.telegram.sendMessage(chatId,
              `📩 <b>Email Baru Masuk!</b>\n\n` +
              `📧 <code>${email}</code>\n\n` +
              `<b>Dari:</b> ${escapeHtml(msg.from || "-")}\n` +
              `<b>Subjek:</b> ${escapeHtml(truncate(msg.subject || "(tanpa subjek)", 80))}\n` +
              (time ? `<b>Waktu:</b> ${new Date(time).toLocaleString("id-ID")}\n` : ""),
              { parse_mode: "HTML", ...inboxKeyboard() }
            );

            // Cek OTP dari subject + body
            const bodyText = msg.body || msg.text || msg.content || "";
            const otpText = `${msg.subject || ""} ${bodyText}`;
            const otp = extractOtp(otpText);
            if (otp && otp !== cs.lastOtp) {
              cs.lastOtp = otp;
              await bot.telegram.sendMessage(chatId,
                `🔔 <b>OTP Masuk!</b>\n\n` +
                `📧 <code>${email}</code>\n\n` +
                `Tap kode untuk menyalin:\n<code>${otp}</code>`,
                { parse_mode: "HTML", ...inboxKeyboard() }
              );
            }
          }
        }
      } catch (_) {}
    }, pollInterval);

    state.pollingTimer = timer;
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
    const rows = [["🎲 Buat Email Baru", "📋 Pilih Domain"]];
    if (isAdmin(userId)) rows.push(["⚙️ Panel Admin"]);
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
      `📌 <i>Didukung oleh free-temp-mail.eu.org</i>`,
      mainMenuKeyboard(ctx.from.id)
    );
  });

  // ============================================================
  //  HANDLER TOMBOL
  // ============================================================

  bot.hears("🏠 Menu Utama", (ctx) => {
    ctx.replyWithHTML(`🏠 <b>Menu Utama</b>`, mainMenuKeyboard(ctx.from.id));
  });

  bot.hears(["🎲 Buat Email Baru", "🆕 Buat Email Baru"], async (ctx) => {
    await ctx.replyWithHTML(`⏳ <i>Membuat email baru...</i>`);
    const r = await createEmailForUser(ctx.chat.id);
    if (!r.success) return ctx.replyWithHTML(`❌ Gagal: ${r.message}`, mainMenuKeyboard(ctx.from.id));
    ctx.replyWithHTML(
      `✅ <b>Email siap digunakan!</b>\n\n` +
      `📧 <code>${r.email}</code>\n\n` +
      `🔔 <i>Notif OTP otomatis aktif — kamu akan langsung diberitahu saat ada email atau OTP masuk.</i>`,
      inboxKeyboard()
    );
  });

  bot.hears(["📋 Pilih Domain", "📋 Ganti Domain"], (ctx) => {
    ctx.replyWithHTML(`📋 <b>Pilih domain:</b>`, domainKeyboard());
  });

  FREE_DOMAINS.forEach((domain) => {
    bot.hears(`@${domain}`, async (ctx) => {
      await ctx.replyWithHTML(`⏳ <i>Membuat email dengan domain @${domain}...</i>`);
      const r = await createEmailForUser(ctx.chat.id, domain);
      if (!r.success) return ctx.replyWithHTML(`❌ Gagal: ${r.message}`, mainMenuKeyboard(ctx.from.id));
      ctx.replyWithHTML(
        `✅ <b>Email siap digunakan!</b>\n\n` +
        `📧 <code>${r.email}</code>\n\n` +
        `🔔 <i>Notif OTP otomatis aktif.</i>`,
        inboxKeyboard()
      );
    });
  });

  // Cek Inbox (manual)
  bot.hears("📬 Cek Inbox", async (ctx) => {
    const state = getState(ctx.chat.id);
    if (!state.email) return ctx.replyWithHTML(`❌ Belum ada email aktif.`, mainMenuKeyboard(ctx.from.id));

    await ctx.replyWithHTML(`⏳ <i>Mengecek inbox...</i>`);
    const { success, messages } = await fetchInbox(ctx.chat.id);

    if (!success || messages.length === 0) {
      return ctx.replyWithHTML(
        `📭 <b>Inbox kosong</b>\n\n📧 <code>${state.email}</code>\n\nBelum ada email masuk.`,
        inboxKeyboard()
      );
    }

    let text = `📬 <b>${messages.length} pesan masuk</b>\n\n📧 <code>${state.email}</code>\n\n`;
    messages.slice(0, 5).forEach((msg, i) => {
      text += `<b>${i + 1}.</b> Dari: <i>${escapeHtml(msg.from || "-")}</i>\n`;
      text += `   Subjek: ${escapeHtml(truncate(msg.subject || "(tanpa subjek)", 60))}\n`;
      const time = msg.created_at || msg.date || msg.receivedAt;
      if (time) text += `   ${new Date(time).toLocaleString("id-ID")}\n`;
      text += "\n";
    });
    ctx.replyWithHTML(text, inboxKeyboard());
  });

  // Cek OTP (manual)
  bot.hears("🔑 Cek OTP", async (ctx) => {
    const state = getState(ctx.chat.id);
    if (!state.email) return ctx.replyWithHTML(`❌ Belum ada email aktif.`, mainMenuKeyboard(ctx.from.id));

    await ctx.replyWithHTML(`⏳ <i>Mencari OTP...</i>`);
    const { success, messages } = await fetchInbox(ctx.chat.id);

    if (!success || messages.length === 0) {
      return ctx.replyWithHTML(
        `🔍 <b>Belum ada OTP</b>\n\n📧 <code>${state.email}</code>\n\nTenang, notif OTP otomatis sudah aktif.`,
        inboxKeyboard()
      );
    }

    // Cari OTP dari semua pesan
    for (const msg of messages) {
      const bodyText = msg.body || msg.text || msg.content || "";
      const otpText = `${msg.subject || ""} ${bodyText}`;
      const otp = extractOtp(otpText);
      if (otp) {
        return ctx.replyWithHTML(
          `🔑 <b>OTP Ditemukan!</b>\n\n📧 <code>${state.email}</code>\n\nKode OTP:\n<code>${otp}</code>\n\nTap kode untuk menyalin.`,
          inboxKeyboard()
        );
      }
    }

    ctx.replyWithHTML(
      `🔍 <b>Belum ada OTP di inbox</b>\n\n📧 <code>${state.email}</code>\n\nAda ${messages.length} pesan tapi tidak ditemukan kode OTP.`,
      inboxKeyboard()
    );
  });

  // Stop Notif
  bot.hears("⛔ Stop Notif", (ctx) => {
    stopPolling(ctx.chat.id);
    ctx.replyWithHTML(
      `⛔ <b>Notifikasi otomatis dihentikan.</b>\n\nEmail kamu masih aktif, tapi notif tidak akan masuk lagi.\nTekan "Cek Inbox" untuk cek manual.`,
      inboxKeyboard()
    );
  });

  // ============================================================
  //  PANEL ADMIN
  // ============================================================
  bot.hears("⚙️ Panel Admin", (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ctx.replyWithHTML(`⚙️ <b>Panel Admin</b>`, adminKeyboard());
  });

  bot.hears("🔑 Generate Token", (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const token = generateToken();
    accessTokens.set(token, { createdAt: Date.now(), usedBy: null });
    ctx.replyWithHTML(
      `✅ <b>Token baru dibuat:</b>\n\n<code>${token}</code>\n\nBagikan token ini ke pengguna yang ingin diberikan akses.`,
      adminKeyboard()
    );
  });

  bot.hears("📋 Lihat Token", (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    if (accessTokens.size === 0) return ctx.replyWithHTML(`📋 Belum ada token.`, adminKeyboard());
    let text = `📋 <b>Daftar Token:</b>\n\n`;
    accessTokens.forEach((v, k) => {
      text += `<code>${k}</code> — ${v.usedBy ? `✅ dipakai oleh ${v.usedBy}` : "⏳ belum dipakai"}\n`;
    });
    ctx.replyWithHTML(text, adminKeyboard());
  });

  bot.hears("🚫 Cabut Token", (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ctx.replyWithHTML(`Kirim token yang ingin dicabut:`, adminKeyboard());
  });

  bot.hears("👥 Lihat User", (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const users = [...authorizedUsers].join("\n");
    ctx.replyWithHTML(`👥 <b>Pengguna aktif:</b>\n\n${users}`, adminKeyboard());
  });

  // ============================================================
  //  INFO EMAIL AKTIF
  // ============================================================
  bot.command("email", (ctx) => {
    const state = getState(ctx.chat.id);
    if (!state.email) return ctx.replyWithHTML(`❌ Belum ada email aktif.`, mainMenuKeyboard(ctx.from.id));
    ctx.replyWithHTML(
      `📧 <b>Email aktif kamu:</b>\n\n<code>${state.email}</code>\n\nTap untuk menyalin.`,
      inboxKeyboard()
    );
  });

  // ============================================================
  //  START BOT
  // ============================================================
  bot.launch()
    .then(() => console.log("Bot berjalan..."))
    .catch((err) => { console.error("Gagal menjalankan bot:", err); process.exit(1); });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
  