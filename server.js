const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const path = require("path");
require("dotenv").config();

const app = express();

/* -------------------- Middleware -------------------- */
app.use(express.json());
app.use(express.static("public"));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
  })
);

/* -------------------- Models -------------------- */
const appointmentSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true, trim: true },
    service: { type: String, required: true, trim: true }, // şimdilik service name
    datetime: { type: Date, required: true },
  },
  { timestamps: true }
);

const Appointment = mongoose.model("Appointment", appointmentSchema);

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    price: { type: Number, required: true, min: 0 },
    durationMin: { type: Number, required: true, min: 5 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Service = mongoose.model("Service", serviceSchema);

/* -------------------- Auth helpers -------------------- */
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ error: "Yetkisiz" });
}

/* -------------------- Pages -------------------- */
app.get("/", (req, res) => {
  // public/index.html zaten static ile gelir, ama bu netlik için kalsın
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  if (!req.session?.isAdmin) return res.redirect("/login.html");
  return res.sendFile(path.join(__dirname, "public", "admin.html"));
});

/* -------------------- Auth routes -------------------- */
app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};

  const u = process.env.ADMIN_USER || "admin";
  const p = process.env.ADMIN_PASS || "123456";

  if (username !== u || password !== p) {
    return res.status(401).json({ error: "Hatalı kullanıcı/şifre" });
  }

  req.session.isAdmin = true;
  return res.json({ ok: true });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/* -------------------- Services routes -------------------- */
// Public: aktif hizmetleri listele (müşteri ekranı bunu kullanabilir)
app.get("/services", async (req, res) => {
  const items = await Service.find({ isActive: true }).sort({ name: 1 });
  res.json(items);
});

// Admin: tüm hizmetleri (aktif/pasif) görmek istersen:
app.get("/services/all", requireAdmin, async (req, res) => {
  const items = await Service.find().sort({ name: 1 });
  res.json(items);
});

app.post("/services", requireAdmin, async (req, res) => {
  const { name, price, durationMin } = req.body || {};
  if (!name || price == null || durationMin == null) {
    return res.status(400).json({ error: "name, price, durationMin zorunlu" });
  }

  try {
    const created = await Service.create({
      name,
      price: Number(price),
      durationMin: Number(durationMin),
      isActive: true,
    });
    return res.status(201).json(created);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Bu isimde hizmet zaten var" });
    }
    return res.status(500).json({ error: "Sunucu hatası" });
  }
});

app.put("/services/:id", requireAdmin, async (req, res) => {
  const updated = await Service.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!updated) return res.status(404).json({ error: "Hizmet bulunamadı" });
  res.json(updated);
});

// Silmek yerine pasif et
app.delete("/services/:id", requireAdmin, async (req, res) => {
  const updated = await Service.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );
  if (!updated) return res.status(404).json({ error: "Hizmet bulunamadı" });
  res.json(updated);
});

/* -------------------- Appointments routes -------------------- */
app.get("/appointments", async (req, res) => {
  const list = await Appointment.find().sort({ datetime: 1 });
  res.json(list);
});

app.post("/appointments", async (req, res) => {
  try {
    const { customerName, service, datetime } = req.body || {};

    if (!customerName || !service || !datetime) {
      return res.status(400).json({ error: "customerName, service, datetime zorunlu" });
    }

    // datetime normalize
    const dt = new Date(datetime);
    if (Number.isNaN(dt.getTime())) {
      return res.status(400).json({ error: "datetime geçersiz" });
    }
    dt.setSeconds(0, 0);

    // çalışma saati kontrolü (10:00–20:00)
    const hour = dt.getHours();
    if (hour < 10 || hour >= 20) {
      return res.status(400).json({ error: "Randevu saatleri 10:00–20:00 arası olmalı" });
    }

    // çakışma kontrolü
    const exists = await Appointment.findOne({ datetime: dt });
    if (exists) {
      return res.status(409).json({ error: "Bu saat için randevu zaten var" });
    }

    const created = await Appointment.create({
      customerName,
      service,
      datetime: dt,
    });

    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({ error: "Sunucu hatası" });
  }
});

app.put("/appointments/:id", async (req, res) => {
  try {
    const { customerName, service, datetime } = req.body || {};
    const patch = {};

    if (customerName) patch.customerName = customerName;
    if (service) patch.service = service;

    if (datetime) {
      const dt = new Date(datetime);
      if (Number.isNaN(dt.getTime())) {
        return res.status(400).json({ error: "datetime geçersiz" });
      }
      dt.setSeconds(0, 0);

      const hour = dt.getHours();
      if (hour < 10 || hour >= 20) {
        return res.status(400).json({ error: "Randevu saatleri 10:00–20:00 arası olmalı" });
      }

      // aynı saate başka randevu var mı? (kendi kaydı hariç)
      const conflict = await Appointment.findOne({ datetime: dt, _id: { $ne: req.params.id } });
      if (conflict) {
        return res.status(409).json({ error: "Bu saat için randevu zaten var" });
      }

      patch.datetime = dt;
    }

    const updated = await Appointment.findByIdAndUpdate(req.params.id, patch, {
      new: true,
      runValidators: true,
    });

    if (!updated) return res.status(404).json({ error: "Randevu bulunamadı" });
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Sunucu hatası" });
  }
});

app.delete("/appointments/:id", async (req, res) => {
  const deleted = await Appointment.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Randevu bulunamadı" });
  res.json(deleted);
});

/* -------------------- Start -------------------- */
async function start() {
  const uri = process.env.MONGODB_URI;
  const port = Number(process.env.PORT || 3000);

  if (!uri) {
    console.error("MONGODB_URI bulunamadı. .env dosyasını kontrol et.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("MongoDB bağlandı ✅");

  app.listen(port, () => console.log(`Server ${port} portunda calisiyor`));
}

start().catch((err) => {
  console.error("Başlatma hatası:", err.message);
  process.exit(1);
});
