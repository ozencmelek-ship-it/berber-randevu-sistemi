function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

// dateYMD: "2026-02-05" gibi
function buildDate(dateYMD, hhmm) {
  const [y, mo, d] = dateYMD.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  // Basit MVP: server timezone ne ise onunla Date oluşturur.
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

// çalışma saatleri içinde, duration’a uygun slot başlangıçları üretir
function generateStartSlots({ dateYMD, startHHMM, endHHMM, stepMin, durationMin }) {
  const start = toMinutes(startHHMM);
  const end = toMinutes(endHHMM);

  const slots = [];
  for (let t = start; t + durationMin <= end; t += stepMin) {
    const hhmm = minutesToHHMM(t);
    slots.push({
      hhmm,
      startAt: buildDate(dateYMD, hhmm),
    });
  }
  return slots;
}

module.exports = { generateStartSlots };
