console.log("WHATSAPP ROUTE LOADED ✅");

const express = require("express");
const router = express.Router();

router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("VERIFY CHECK:", {
    mode,
    got: token,
    expected: process.env.WHATSAPP_VERIFY_TOKEN,
  });

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post("/webhook", (req, res) => {
  return res.sendStatus(200);
});

module.exports = router;
