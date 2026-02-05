const mongoose = require("mongoose");

async function connectDB(uri) {
  if (!uri) throw new Error("MONGODB_URI env eksik");
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("MongoDB bağlandı ✅");
}

module.exports = { connectDB };
