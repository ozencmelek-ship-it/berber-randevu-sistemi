require("dotenv").config();

const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI .env içinde yok!");
  process.exit(1);
}

// ===== Body parsers
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ===== Session (admin login için)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "super_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // local için
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

// ===== View engine + static
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src", "views"));
app.use(express.static(path.join(__dirname, "public")));

// ===== Basit endpointler
app.get("/", (req, res) => res.send("Berber Randevu Sistemi Çalışıyor ✂️"));
app.get("/health", (req, res) =>
  res.json({ ok: true, mongo: mongoose.connection.readyState, time: new Date().toISOString() })
);

// ===== Admin routes import + mount (EN KRİTİK)
const adminRoutes = require("./src/routes/admin");

// admin’e gelen istekleri logla (debug)
app.use("/admin", (req, _res, next) => {
  console.log("ADMIN HIT:", req.method, req.originalUrl);
  next();
});

// ✅ Mount
app.use("/admin", adminRoutes);

// ===== WhatsApp routes import + mount
const whatsappRoutes = require("./src/routes/whatsapp");
app.use("/whatsapp", whatsappRoutes);

// ===== 404 fallback (debug için)
app.use((req, res) => {
  res.status(404).send(`Cannot ${req.method} ${req.path}`);
});

// ===== Start
async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("MongoDB bağlandı ✅");

    app.listen(PORT, () => {
      console.log(`Server ${PORT} portunda çalışıyor ✅`);
      console.log(`Admin login: http://localhost:${PORT}/admin/login`);
    });
  } catch (err) {
    console.error("Başlatma hatası:", err?.message || err);
    process.exit(1);
  }
}

start();
