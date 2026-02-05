const express = require("express");
const axios = require("axios");

const WaSession = require("../models/WaSession");
const Barber = require("../models/Barber");
const Service = require("../models/Service");

const router = express.Router();

/** =========================
 *  VERIFY (GET)
 *  ========================= */
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/** =========================
 *  Helpers
 *  ========================= */
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

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tomorrowYMD() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** =========================
 *  Incoming (POST)
 *  ========================= */
router.post("/webhook", async (req, res) => {
  try {
    console.log("INCOMING WA POST ✅");

    const parsed = extractMessage(req.body);
    if (!parsed) return res.sendStatus(200);

    const { from, text, phoneNumberId } = parsed;
    const barberId = await resolveBarberId(phoneNumberId);

    const raw = String(text || "");
    const normalized = raw.trim();

    // Session upsert
    let session = await WaSession.findOne({ barberId, phone: from });
    if (!session) {
      session = await WaSession.create({ barberId, phone: from, state: "MENU", temp: {} });
    } else {
      session.lastInteractionAt = new Date();
      await session.save();
    }

    console.log("WA DEBUG:", {
      from,
      barberId,
      state: session.state,
      raw,
      normalized,
    });

    // ==== Global commands
    const lower = normalized.toLowerCase();
    if (!lower || lower === "menu" || lower === "merhaba" || lower === "hi") {
      session.state = "MENU";
      await session.save();
      await sendText({ to: from, body: menuText(), phoneNumberId });
      return res.sendStatus(200);
    }

    // ==== STATE: MENU
    if (session.state === "MENU") {
      if (lower === "1") {
        // Termin buchen -> hizmet listesi
        const services = await Service.find({ barberId, isActive: true }).sort({ name: 1 });

        if (!services.length) {
          await sendText({
            to: from,
            body: "Şu anda tanımlı hizmet yok. (Compass ile services eklediğinden emin ol)",
            phoneNumberId,
          });
          return res.sendStatus(200);
        }

        let msg = "Hizmet seç:\n\n";
        services.forEach((s, i) => {
          msg += `S${i + 1}) ${s.name} — ${s.durationMin} dk — ${s.price}€\n`;
        });
        msg += "\nSeçmek için S1, S2, S3... yaz";

        session.state = "CHOOSE_SERVICE";
        session.temp = { ...(session.temp || {}), lastServiceListAt: new Date().toISOString() };
        await session.save();

        await sendText({ to: from, body: msg, phoneNumberId });
        return res.sendStatus(200);
      }

      if (lower === "2" || lower === "3") {
        await sendText({
          to: from,
          body: "Bu özellik birazdan eklenecek 🙂\n\n" + menuText(),
          phoneNumberId,
        });
        return res.sendStatus(200);
      }

      await sendText({ to: from, body: `Anlamadım 😅\n\n${menuText()}`, phoneNumberId });
      return res.sendStatus(200);
    }

    // ==== STATE: CHOOSE_SERVICE  (beklenen: S1, S2, ...)
    if (session.state === "CHOOSE_SERVICE") {
      const m = lower.match(/^s(\d+)$/i);
      if (!m) {
        await sendText({
          to: from,
          body: "Hizmet seçmek için S1, S2, S3... yaz. Menü için 'menu' yazabilirsin.",
          phoneNumberId,
        });
        return res.sendStatus(200);
      }

      const index = Number(m[1]) - 1;

      const services = await Service.find({ barberId, isActive: true }).sort({ name: 1 });
      if (!services.length) {
        session.state = "MENU";
        await session.save();
        await sendText({ to: from, body: "Hizmet bulunamadı. Menüye döndüm.\n\n" + menuText(), phoneNumberId });
        return res.sendStatus(200);
      }

      if (index < 0 || index >= services.length) {
        await sendText({
          to: from,
          body: "Geçersiz seçim. Lütfen listeden S1, S2, S3... şeklinde yaz.",
          phoneNumberId,
        });
        return res.sendStatus(200);
      }

      const selected = services[index];

      session.state = "CHOOSE_DATE";
      session.temp = {
        ...(session.temp || {}),
        serviceId: String(selected._id),
        serviceName: selected.name,
      };
      await session.save();

      const msg =
        `Seçtin: ${selected.name} ✅\n\n` +
        `Tarih seç:\n` +
        `1) Bugün (${todayYMD()})\n` +
        `2) Yarın (${tomorrowYMD()})\n\n` +
        `Cevap: 1 veya 2`;

      await sendText({ to: from, body: msg, phoneNumberId });
      return res.sendStatus(200);
    }

    // ==== STATE: CHOOSE_DATE (beklenen: 1/2)
    if (session.state === "CHOOSE_DATE") {
      if (lower !== "1" && lower !== "2") {
        await sendText({
          to: from,
          body: "Tarih için 1 (Bugün) veya 2 (Yarın) yaz. Menü için 'menu' yazabilirsin.",
          phoneNumberId,
        });
        return res.sendStatus(200);
      }

      const ymd = lower === "1" ? todayYMD() : tomorrowYMD();

      session.state = "CHOOSE_TIME";
      session.temp = { ...(session.temp || {}), dateYMD: ymd };
      await session.save();

      // Şimdilik saat listesi yok (sonraki adım)
      const msg =
        `Tarih seçtin: ${ymd} ✅\n\n` +
        `Sıradaki adım: saat seçimi (yakında).\n\n` +
        `Menüye dönmek için 'menu' yazabilirsin.`;

      await sendText({ to: from, body: msg, phoneNumberId });
      return res.sendStatus(200);
    }

    // ==== fallback
    session.state = "MENU";
    await session.save();
    await sendText({ to: from, body: menuText(), phoneNumberId });
    return res.sendStatus(200);
  } catch (e) {
    console.error("WA ERROR:", e?.response?.data || e.message);
    return res.sendStatus(200);
  }
});

module.exports = router;
