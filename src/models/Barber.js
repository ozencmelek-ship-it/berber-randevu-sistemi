const mongoose = require("mongoose");

const BarberSchema = new mongoose.Schema(
  {
    barberId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    city: { type: String, default: "Hamburg" },
    isActive: { type: Boolean, default: true },

    whatsappPhoneNumberId: { type: String, default: "" },

    workingHours: {
      start: { type: String, default: "09:00" },
      end: { type: String, default: "19:00" }
    },

    plan: { type: String, default: "pro" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Barber", BarberSchema);
