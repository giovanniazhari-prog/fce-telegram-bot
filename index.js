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
  ];

  const LAST_NAMES = [
    "santoso","kusuma","pratama","wijaya","setiawan","rahayu","permata","lestari",
    "hidayat","putra","saputra","nugroho","kurniawan","handoko","wicaksono","susanto",
    "purnama","pranata","hakim","firmansyah","gunawan","halim","budiman","suharto",
    "mulyadi","hartono","sugiarto","surya","wahyudi","ramadan","salim","iskandar",
    "smith","johnson","brown","davis","wilson","anderson","taylor","thomas","jackson",
    "white","harris","martin","thompson","garcia","martinez","robinson","clark","lewis",
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
      if (!usedNames.has(name)) { usedNames.add(name); return name; }
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
  //  HELPER: Extract cookies dari response headers (node-fetch v2 compatible)
  // ============================================================
  function extractCookies(headers) {
    // node-fetch v2: headers.raw() returns { 'set-cookie': [...] }
    // Fallback: headers.get returns first value only
    let cookies = [];
    try {
      if (typeof headers.raw === 'function') {
        const raw = headers.raw();
        cookies = raw['set-cookie'] || [];
      }
    } catch (_) {}
    
    if (cookies.length === 0) {
      // Manual fallback: iterate all header entries
      const combined = headers.get('set-cookie') || '';
      if (combined) cookies = [combined];
    }
    
    let xsrfRaw = "";
    let sessionVal = "";
    for (const c of cookies) {
      const parts = c.split(';');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith('XSRF-TOKEN=')) xsrfRaw = trimmed.slice('XSRF-TOKEN='.length);
        if (trimmed.startsWith('tmail_session=')) sessionVal = trimmed.slice('tmail_session='.length);
      }
    }
    return { xsrfRaw, sessionVal };
  }

  // ============================================================
  //  FREE-TEMP-MAIL SESSION MANAGEMENT
  // ============================================================
  async function initSession() {
    const res = await fetch(`${TMAIL_BASE}/`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html",
      },
      redirect: "follow",
    });
    const html = await res.text();

    const { xsrfRaw, sessionVal } = extractCookies(res.headers);
    console.log(`[initSession] xsrf=${xsrfRaw ? 'OK' : 'EMPTY'} session=${sessionVal ? 'OK' : 'EMPTY'}`);

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

    if (!res.ok) {
      const body = await res.text();
      console.log(`[livewireUpdate] ERROR ${res.status}: ${body.slice(0, 300)}`);
      throw new Error(`Livewire error: ${res.status}`);
    }
    
    // Update cookies jika server mengirim cookie baru
    const { xsrfRaw, sessionVal } = extractCookies(res.headers);
    if (xsrfRaw) { session.xsrfRaw = xsrfRaw; session.xsrfDecoded = decodeURIComponent(xsrfRaw); }
    if (sessionVal) session.sessionVal = sessionVal;
    if (xsrfRaw || sessionVal) {
      session.cookieHeader = `XSRF-TOKEN=${session.xsrfRaw}; tmail_session=${session.sessionVal}`;
    }

    const data = await res.json();
    const comp = data.components?.[0];
    if (!comp) throw new Error("Respons Livewire tidak valid");
    return {
      snapshot: JSON.parse(comp.snapshot),
      effects: comp.effects || {},
    };
  }

  async function getMailboxSnapshot(session) {
    const res = await fetch(`${TMAIL_BASE}/mailbox`, {
      headers: {
        Cookie: session.cookieHeader,
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html",
      },
    });
    const html = await res.text();
    
    // Update cookies dari response mailbox juga
    const { xsrfRaw, sessionVal } = extractCookies(res.headers);
    if (xsrfRaw) { session.xsrfRaw = xsrfRaw; session.xsrfDecoded = decodeURIComponent(xsrfRaw); }
    if (sessionVal) session.sessionVal = sessionVal;
    if (xsrfRaw || sessionVal) {
      session.cookieHeader = `XSRF-TOKEN=${session.xsrfRaw}; tmail_session=${session.sessionVal}`;
    }

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

    const session = await initSession();
    const username = generateHumanName();
    const chosenDomain = domain || randomDomain();

    const result = await livewireUpdate(
      session,
      session.snapshot,
      { user: username, domain: chosenDomain },
      [{ path: "", method: "create", params: [] }],
      "/"
    );

    const email = result.snapshot.data?.email;
    console.log(`[createEmail] email=${email} user=${username} domain=${chosenDomain}`);
    if (!email) return { success: false, message: "Gagal membuat email" };

    state.email = email;
    state.session = session;
    state.seenMessageIds = new Set();
    state.lastOtp = null;

    startAutoPolling(chatId, email);
    return { success: true, email };
  }

  // ============================================================
  //  CEK INBOX
  // ============================================================
  async function fetchInbox(chatId) {
    const state = getState(chatId);
    if (!state.email || !state.session) return { success: false, messages: [] };

    try {
      const appSnap = await getMailboxSnapshot(state.session);
      if (!appSnap) {
        console.log(`[fetchInbox] chatId=${chatId} getMailboxSnapshot returned null`);
        return { success: false, messages: [] };
      }

      const result = await livewireUpdate(
        state.session,
        appSnap,
        {},
        [{ path: "", method: "fetch", params: [] }],
        "/mailbox"
      );

      const rawMessages = result.snapshot.data?.messages;
      const messages = Array.isArray(rawMessages?.[0]) ? rawMessages[0] : [];
      
      if (messages.length > 0) {
        console.log(`[fetchInbox] chatId=${chatId} found ${messages.length} msg(s). First msg keys: ${Object.keys(messages[0]).join(',')}`);
        console.log(`[fetchInbox] First msg RAW: ${JSON.stringify(messages[0])}`);
      }
      
      return { success: true, messages };
    } catch (e) {
      console.log(`[fetchInbox] ERROR chatId=${chatId}: ${e.message}`);
      return { success: false, messages: [] };
    }
  }

  // ============================================================
  //  HELPER: Ambil field pesan dengan multiple fallback
  // ============================================================
  function getMsgField(msg, ...keys) {
    for (const k of keys) {
      if (msg[k] !== undefined && msg[k] !== null && msg[k] !== '') return msg[k];
    }
    return null;
  }

  // ============================================================
  //  DETEKSI OTP
  // ============================================================
  function extractOtp(text) {
    if (!text) return null;
    // Prioritas: pola OTP eksplisit dulu
    const explicit = [
      /(?:OTP|kode|code|pin|password|token|verif(?:ication|ikasi)?)[^\d]{0,20}(\d{4,8})/i,
      /(\d{4,8})(?:[^\d]{0,20}(?:OTP|kode|code|pin|verif))/i,
      /\b(\d{6})\b/,   // 6-digit paling umum untuk OTP
      /\b(\d{4})\b/,   // 4-digit
      /\b(\d{8})\b/,   // 8-digit
      /\b(\d{5})\b/,   // 5-digit
      /\b(\d{7})\b/,   // 7-digit
    ];
    for (const p of explicit) {
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
          // Coba semua kemungkinan field ID
          const mid = getMsgField(msg, 'id','email_id','mail_id','uid','message_id') 
            || `${getMsgField(msg,'from','sender','from_address','from_email') || ''}-${getMsgField(msg,'subject','title','email_subject') || ''}`;
          
          if (!cs.seenMessageIds.has(String(mid))) {
            cs.seenMessageIds.add(String(mid));
            
            // Ambil fields dengan fallback lengkap
            const from = getMsgField(msg, 'from','sender','from_address','from_email','reply_to') || '-';
            const subject = getMsgField(msg, 'subject','title','email_subject','Subject') || '(tanpa subjek)';
            const body = getMsgField(msg, 'body','html','text','body_html','html_body','text_body','content','message','plain') || '';
            const time = getMsgField(msg, 'created_at','date','receivedAt','received_at','timestamp','time');

            await bot.telegram.sendMessage(chatId,
              `📩 <b>Email Baru Masuk!</b>\n\n` +
              `📧 <code>${email}</code>\n\n` +
              `<b>Dari:</b> ${escapeHtml(from)}\n` +
              `<b>Subjek:</b> ${escapeHtml(truncate(subject, 80))}\n` +
              (time ? `<b>Waktu:</b> ${new Date(time).toLocaleString("id-ID")}\n` : ""),
              { parse_mode: "HTML", ...inboxKeyboard() }
            );

            // Deteksi OTP dari subject + body
            const otpText = `${subject} ${body}`;
            const otp = extractOtp(otpText);
            if (otp && otp !== cs.lastOtp) {
              cs.lastOtp = otp;
              await bot.telegram.sendMessage(chatId,
                `🔔 <b>OTP Terdeteksi!</b>\n\n` +
                `📧 <code>${email}</code>\n\n` +
                `Tap untuk menyalin:\n<code>${otp}</code>`,
                { parse_mode: "HTML", ...inboxKeyboard() }
              );
            }
          }
        }
      } catch (e) {
        console.log(`[polling] ERROR chatId=${chatId}: ${e.message}`);
      }
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
  //  KEYBOARDS
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
  //  BOT INIT
  // ============================================================
  const bot = new Telegraf(BOT_TOKEN);

  // ============================================================
  //  MIDDLEWARE: Cek akses
  // ============================================================
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const uid = ctx.from.id;

    if (awaitingToken.has(uid)) return next();
    if (isAuthorized(uid)) return next();

    if (ctx.message?.text?.toUpperCase().startsWith("TKN-")) {
      return next();
    }

    await ctx.reply(
      "⛔ Akses ditolak.\n\nKamu belum terdaftar. Masukkan token akses yang kamu dapat dari admin:",
      Markup.forceReply()
    );
    awaitingToken.add(uid);
  });

  // ============================================================
  //  COMMANDS
  // ============================================================
  bot.start(async (ctx) => {
    const uid = ctx.from.id;
    await ctx.reply(
      `👋 Halo <b>${escapeHtml(ctx.from.first_name)}</b>!\n\n` +
      `Bot email sementara siap digunakan.\n` +
      `Tekan <b>Buat Email Baru</b> untuk mulai.`,
      { parse_mode: "HTML", ...mainMenuKeyboard(uid) }
    );
  });

  bot.help(async (ctx) => {
    await ctx.reply(
      "📖 <b>Panduan Bot Email Sementara</b>\n\n" +
      "🎲 <b>Buat Email Baru</b> - Buat alamat email acak\n" +
      "📋 <b>Pilih Domain</b> - Pilih domain untuk email baru\n" +
      "📬 <b>Cek Inbox</b> - Lihat pesan masuk\n" +
      "🔑 <b>Cek OTP</b> - Deteksi OTP dari pesan terakhir\n" +
      "⛔ <b>Stop Notif</b> - Hentikan polling otomatis\n\n" +
      "Bot akan otomatis memberi tahu kamu saat ada email masuk!",
      { parse_mode: "HTML", ...mainMenuKeyboard(ctx.from.id) }
    );
  });

  // ============================================================
  //  HANDLER: Buat Email Baru
  // ============================================================
  async function handleCreateEmail(ctx, domain = null) {
    const chatId = ctx.chat.id;
    const msg = await ctx.reply("⏳ Membuat email baru...");

    try {
      const { success, email, message } = await createEmailForUser(chatId, domain);
      await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});

      if (!success) {
        await ctx.reply(`❌ ${message}`, mainMenuKeyboard(ctx.from.id));
        return;
      }

      await ctx.reply(
        `✅ <b>Email siap digunakan!</b>\n\n` +
        `📧 <code>${email}</code>\n\n` +
        `🔔 Notif OTP otomatis aktif.\n` +
        `Bot akan memberi tahu saat ada email masuk.`,
        { parse_mode: "HTML", ...inboxKeyboard() }
      );
    } catch (e) {
      console.log(`[handleCreateEmail] ERROR: ${e.message}`);
      await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
      await ctx.reply(`❌ Gagal membuat email: ${e.message}`, mainMenuKeyboard(ctx.from.id));
    }
  }

  // ============================================================
  //  HANDLER: Cek Inbox
  // ============================================================
  async function handleCheckInbox(ctx) {
    const chatId = ctx.chat.id;
    const state = getState(chatId);

    if (!state.email) {
      await ctx.reply("❌ Belum ada email aktif. Buat email baru dulu.", mainMenuKeyboard(ctx.from.id));
      return;
    }

    const msg = await ctx.reply("⏳ Memeriksa inbox...");
    const { success, messages } = await fetchInbox(chatId);
    await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});

    if (!success) {
      await ctx.reply("❌ Gagal mengambil inbox. Coba lagi.", inboxKeyboard());
      return;
    }

    if (messages.length === 0) {
      await ctx.reply(
        `📭 <b>Inbox Kosong</b>\n\n📧 <code>${state.email}</code>\n\nBelum ada email masuk.`,
        { parse_mode: "HTML", ...inboxKeyboard() }
      );
      return;
    }

    for (const msg of messages) {
      const from = getMsgField(msg, 'from','sender','from_address','from_email','reply_to') || '-';
      const subject = getMsgField(msg, 'subject','title','email_subject','Subject') || '(tanpa subjek)';
      const body = getMsgField(msg, 'body','html','text','body_html','html_body','text_body','content','message','plain') || '';
      const time = getMsgField(msg, 'created_at','date','receivedAt','received_at','timestamp','time');

      await ctx.reply(
        `📩 <b>Email</b>\n\n` +
        `<b>Dari:</b> ${escapeHtml(from)}\n` +
        `<b>Subjek:</b> ${escapeHtml(truncate(subject, 80))}\n` +
        (time ? `<b>Waktu:</b> ${new Date(time).toLocaleString("id-ID")}\n` : "") +
        (body ? `\n<b>Isi:</b>\n${escapeHtml(truncate(body, 500))}` : ""),
        { parse_mode: "HTML", ...inboxKeyboard() }
      );
    }
  }

  // ============================================================
  //  HANDLER: Cek OTP
  // ============================================================
  async function handleCheckOtp(ctx) {
    const chatId = ctx.chat.id;
    const state = getState(chatId);

    if (!state.email) {
      await ctx.reply("❌ Belum ada email aktif.", mainMenuKeyboard(ctx.from.id));
      return;
    }

    const msg = await ctx.reply("⏳ Mencari OTP...");
    const { success, messages } = await fetchInbox(chatId);
    await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});

    if (!success || messages.length === 0) {
      await ctx.reply(
        `🔍 <b>Belum ada OTP di inbox</b>\n\n📧 <code>${state.email}</code>\n\nBelum ada email masuk.`,
        { parse_mode: "HTML", ...inboxKeyboard() }
      );
      return;
    }

    let foundOtp = null;
    for (const m of [...messages].reverse()) {
      const subject = getMsgField(m, 'subject','title','email_subject','Subject') || '';
      const body = getMsgField(m, 'body','html','text','body_html','html_body','text_body','content','message','plain') || '';
      const combined = `${subject} ${body}`;
      const otp = extractOtp(combined);
      if (otp) { foundOtp = otp; break; }
    }

    if (foundOtp) {
      state.lastOtp = foundOtp;
      await ctx.reply(
        `🔑 <b>OTP Ditemukan!</b>\n\n` +
        `📧 <code>${state.email}</code>\n\n` +
        `Tap untuk menyalin:\n<code>${foundOtp}</code>`,
        { parse_mode: "HTML", ...inboxKeyboard() }
      );
    } else {
      await ctx.reply(
        `🔍 <b>Belum ada OTP di inbox</b>\n\n` +
        `📧 <code>${state.email}</code>\n\n` +
        `Ada ${messages.length} pesan tapi tidak ditemukan kode OTP.`,
        { parse_mode: "HTML", ...inboxKeyboard() }
      );
    }
  }

  // ============================================================
  //  TEXT HANDLER
  // ============================================================
  bot.on("text", async (ctx) => {
    const uid = ctx.from.id;
    const chatId = ctx.chat.id;
    const text = ctx.message.text.trim();

    // Cek token
    if (!isAuthorized(uid)) {
      const token = text.toUpperCase();
      if (validateAndConsumeToken(token, uid)) {
        awaitingToken.delete(uid);
        await ctx.reply(
          "✅ Token valid! Selamat datang.\n\nKamu sekarang bisa menggunakan bot.",
          mainMenuKeyboard(uid)
        );
      } else {
        await ctx.reply("❌ Token tidak valid atau sudah digunakan. Minta token baru ke admin.");
      }
      return;
    }

    // Main menu
    if (text === "🎲 Buat Email Baru" || text === "🆕 Buat Email Baru") {
      return handleCreateEmail(ctx);
    }
    if (text === "📋 Pilih Domain" || text === "📋 Ganti Domain") {
      await ctx.reply(
        "📋 <b>Pilih domain:</b>\n\nPilih domain yang ingin digunakan:",
        { parse_mode: "HTML", ...domainKeyboard() }
      );
      return;
    }
    if (text === "📬 Cek Inbox") {
      return handleCheckInbox(ctx);
    }
    if (text === "🔑 Cek OTP") {
      return handleCheckOtp(ctx);
    }
    if (text === "⛔ Stop Notif") {
      stopPolling(chatId);
      const state = getState(chatId);
      await ctx.reply(
        `⛔ Notifikasi otomatis dihentikan.\n` +
        (state.email ? `📧 Email: <code>${state.email}</code>` : ""),
        { parse_mode: "HTML", ...mainMenuKeyboard(uid) }
      );
      return;
    }
    if (text === "🏠 Menu Utama") {
      const state = getState(chatId);
      let info = "";
      if (state.email) info = `\n\n📧 Email aktif: <code>${state.email}</code>`;
      await ctx.reply(
        `🏠 <b>Menu Utama</b>${info}`,
        { parse_mode: "HTML", ...mainMenuKeyboard(uid) }
      );
      return;
    }

    // Domain selection
    if (text.startsWith("@")) {
      const domain = text.slice(1);
      if (FREE_DOMAINS.includes(domain)) {
        return handleCreateEmail(ctx, domain);
      }
    }

    // Admin panel
    if (text === "⚙️ Panel Admin") {
      if (!isAdmin(uid)) { await ctx.reply("⛔ Bukan admin."); return; }
      await ctx.reply("⚙️ <b>Panel Admin</b>", { parse_mode: "HTML", ...adminKeyboard() });
      return;
    }

    if (text === "🔑 Generate Token" && isAdmin(uid)) {
      const token = generateToken();
      accessTokens.set(token, { createdAt: Date.now(), usedBy: null });
      await ctx.reply(
        `✅ Token baru:\n\n<code>${token}</code>\n\nBagikan ke pengguna yang ingin diberi akses.`,
        { parse_mode: "HTML", ...adminKeyboard() }
      );
      return;
    }

    if (text === "📋 Lihat Token" && isAdmin(uid)) {
      if (accessTokens.size === 0) {
        await ctx.reply("📋 Belum ada token.", adminKeyboard());
        return;
      }
      const lines = [];
      for (const [t, info] of accessTokens) {
        lines.push(`<code>${t}</code> - ${info.usedBy ? `Dipakai oleh ${info.usedBy}` : "Belum dipakai"}`);
      }
      await ctx.reply(`📋 <b>Daftar Token:</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML", ...adminKeyboard() });
      return;
    }

    if (text === "👥 Lihat User" && isAdmin(uid)) {
      const users = [...authorizedUsers];
      await ctx.reply(`👥 <b>User Terdaftar (${users.length}):</b>\n\n${users.map(u => `<code>${u}</code>`).join("\n")}`, { parse_mode: "HTML", ...adminKeyboard() });
      return;
    }

    if (text === "🚫 Cabut Token" && isAdmin(uid)) {
      await ctx.reply("Kirim token yang ingin dicabut:", Markup.forceReply());
      return;
    }
  });

  // ============================================================
  //  ERROR HANDLING
  // ============================================================
  bot.catch((err, ctx) => {
    console.log(`[bot.catch] Error untuk update ${ctx.updateType}: ${err.message}`);
  });

  // ============================================================
  //  START
  // ============================================================
  bot.launch().then(() => {
    console.log("✅ Bot started successfully");
  }).catch(err => {
    console.log(`❌ Bot failed to start: ${err.message}`);
    process.exit(1);
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
  