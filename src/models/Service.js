const mongoose = require("mongoose");

const ServiceSchema = new mongoose.Schema(
  {
    barberId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    durationMin: { type: Number, required: true, min: 5 },
    price: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

ServiceSchema.index({ barberId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Service", ServiceSchema);
