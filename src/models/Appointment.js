const mongoose = require("mongoose");

const AppointmentSchema = new mongoose.Schema(
  {
    barberId: { type: String, required: true, index: true },

    customerPhone: { type: String, required: true },
    customerName: { type: String, default: "" },

    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    serviceNameSnapshot: { type: String, default: "" },
    durationMinSnapshot: { type: Number, default: 0 },
    priceSnapshot: { type: Number, default: 0 },

    datetime: { type: Date, required: true, index: true },

    status: { type: String, enum: ["confirmed", "canceled"], default: "confirmed" },
    source: { type: String, enum: ["whatsapp", "admin"], default: "whatsapp" },

    cancelCode: { type: String, index: true }
  },
  { timestamps: true }
);

// aynı berber aynı dakikada iki randevu olmasın
AppointmentSchema.index({ barberId: 1, datetime: 1 }, { unique: true });

module.exports = mongoose.model("Appointment", AppointmentSchema);
