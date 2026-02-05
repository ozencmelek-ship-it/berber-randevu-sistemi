const express = require("express");
const axios = require("axios");

const WaSession = require("../models/WaSession");
const Barber = require("../models/Barber");

const router = express.Router();

// Verify (GET)
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Meta payload içinden mesajı çıkar
function extractMessage(payload) {
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  const msg = value?.messages?.[0];
  if (!msg) return null;

  const from = msg.from; // müşteri telefonu
  const text = msg.text?.body || ""; // mesaj metni
  const phoneNumberId = value?.metadata?.phone_number_id || ""; // business phone_number_id

  return { from, text, phoneNumberId };
}

// Meta'ya text mesaj gönder
async function sendText({ to, body, phoneNumberId }) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("WHATSAPP_TOKEN env eksik");
  if (!phoneNumberId) throw new Error("phone_number_id yok (payload metadata)");

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    },
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    }
  );
}

function menuText() {
  return (
    "Willkommen! ✂️\n" +
    "Was möchten Sie tun?\n\n" +
    "1) Termin buchen\n" +
    "2) Meine Termine\n" +
    "3) Termin stornieren\n\n" +
    "Cevap olarak 1, 2 veya 3 yaz.\n" +
    "Menü için 'menu' yazabilirsin."
  );
}

// Incoming messages (POST)
router.post("/webhook", async (req, res) => {
  try {
    console.log("INCOMING WA POST ✅");

    const parsed = extractMessage(req.body);
    if (!parsed) return res.sendStatus(200);

    const { from, text, phoneNumberId } = parsed;

    // barberId seç (şimdilik default; phoneNumberId ile eşleştirme varsa onu kullan)
    let barberId = process.env.DEFAULT_BARBER_ID || "hamburg_001";
    if (phoneNumberId) {
      const b = await Barber.findOne({ whatsappPhoneNumberId: phoneNumberId });
      if (b?.barberId) barberId = b.barberId;
    }

    // session upsert
    let session = await WaSession.findOne({ barberId, phone: from });
    if (!session) {
      session = await WaSession.create({ barberId, phone: from, state: "MENU" });
    } else {
      session.lastInteractionAt = new Date();
      await session.save();
    }

    const normalized = (text || "").trim().toLowerCase();

    let reply = "";
    if (!normalized || normalized === "menu" || normalized === "merhaba" || normalized === "hi") {
      reply = menuText();
    } else if (["1", "2", "3"].includes(normalized)) {
      reply = `Seçimin: ${normalized}\n\nYakında bu seçimlerle randevu akışını başlatacağız 🙂\n\n${menuText()}`;
    } else {
      reply = `Anlamadım 😅\n\n${menuText()}`;
    }

    await sendText({ to: from, body: reply, phoneNumberId });

    return res.sendStatus(200);
  } catch (e) {
    console.error("WA ERROR:", e?.response?.data || e.message);
    return res.sendStatus(200);
  }
});

module.exports = router;
