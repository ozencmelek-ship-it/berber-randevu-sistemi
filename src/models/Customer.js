const mongoose = require("mongoose");

const CustomerSchema = new mongoose.Schema(
  {
    barberId: { type: String, required: true, index: true },
    phone: { type: String, required: true },
    name: { type: String, default: "" },
    notes: { type: String, default: "" },
    lastVisitAt: { type: Date }
  },
  { timestamps: true }
);

CustomerSchema.index({ barberId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model("Customer", CustomerSchema);
