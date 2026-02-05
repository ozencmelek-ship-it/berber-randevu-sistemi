const express = require("express");
const session = require("express-session");
require("dotenv").config();

const { connectDB } = require("./src/db");
const { tenant } = require("./src/middleware/tenant");

const servicesRoutes = require("./src/routes/services");
const whatsappRoutes = require("./src/routes/whatsapp");

const Barber = require("./src/models/Barber");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SESSION
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret",
    resave: false,
    saveUninitialized: false,
  })
);

// TENANT
app.use(tenant);

// 🔥 GLOBAL REQUEST LOGGER (EN ÖNEMLİ EKLEDİĞİMİZ KISIM)
app.use((req, res, next) => {
  console.log("REQ ✅", req.method, req.url);
  next();
});

// HEALTH TEST
app.get("/health", (req, res) => {
  res.json({ ok: true, barberId: req.barberId });
});

// ROUTES
app.use("/services", servicesRoutes);
app.use("/whatsapp", whatsappRoutes);

// STATIC (privacy/terms için)
app.use(express.static("public"));

// DEFAULT BARBER
async function ensureDefaultBarber() {
  const barberId = process.env.DEFAULT_BARBER_ID || "hamburg_001";

  const exists = await Barber.findOne({ barberId });

  if (!exists) {
    await Barber.create({
      barberId,
      name: "Demo Barber",
      city: "Hamburg",
    });

    console.log("Default barber created:", barberId);
  }
}

// START
async function start() {
  try {
    await connectDB(process.env.MONGODB_URI);

    await ensureDefaultBarber();

    const port = Number(process.env.PORT || 3000);

    app.listen(port, () =>
      console.log("Server running on port:", port)
    );
  } catch (e) {
    console.error("Startup error:", e);
    process.exit(1);
  }
}

start();
