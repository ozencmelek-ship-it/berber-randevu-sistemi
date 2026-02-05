const mongoose = require("mongoose");

const WaSessionSchema = new mongoose.Schema(
  {
    barberId: { type: String, required: true, index: true },
    phone: { type: String, required: true },

    state: {
      type: String,
      enum: ["MENU", "CHOOSE_SERVICE", "CHOOSE_DATE", "CHOOSE_TIME", "CONFIRM", "CANCEL"],
      default: "MENU"
    },

    temp: { type: Object, default: {} },
    lastInteractionAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

WaSessionSchema.index({ barberId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model("WaSession", WaSessionSchema);
