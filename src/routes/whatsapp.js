const express = require("express");
const axios = require("axios");

const WaSession = require("../models/WaSession");
const Barber = require("../models/Barber");
const Service = require("../models/Service");
const Appointment = require("../models/Appointment");

const { generateStartSlots } = require("../utils/slots");

const router = express.Router();

/** ===== VERIFY (GET) ===== */
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/** ===== Helpers ===== */
function extractMessage(payload) {
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const msg = value?.messages?.[0];
  if (!msg) return null;

  const from = msg.from;
  const text = msg.text?.body || "";
  const phoneNumberId = value?.metadata?.phone_number_id || "";

  return { from, text, phoneNumberId };
}

async function sendText({ to, body, phoneNumberId }) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("WHATSAPP_TOKEN env eksik");
  if (!phoneNumberId) throw new Error("phone_number_id yok (payload metadata)");

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  await axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "text", text: { body } },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
  );
}

function menuText() {
  return (
    "Willkommen! ✂️\n" +
    "Was möchtest du tun?\n\n" +
    "1) Termin buchen\n" +
    "2) Meine Termine\n" +
    "3) Termin stornieren\n\n" +
    "Menü için 'menu' yazabilirsin."
  );
}

async function resolveBarberId(phoneNumberId) {
  let barberId = process.env.DEFAULT_BARBER_ID || "hamburg_001";
  if (phoneNumberId) {
    const b = await Barber.findOne({ whatsappPhoneNumberId: phoneNumberId });
    if (b?.barberId) barberId = b.barberId;
  }
  return barberId;
}

function ymdToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ymdTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDE(dateObj) {
  const d = dateObj;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yy} ${hh}:${mi}`;
}

function makeCancelCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function recomputeSlots({ barberId, dateYMD, durationMin }) {
  const allSlots = generateStartSlots({
    dateYMD,
    startHHMM: "09:00",
    endHHMM: "19:00",
    stepMin: 15,
    durationMin,
  });

  const dayStart = new Date(dateYMD + "T00:00:00");
  const dayEnd = new Date(dateYMD + "T23:59:59");

  const taken = await Appointment.find({
    barberId,
    status: "confirmed",
    datetime: { $gte: dayStart, $lte: dayEnd },
  }).select("datetime");

  const takenSet = new Set(taken.map((a) => new Date(a.datetime).getTime()));

  const available = allSlots.filter((s) => !takenSet.has(s.startAt.getTime())).slice(0, 12);
  return available.map((s) => ({ hhmm: s.hhmm, iso: s.startAt.toISOString() }));
}

function renderSlotsText(dateYMD, slots) {
  let msg = `Tarih: ${dateYMD}\nSaat seç:\n\n`;
  slots.forEach((s, i) => {
    msg += `T${i + 1}) ${s.hhmm}\n`;
  });
  msg += "\nSeçmek için T1, T2... veya sadece 1, 2... yaz";
  return msg;
}

function cleanCancelCode(input) {
  return String(input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** ✅ FIX: artık sadece geleceği değil, son 30 günü + geleceği listeliyoruz */
async function listCustomerAppointments({ barberId, phone, limit = 5 }) {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30); // son 30 gün

  return Appointment.find({
    barberId,
    customerPhone: phone,
    status: "confirmed",
    datetime: { $gte: fromDate },
  })
    .sort({ datetime: 1 })
    .limit(limit);
}

function renderAppointmentsList(appts) {
  if (!appts.length) return "Randevu bulunamadı 🙂\n\nMenü için 'menu' yaz.";

  let msg = "Randevuların:\n\n";
  appts.forEach((a, i) => {
    msg += `${i + 1}) ${formatDE(new Date(a.datetime))} — ${a.serviceNameSnapshot}\n   İptal kodu: ${a.cancelCode}\n`;
  });
  msg += "\nMenü için 'menu' yaz.";
  return msg;
}

/** ===== Main (POST) ===== */
router.post("/webhook", async (req, res) => {
  try {
    const parsed = extractMessage(req.body);
    if (!parsed) return res.sendStatus(200);

    const { from, text, phoneNumberId } = parsed;
    const barberId = await resolveBarberId(phoneNumberId);

    const raw = String(text || "");
    const normalized = raw.trim();
    const lower = normalized.toLowerCase();

    let session = await WaSession.findOne({ barberId, phone: from });
    if (!session) {
      session = await WaSession.create({ barberId, phone: from, state: "MENU", temp: {} });
    } else {
      session.lastInteractionAt = new Date();
      await session.save();
    }

    // Global commands
    if (!lower || lower === "menu" || lower === "merhaba" || lower === "hi") {
      session.state = "MENU";
      session.temp = {};
      await session.save();
      await sendText({ to: from, body: menuText(), phoneNumberId });
      return res.sendStatus(200);
    }

    /** ===== MENU ===== */
    if (session.state === "MENU") {
      if (lower === "1") {
        const services = await Service.find({ barberId, isActive: true }).sort({ name: 1 });

        if (!services.length) {
          await sendText({ to: from, body: "Şu anda tanımlı hizmet yok.", phoneNumberId });
          return res.sendStatus(200);
        }

        let msg = "Hizmet seç:\n\n";
        services.forEach((s, i) => {
          msg += `S${i + 1}) ${s.name} — ${s.durationMin} dk — ${s.price}€\n`;
        });
        msg += "\nSeçmek için S1, S2, S3... yaz";

        session.state = "CHOOSE_SERVICE";
        session.temp = {};
        await session.save();

        await sendText({ to: from, body: msg, phoneNumberId });
        return res.sendStatus(200);
      }

      if (lower === "2") {
        const appts = await listCustomerAppointments({ barberId, phone: from, limit: 5 });
        await sendText({ to: from, body: renderAppointmentsList(appts), phoneNumberId });
        return res.sendStatus(200);
      }

      if (lower === "3") {
        const appts = await listCustomerAppointments({ barberId, phone: from, limit: 3 });

        session.state = "CANCEL_WAIT";
        session.temp = {
          cancelCandidates: appts.map((a) => ({
            id: String(a._id),
            datetime: a.datetime,
            serviceName: a.serviceNameSnapshot,
            cancelCode: a.cancelCode,
          })),
        };
        await session.save();

        let msg =
          "İptal etmek için:\n\n" +
          "A) İptal kodunu yaz (örn: AB12CD)\n" +
          "B) Aşağıdan numara seç (1/2/3)\n\n";

        if (!appts.length) {
          msg += "Aktif randevu bulunamadı.\n\nMenü için 'menu' yaz.";
        } else {
          appts.forEach((a, i) => {
            msg += `${i + 1}) ${formatDE(new Date(a.datetime))} — ${a.serviceNameSnapshot}\n`;
          });
          msg += "\nCevap: Kod veya 1/2/3";
        }

        await sendText({ to: from, body: msg, phoneNumberId });
        return res.sendStatus(200);
      }

      await sendText({ to: from, body: `Anlamadım 😅\n\n${menuText()}`, phoneNumberId });
      return res.sendStatus(200);
    }

    /** ===== CANCEL_WAIT ===== */
    if (session.state === "CANCEL_WAIT") {
      const candidates = session.temp?.cancelCandidates || [];

      // 1/2/3 seçimi
      if (/^\d+$/.test(lower)) {
        const idx = Number(lower) - 1;
        if (idx < 0 || idx >= candidates.length) {
          await sendText({ to: from, body: "Geçersiz seçim. 1/2/3 yaz veya iptal kodunu gönder.", phoneNumberId });
          return res.sendStatus(200);
        }

        const chosen = candidates[idx];

        const appt = await Appointment.findOne({
          _id: chosen.id,
          barberId,
          customerPhone: from,
          status: "confirmed",
        });

        if (!appt) {
          await sendText({ to: from, body: "Bu randevu artık aktif değil. Menü için 'menu' yaz.", phoneNumberId });
          return res.sendStatus(200);
        }

        appt.status = "canceled";
        await appt.save();

        session.state = "MENU";
        session.temp = {};
        await session.save();

        await sendText({
          to: from,
          body:
            "Randevu iptal edildi ✅\n\n" +
            `Tarih/Saat: ${formatDE(new Date(appt.datetime))}\n` +
            `Hizmet: ${appt.serviceNameSnapshot}\n\n` +
            "Menü için 'menu' yaz.",
          phoneNumberId,
        });

        return res.sendStatus(200);
      }

      // Kodla iptal
      const code = cleanCancelCode(normalized);
      if (!code || code.length < 4) {
        await sendText({ to: from, body: "Kod geçersiz. İptal kodunu (AB12CD) ya da 1/2/3 yaz.", phoneNumberId });
        return res.sendStatus(200);
      }

      const appt = await Appointment.findOne({
        barberId,
        customerPhone: from,
        cancelCode: code,
        status: "confirmed",
      });

      if (!appt) {
        await sendText({ to: from, body: "Bu koda ait aktif randevu bulunamadı. Kodu kontrol et veya 'menu' yaz.", phoneNumberId });
        return res.sendStatus(200);
      }

      appt.status = "canceled";
      await appt.save();

      session.state = "MENU";
      session.temp = {};
      await session.save();

      await sendText({
        to: from,
        body:
          "Randevu iptal edildi ✅\n\n" +
          `Tarih/Saat: ${formatDE(new Date(appt.datetime))}\n` +
          `Hizmet: ${appt.serviceNameSnapshot}\n\n` +
          "Menü için 'menu' yaz.",
        phoneNumberId,
      });

      return res.sendStatus(200);
    }

    /** ===== CHOOSE_SERVICE ===== */
    if (session.state === "CHOOSE_SERVICE") {
      const m = lower.match(/^s(\d+)$/i);
      if (!m) {
        await sendText({ to: from, body: "Hizmet seçmek için S1, S2... yaz.", phoneNumberId });
        return res.sendStatus(200);
      }

      const index = Number(m[1]) - 1;
      const services = await Service.find({ barberId, isActive: true }).sort({ name: 1 });

      if (index < 0 || index >= services.length) {
        await sendText({ to: from, body: "Geçersiz seçim. S1, S2... yaz.", phoneNumberId });
        return res.sendStatus(200);
      }

      const selected = services[index];

      session.state = "CHOOSE_DATE";
      session.temp = {
        serviceId: String(selected._id),
        serviceName: selected.name,
        durationMin: selected.durationMin,
        price: selected.price,
      };
      await session.save();

      const msg =
        `Seçtin: ${selected.name} ✅\n\n` +
        `Tarih seç:\n` +
        `1) Bugün (${ymdToday()})\n` +
        `2) Yarın (${ymdTomorrow()})\n\n` +
        `Cevap: 1 veya 2`;

      await sendText({ to: from, body: msg, phoneNumberId });
      return res.sendStatus(200);
    }

    /** ===== CHOOSE_DATE ===== */
    if (session.state === "CHOOSE_DATE") {
      if (lower !== "1" && lower !== "2") {
        await sendText({ to: from, body: "Tarih için 1 (Bugün) veya 2 (Yarın) yaz.", phoneNumberId });
        return res.sendStatus(200);
      }

      const dateYMD = lower === "1" ? ymdToday() : ymdTomorrow();
      const durationMin = Number(session.temp?.durationMin || 30);

      const slots = await recomputeSlots({ barberId, dateYMD, durationMin });

      if (!slots.length) {
        await sendText({
          to: from,
          body: `Seçtiğin tarihte boş saat yok 😕\nBaşka tarih seç:\n\n1) Bugün\n2) Yarın`,
          phoneNumberId,
        });
        return res.sendStatus(200);
      }

      session.state = "CHOOSE_TIME";
      session.temp = { ...(session.temp || {}), dateYMD, lastSlots: slots };
      await session.save();

      await sendText({ to: from, body: renderSlotsText(dateYMD, slots), phoneNumberId });
      return res.sendStatus(200);
    }

    /** ===== CHOOSE_TIME ===== */
    if (session.state === "CHOOSE_TIME") {
      let idxStr = null;

      const mt = lower.match(/^t(\d+)$/i);
      if (mt) idxStr = mt[1];
      if (!idxStr && /^\d+$/.test(lower)) idxStr = lower;

      if (!idxStr) {
        await sendText({ to: from, body: "Saat seçmek için T1, T2... veya 1,2,3... yaz.", phoneNumberId });
        return res.sendStatus(200);
      }

      const index = Number(idxStr) - 1;

      const dateYMD = session.temp?.dateYMD;
      const durationMin = Number(session.temp?.durationMin || 30);

      if (!dateYMD) {
        session.state = "CHOOSE_DATE";
        await session.save();
        await sendText({ to: from, body: "Tarih bilgisi kaybolmuş 😅 Lütfen tekrar tarih seç:\n\n1) Bugün\n2) Yarın", phoneNumberId });
        return res.sendStatus(200);
      }

      let slots = session.temp?.lastSlots || [];
      if (!Array.isArray(slots) || slots.length === 0) {
        slots = await recomputeSlots({ barberId, dateYMD, durationMin });
        session.temp = { ...(session.temp || {}), lastSlots: slots };
        await session.save();
      }

      if (index < 0 || index >= slots.length) {
        await sendText({ to: from, body: "Geçersiz seçim.\n\n" + renderSlotsText(dateYMD, slots), phoneNumberId });
        return res.sendStatus(200);
      }

      const chosen = slots[index];

      session.state = "CONFIRM";
      session.temp = { ...(session.temp || {}), chosenISO: chosen.iso, chosenHHMM: chosen.hhmm };
      await session.save();

      const summary =
        `Onaylıyor musun?\n\n` +
        `Hizmet: ${session.temp.serviceName}\n` +
        `Tarih/Saat: ${formatDE(new Date(chosen.iso))}\n` +
        `Ücret: ${session.temp.price}€\n\n` +
        `Evet için: E\nHayır için: H`;

      await sendText({ to: from, body: summary, phoneNumberId });
      return res.sendStatus(200);
    }

    /** ===== CONFIRM ===== */
    if (session.state === "CONFIRM") {
      if (lower !== "e" && lower !== "h") {
        await sendText({ to: from, body: "Lütfen E (evet) veya H (hayır) yaz.", phoneNumberId });
        return res.sendStatus(200);
      }

      if (lower === "h") {
        session.state = "MENU";
        session.temp = {};
        await session.save();
        await sendText({ to: from, body: "İptal edildi. Menüye döndüm.\n\n" + menuText(), phoneNumberId });
        return res.sendStatus(200);
      }

      const dt = new Date(session.temp.chosenISO);

      try {
        const cancelCode = makeCancelCode();
        const created = await Appointment.create({
          barberId,
          customerPhone: from,
          customerName: "",
          serviceId: session.temp.serviceId,
          serviceNameSnapshot: session.temp.serviceName,
          durationMinSnapshot: session.temp.durationMin,
          priceSnapshot: session.temp.price,
          datetime: dt,
          status: "confirmed",
          source: "whatsapp",
          cancelCode,
        });

        session.state = "MENU";
        session.temp = {};
        await session.save();

        await sendText({
          to: from,
          body:
            `Randevun oluşturuldu ✅\n\n` +
            `Tarih/Saat: ${formatDE(new Date(created.datetime))}\n` +
            `Hizmet: ${created.serviceNameSnapshot}\n` +
            `İptal kodu: ${created.cancelCode}\n\n` +
            "Randevularını görmek için 2, iptal için 3 yaz.\n" +
            "Menü için 'menu' yaz.",
          phoneNumberId,
        });

        return res.sendStatus(200);
      } catch (e) {
        session.state = "CHOOSE_TIME";
        await session.save();
        await sendText({ to: from, body: "O saat az önce doldu 😅 Lütfen başka saat seç.", phoneNumberId });
        return res.sendStatus(200);
      }
    }

    // fallback
    session.state = "MENU";
    session.temp = {};
    await session.save();
    await sendText({ to: from, body: menuText(), phoneNumberId });
    return res.sendStatus(200);
  } catch (e) {
    console.error("WA ERROR:", e?.response?.data || e.message);
    return res.sendStatus(200);
  }
});

module.exports = router;
