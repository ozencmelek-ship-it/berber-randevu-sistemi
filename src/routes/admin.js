const express = require("express");
const Appointment = require("../models/Appointment");
const Service = require("../models/Service");

const router = express.Router();

// ✅ Admin koruma middleware (bu dosya içinde yazdık, ayrı dosyaya gerek yok)
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect("/admin/login");
}

// Login page
router.get("/login", (req, res) => {
  res.render("admin/login", { error: null });
});

// Login POST
router.post("/login", express.urlencoded({ extended: true }), (req, res) => {
  const { username, password } = req.body;

  const ok =
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS;

  if (!ok) return res.status(401).render("admin/login", { error: "Hatalı kullanıcı adı/şifre" });

  req.session.isAdmin = true;
  return res.redirect("/admin");
});

// Logout
router.post("/logout", requireAdmin, (req, res) => {
  req.session.isAdmin = false;
  return res.redirect("/admin/login");
});

// Dashboard (appointments)
router.get("/", requireAdmin, async (req, res) => {
  const barberId = process.env.DEFAULT_BARBER_ID || "hamburg_001";

  const filter = String(req.query.filter || "today"); // today | tomorrow | week

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);

  if (filter === "tomorrow") {
    // yarın 00:00 - yarın 23:59
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 2);
  } else if (filter === "week") {
    // bugün 00:00 - 7 gün sonrası
    end.setDate(end.getDate() + 7);
  } else {
    // today (default): bugün 00:00 - yarın 00:00
    end.setDate(end.getDate() + 1);
  }

  const appointments = await Appointment.find({
    barberId,
    datetime: { $gte: start, $lt: end },
  })
    .sort({ datetime: 1 })
    .limit(300);

  res.render("admin/dashboard", { appointments, filter });
});


// Cancel appointment
router.post("/appointments/:id/cancel", requireAdmin, async (req, res) => {
  const barberId = process.env.DEFAULT_BARBER_ID || "hamburg_001";
  const appt = await Appointment.findOne({ _id: req.params.id, barberId });
  if (appt) {
    appt.status = "canceled";
    await appt.save();
  }
  res.redirect("/admin");
});

// Services list
router.get("/services", requireAdmin, async (req, res) => {
  const barberId = process.env.DEFAULT_BARBER_ID || "hamburg_001";
  const services = await Service.find({ barberId }).sort({ name: 1 });
  res.render("admin/services", { services });
});

// Service create
router.post("/services", requireAdmin, express.urlencoded({ extended: true }), async (req, res) => {
  const barberId = process.env.DEFAULT_BARBER_ID || "hamburg_001";
  const { name, durationMin, price } = req.body;

  await Service.create({
    barberId,
    name: String(name || "").trim(),
    durationMin: Number(durationMin || 30),
    price: Number(price || 0),
    isActive: true,
  });

  res.redirect("/admin/services");
});

// Service toggle
router.post("/services/:id/toggle", requireAdmin, async (req, res) => {
  const barberId = process.env.DEFAULT_BARBER_ID || "hamburg_001";
  const s = await Service.findOne({ _id: req.params.id, barberId });
  if (s) {
    s.isActive = !s.isActive;
    await s.save();
  }
  res.redirect("/admin/services");
});

// Service delete
router.post("/services/:id/delete", requireAdmin, async (req, res) => {
  const barberId = process.env.DEFAULT_BARBER_ID || "hamburg_001";
  await Service.deleteOne({ _id: req.params.id, barberId });
  res.redirect("/admin/services");
});

module.exports = router;
