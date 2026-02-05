const mongoose = require("mongoose");

const AppointmentSchema = new mongoose.Schema(
  {
    barberId: { type: String, required: true, index: true },

    customerPhone: { type: String, required: true },
    customerName: { type: String, default: "" },

    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    serviceNameSnapshot: { type: String, default: "" },

    datetime: { type: Date, required: true, index: true },

    status: { type: String, enum: ["confirmed", "canceled", "no_show"], default: "confirmed" },
    source: { type: String, enum: ["whatsapp", "admin"], default: "whatsapp" },

    cancelCode: { type: String, index: true }
  },
  { timestamps: true }
);

AppointmentSchema.index({ barberId: 1, datetime: 1 }, { unique: true });

module.exports = mongoose.model("Appointment", AppointmentSchema);
