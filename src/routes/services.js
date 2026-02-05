const express = require("express");
const Service = require("../models/Service");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res) => {
  const items = await Service.find({ barberId: req.barberId, isActive: true }).sort({ name: 1 });
  res.json(items);
});

router.get("/all", requireAdmin, async (req, res) => {
  const items = await Service.find({ barberId: req.barberId }).sort({ createdAt: -1 });
  res.json(items);
});

router.post("/", requireAdmin, async (req, res) => {
  const { name, durationMin, price } = req.body;
  const created = await Service.create({ barberId: req.barberId, name, durationMin, price });
  res.json(created);
});

module.exports = router;
