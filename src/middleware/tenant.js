function tenant(req, res, next) {
  req.barberId =
    (req.session && req.session.barberId) ||
    process.env.DEFAULT_BARBER_ID ||
    "hamburg_001";
  next();
}

module.exports = { tenant };
