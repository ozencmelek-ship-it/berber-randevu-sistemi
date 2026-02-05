const mongoose = require("mongoose");

const WaSessionSchema = new mongoose.Schema(
  {
    barberId: { type: String, required: true, index: true },
    phone: { type: String, required: true, index: true },

    state: { type: String, default: "MENU" },

    // ✅ Akış boyunca tutulan geçici bilgiler:
    // serviceId, serviceName, dateYMD, lastSlots, chosenISO ...
    temp: { type: mongoose.Schema.Types.Mixed, default: {} },

    lastInteractionAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

WaSessionSchema.index({ barberId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model("WaSession", WaSessionSchema);
