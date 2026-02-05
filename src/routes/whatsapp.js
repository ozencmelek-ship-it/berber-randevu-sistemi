const express = require("express");
const axios = require("axios");

const WaSession = require("../models/WaSession");
const Barber = require("../models/Barber");
const Service = require("../models/Service");

const router = express.Router();

router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

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

router.post("/webhook", async (req, res) => {
  try {
    console.log("INCOMING WA POST ✅");

    const parsed = extractMessage(req.body);
    if (!parsed) return res.sendStatus(200);

    const { from, text, phoneNumberId } = parsed;
    const barberId = await resolveBarberId(phoneNumberId);

    // Debug: WhatsApp tam ne gönderiyor görelim
    const raw = String(text || "");
    const normalized = raw.trim().toLowerCase();
    const choice = (normalized.match(/^[1-3]/)?.[0]) || ""; // "1", "2", "3" yakala

    console.log("WA DEBUG:", { raw, normalized, choice, from, barberId });

    // Eğer kullanıcı hizmet seçimi yaptıysa (ör: "2")
// Bu sadece daha önce hizmet listesi gönderildiyse çalışmalı.
// Şimdilik basit: normalized sadece rakamsa hizmet seçimi say.
if (/^\d+$/.test(normalized) && choice !== "1" && choice !== "2" && choice !== "3") {
  const index = Number(normalized) - 1;

  const services = await Service.find({ barberId, isActive: true }).sort({ name: 1 });
  if (!services.length) {
    await sendText({ to: from, body: "Hizmet listesi boş görünüyor. '1' yazıp tekrar listeyi al.", phoneNumberId });
    return res.sendStatus(200);
  }

  if (index < 0 || index >= services.length) {
    await sendText({ to: from, body: "Geçersiz seçim. Lütfen listeden bir numara seç.", phoneNumberId });
    return res.sendStatus(200);
  }

  const selected = services[index];

  // Session'a yaz
  session.state = "CHOOSE_DATE";
  session.temp = { ...(session.temp || {}), serviceId: String(selected._id), serviceName: selected.name };
  session.lastInteractionAt = new Date();
  await session.save();

  const msg =
    `Seçtin: ${selected.name} ✅\n\n` +
    `Tarih seç:\n` +
    `1) Bugün\n` +
    `2) Yarın\n\n` +
    `Cevap: 1 veya 2`;

  await sendText({ to: from, body: msg, phoneNumberId });
  return res.sendStatus(200);
}

    // session upsert
    let session = await WaSession.findOne({ barberId, phone: from });
    if (!session) {
      session = await WaSession.create({ barberId, phone: from, state: "MENU" });
    } else {
      session.lastInteractionAt = new Date();
      await session.save();
    }

    // menu/selam
    if (!normalized || normalized === "menu" || normalized === "merhaba" || normalized === "hi") {
      await sendText({ to: from, body: menuText(), phoneNumberId });
      return res.sendStatus(200);
    }

    // 1) hizmet listesi
    if (choice === "1") {
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
        msg += `${i + 1}) ${s.name} — ${s.durationMin} dk — ${s.price}€\n`;
      });
      msg += "\nSeçmek için numara yaz (1, 2, 3...)";

      await sendText({ to: from, body: msg, phoneNumberId });
      return res.sendStatus(200);
    }

    // 2/3 şimdilik yok
    if (choice === "2" || choice === "3") {
      await sendText({
        to: from,
        body: "Bu özellik birazdan eklenecek 🙂\n\n" + menuText(),
        phoneNumberId,
      });
      return res.sendStatus(200);
    }

    await sendText({ to: from, body: `Anlamadım 😅\n\n${menuText()}`, phoneNumberId });
    return res.sendStatus(200);
  } catch (e) {
    console.error("WA ERROR:", e?.response?.data || e.message);
    return res.sendStatus(200);
  }
});

module.exports = router;
