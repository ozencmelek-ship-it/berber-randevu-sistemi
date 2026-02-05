console.log("SERVER BOOT ✅ NEW VERSION");
const express = require("express");
const session = require("express-session");
require("dotenv").config();

const { connectDB } = require("./src/db");
const { tenant } = require("./src/middleware/tenant");

const Barber = require("./src/models/Barber");

const servicesRoutes = require("./src/routes/services");
const whatsappRoutes = require("./src/routes/whatsapp");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret",
    resave: false,
    saveUninitialized: false,
  })
);

// barberId middleware
app.use(tenant);

// health
app.get("/health", (req, res) => {
  res.json({ ok: true, barberId: req.barberId });
});

// routes
app.use("/services", servicesRoutes);
app.use("/whatsapp", whatsappRoutes);

// static (opsiyonel)
app.use(express.static("public"));

async function ensureDefaultBarber() {
  const barberId = process.env.DEFAULT_BARBER_ID || "hamburg_001";
  const exists = await Barber.findOne({ barberId });
  if (!exists) {
    await Barber.create({ barberId, name: "Demo Barber", city: "Hamburg" });
    console.log("Default barber created:", barberId);
  }
}

async function start() {
  try {
    await connectDB(process.env.MONGODB_URI);
    await ensureDefaultBarber();

    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => console.log("Server port:", port));
  } catch (e) {
    console.error("Başlatma hatası:", e);
    process.exit(1);
  }
}

start();
