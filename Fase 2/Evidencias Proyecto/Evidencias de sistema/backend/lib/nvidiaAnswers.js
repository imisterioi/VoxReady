// Asigna los segmentos de una transcripción a las ventanas [startMs, endMs] de cada
// respuesta del vocero.
//
// REGLA: un segmento se asigna al turno con el que MÁS se solapa en el tiempo. Si no se
// solapa con ninguna ventana (o la ventana no es válida) el texto queda en `orphans` y NO
// se atribuye a ninguna pregunta: nunca se reparte por proporciones ni por parecido.
//
// Los tiempos son milisegundos desde el inicio de la grabación de audio que se transcribe.

const toMs = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function windowOf(turn) {
  const start = toMs(turn?.startMs);
  const end = toMs(turn?.endMs);
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

function answersFromSegments({ turns = [], segments = [] } = {}) {
  const parts = turns.map(() => []);
  const orphans = [];
  const windows = turns.map(windowOf);

  for (const segment of Array.isArray(segments) ? segments : []) {
    const start = toMs(segment?.start) == null ? null : toMs(segment.start) * 1000;
    const end = toMs(segment?.end) == null ? null : toMs(segment.end) * 1000;
    const text = String(segment?.text ?? '').trim();
    if (!text || start == null || end == null || end <= start) {
      if (text) orphans.push(text);
      continue;
    }

    let bestIndex = -1;
    let bestOverlap = 0;
    windows.forEach((window, index) => {
      if (!window) return;
      const overlap = Math.max(0, Math.min(window.end, end) - Math.max(window.start, start));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0 && bestOverlap > 0) parts[bestIndex].push(text);
    else orphans.push(text);
  }

  return {
    answers: parts.map((chunks) => chunks.join(' ').trim()),
    orphans,
    // Turnos sin ninguna coincidencia: el llamador debe decidir (no inventar texto).
    emptyTurns: parts.map((chunks, index) => (chunks.length ? null : index)).filter((index) => index != null),
  };
}

module.exports = { answersFromSegments };
