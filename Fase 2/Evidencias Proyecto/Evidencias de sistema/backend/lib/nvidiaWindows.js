// Ventanas de audio de cada respuesta, listas para recortar el `<id>.audio.webm`.
//
// `startMs`/`endMs` los registra SesionPractica relativos al inicio de ESE archivo. Aquí
// sólo se validan y se les añade un margen prudente sin invadir la respuesta vecina.
// Nunca se reparte el texto por proporciones: si una ventana no es utilizable, se marca.
const DEFAULT_PAD_MS = 200;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function windowsForTurns({ turns = [], padMs = DEFAULT_PAD_MS } = {}) {
  const pad = Math.max(0, Number(padMs) || 0);
  const base = (Array.isArray(turns) ? turns : []).map((turn, index) => ({
    index,
    startMs: number(turn?.startMs),
    endMs: number(turn?.endMs),
  }));

  // Límites vecinos ya válidos: una ventana nunca los cruza.
  return base.map((item) => {
    if (item.startMs == null || item.endMs == null) {
      return { ...item, ok: false, reason: 'NO_TIMES' };
    }
    if (item.startMs < 0 || item.endMs <= item.startMs) {
      return { ...item, ok: false, reason: 'INVALID_RANGE' };
    }

    let start = Math.max(0, item.startMs - pad);
    let end = item.endMs + pad;

    const previous = base
      .filter((other) => other.index !== item.index && other.startMs != null && other.endMs != null)
      .filter((other) => other.endMs <= item.startMs)
      .sort((a, b) => b.endMs - a.endMs)[0];
    const next = base
      .filter((other) => other.index !== item.index && other.startMs != null && other.endMs != null)
      .filter((other) => other.startMs >= item.endMs)
      .sort((a, b) => a.startMs - b.startMs)[0];

    if (previous) start = Math.max(start, previous.endMs);
    if (next) end = Math.min(end, next.startMs);
    if (end <= start) return { ...item, ok: false, reason: 'EMPTY_AFTER_PAD' };

    return { index: item.index, startMs: Math.round(start), endMs: Math.round(end), ok: true, reason: null };
  });
}

module.exports = { windowsForTurns, DEFAULT_PAD_MS };
