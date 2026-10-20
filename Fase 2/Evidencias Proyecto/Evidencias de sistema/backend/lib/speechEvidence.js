// Evidencia de habla derivada del AUDIO de la sesión (Whisper), no del navegador.
//
// Objetivo: calcular palabras/minuto con dos magnitudes que salen del mismo audio:
//   - numerador  : palabras que Whisper oyó en los tramos que corresponden a cada respuesta
//   - denominador: tiempo de HABLA de esos tramos (no la duración de la grabación)
//
// Reglas documentadas (y probadas en `tests/speech-evidence.test.js`):
//  1. Emparejamiento: cada respuesta se compara con los segmentos en orden cronológico y
//     sin reutilizar segmentos (cursor monotónico). Se exige que al menos el 60 % de las
//     palabras de la respuesta aparezcan en el audio emparejado.
//  2. Tiempo de habla por segmento: desde la PRIMERA palabra hasta la ÚLTIMA palabra.
//     No se usa `end - start` del segmento: el VAD añade márgenes y puede absorber pausas
//     largas dentro de un mismo segmento (medido: +43 % en una prueba con voz sintética).
//  3. Pausas: un hueco entre palabras mayor que PAUSE_GAP_MS (400 ms) NO es habla y se
//     descuenta. Los huecos cortos (respiraciones, oclusivas) sí cuentan.
//  4. Solapamientos: los intervalos se recortan a [0, duración] cuando la duración es
//     conocida, se fusionan si se solapan y se descartan los inválidos o vacíos.
//  5. Segmentos sin marcas por palabra no aportan tiempo (no se pueden medir); si todos
//     carecen de ellas, el resultado es `unverified` con motivo, nunca una excepción.
//  6. Los umbrales son conservadores a propósito: es preferible excluir el criterio de
//     velocidad antes que puntuarlo con una evidencia que no lo sostiene.

const PAUSE_GAP_MS = 400;
const MIN_COVERAGE = 0.6;
const MIN_WORDS = 3;
const MIN_SPEECH_MS = 3000;
const MIN_VERIFIED_FRACTION = 0.5;
const MIN_TOTAL_SPEECH_MS = 10000;
const MAX_WPM_VALUE = 400;
const MAX_SEGMENTS_PER_TURN = 12;
const MAX_SEGMENT_DURATION_MS = 5 * 60 * 1000;

const round = (value, decimals = 3) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// Palabras funcionales: no sirven para decidir si un segmento pertenece a una respuesta
// (sin esto, "con la familia" emparejaría con la pregunta "¿con quién?").
// Para el WPM sí cuentan: son palabras pronunciadas.
const STOPWORDS = new Set(
  ('a al algo alguna algunas alguno algunos ante antes como con contra cual cuando de del desde donde ' +
    'durante e el ella ellas ello ellos en entre era es esa esas ese eso esos esta estas este esto estos ' +
    'fue ha han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o os otra ' +
    'otras otro otros para pero poco por porque que quien se ser si sin sobre so su sus tambien tanto te ' +
    'tiene todo todos tu tus un una uno unos y ya soy eres somos').split(' '),
);


// --------------------------------------------------------------- texto

// Minúsculas, sin tildes/diacríticos y solo letras o dígitos: "Buenos días." → ["buenos","dias"]
function normalizeTokens(text) {
  if (typeof text !== 'string' || !text) return [];
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

// Cuántas palabras de `answer` aparecen en `segment` (multiconjunto: no inventa repeticiones).
// Se usa desde `matchTurn` a través del mapa de palabras restantes; se conserva como helper
// puro para pruebas y para calcular coberturas puntuales.
function overlapCount(answerCounts, segmentCounts) {
  let matched = 0;
  for (const [token, count] of answerCounts) {
    const available = segmentCounts.get(token);
    if (available) matched += Math.min(count, available);
  }
  return matched;
}

// ------------------------------------------------------------ segmentos

// Normaliza la respuesta del servicio: descarta lo que no se puede medir y no lanza nunca.
function sanitizeSegments(rawSegments) {
  const segments = [];
  let dropped = 0;
  if (!Array.isArray(rawSegments)) return { segments, dropped };

  for (const raw of rawSegments) {
    if (!raw || typeof raw !== 'object') {
      dropped += 1;
      continue;
    }
    const text = typeof raw.text === 'string' ? raw.text : '';
    const words = [];
    if (Array.isArray(raw.words)) {
      for (const word of raw.words) {
        if (!word || typeof word !== 'object') continue;
        const start = Number(word.start) * 1000;
        const end = Number(word.end) * 1000;
        const value = typeof word.word === 'string' ? word.word : '';
        if (!isFiniteNumber(start) || !isFiniteNumber(end)) continue;
        if (start < 0 || end <= start || !value.trim()) continue;
        words.push({ start, end, text: value });
      }
    }
    words.sort((a, b) => a.start - b.start);

    const start = Number(raw.start) * 1000;
    const end = Number(raw.end) * 1000;
    const usableWords = words.length > 0;
    if (!usableWords && !(isFiniteNumber(start) && isFiniteNumber(end) && end > start)) {
      dropped += 1;
      continue;
    }
    // Solo interesa el texto para emparejar; nunca se persiste.
    const tokens = normalizeTokens(text || words.map((word) => word.text).join(' '));
    // Sin palabras ni texto no hay nada que medir ni que comparar.
    if (!words.length && !tokens.length) {
      dropped += 1;
      continue;
    }
    segments.push({
      start: usableWords ? words[0].start : start,
      end: usableWords ? words[words.length - 1].end : end,
      words,
      tokens,
      content: tokens.filter((token) => !STOPWORDS.has(token)).length,
      counts: countTokens(tokens.filter((token) => !STOPWORDS.has(token))),
    });
  }
  segments.sort((a, b) => a.start - b.start);
  return { segments, dropped };
}

// Intervalos de HABLA de un segmento: une palabras separadas por huecos <= PAUSE_GAP_MS
// y corta cuando el silencio es mayor (esa pausa no es tiempo hablado).
function speechIntervals(segment) {
  const words = segment.words;
  if (!Array.isArray(words) || words.length === 0) return [];
  const intervals = [];
  let start = words[0].start;
  let end = words[0].end;
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    if (word.start - end > PAUSE_GAP_MS) {
      intervals.push([start, end]);
      start = word.start;
    }
    end = Math.max(end, word.end);
  }
  intervals.push([start, end]);
  return intervals;
}

// Fusiona intervalos solapados o contiguos y descarta los inválidos.
function mergeIntervals(intervals, durationMs = null) {
  const limit = isFiniteNumber(durationMs) && durationMs > 0 ? durationMs : null;
  const cleaned = [];
  for (const [rawStart, rawEnd] of intervals) {
    let start = Math.max(0, rawStart);
    let end = limit ? Math.min(rawEnd, limit) : rawEnd;
    if (!isFiniteNumber(start) || !isFiniteNumber(end)) continue;
    if (end - start <= 0) continue;
    if (end - start > MAX_SEGMENT_DURATION_MS) end = start + MAX_SEGMENT_DURATION_MS;
    cleaned.push([start, end]);
  }
  cleaned.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of cleaned) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([interval[0], interval[1]]);
  }
  return merged;
}

const totalMs = (intervals) => intervals.reduce((sum, [start, end]) => sum + (end - start), 0);

// ------------------------------------------------------------ emparejamiento

// Busca el tramo de segmentos que corresponde a UNA respuesta, empezando en `from`.
// Devuelve la mejor cobertura encontrada y hasta dónde se consumió el audio.
//
// Dos detalles que se aprendieron midiendo con audio real:
//  - Cada palabra de la respuesta se "gasta" una sola vez: la cobertura nunca pasa de 1
//    aunque varias frases repitan la misma palabra.
//  - Un segmento solo cuenta si aporta de verdad (>= 2 palabras, o la mayoría de un
//    segmento corto). Así una pregunta del entrevistador que comparte UNA palabra
//    ("investigación") no se suma al tiempo de habla del vocero.
function matchTurn(answerCounts, answerTokens, segments, from) {
  const total = answerTokens.length || 1;
  const remaining = new Map(answerCounts);
  let matchedUseful = 0;
  let idle = 0;
  let best = { coverage: 0, next: from, segments: [] };
  const window = [];

  for (let i = from; i < segments.length && window.length < MAX_SEGMENTS_PER_TURN; i += 1) {
    const segment = segments[i];
    let hit = 0;
    for (const [token, count] of segment.counts) {
      const left = remaining.get(token) || 0;
      if (!left) continue;
      const use = Math.min(left, count);
      remaining.set(token, left - use);
      hit += use;
    }
    const ratio = hit / Math.max(1, segment.content || 0);
    const useful = hit >= 2 || (hit >= 1 && ratio >= 0.5);
    window.push({ segment, hit, useful });
    if (useful) matchedUseful += hit;

    const coverage = matchedUseful / total;
    if (coverage > best.coverage) {
      best = { coverage, next: i + 1, segments: window.filter((item) => item.useful) };
    }
    if (coverage >= 0.95) break;
    if (!useful) {
      idle += 1;
      // Dos segmentos seguidos sin aportar nada: se deja de buscar (sin consumir audio).
      if (idle >= 2) break;
    } else {
      idle = 0;
    }
  }
  return best;
}

function unverified(reason, extra = {}) {
  return {
    status: 'unverified',
    reason,
    model: extra.model ?? null,
    wpm: null,
    speechMs: 0,
    words: 0,
    turns: extra.turns ?? [],
    // Se conserva la cobertura real aunque el veredicto sea negativo: es auditoría útil.
    coverage: extra.coverage ?? {
      answeredTurns: extra.answeredTurns ?? 0,
      verifiedTurns: 0,
      fraction: 0,
      wordCoverage: 0,
      audioDurationSeconds: extra.audioDurationSeconds ?? null,
    },
    droppedSegments: extra.droppedSegments ?? 0,
  };
}

// Punto de entrada puro: recibe los turnos ya normalizados y los segmentos del servicio.
function computeSpeechEvidence({ turns = [], segments: rawSegments, durationSeconds = null, model = null } = {}) {
  const answeredTurns = turns.filter((turn) => typeof turn?.answer === 'string' && turn.answer.trim());
  if (!answeredTurns.length) return unverified('NO_ANSWERS', { model });

  const { segments, dropped } = sanitizeSegments(rawSegments);
  if (!segments.length) {
    return unverified(dropped ? 'INVALID_TIMESTAMPS' : 'NO_SEGMENTS', { model, droppedSegments: dropped });
  }

  const durationMs = isFiniteNumber(durationSeconds) && durationSeconds > 0 ? durationSeconds * 1000 : null;
  const perTurn = [];
  let cursor = 0;

  for (let index = 0; index < turns.length; index += 1) {
    const answer = typeof turns[index]?.answer === 'string' ? turns[index].answer : '';
    const allTokens = normalizeTokens(answer);
    if (!allTokens.length) continue;
    // Se empareja por palabras con contenido; si la respuesta fuese solo funcionales, con todas.
    const contentTokens = allTokens.filter((token) => !STOPWORDS.has(token));
    const answerTokens = contentTokens.length ? contentTokens : allTokens;

    const best = matchTurn(countTokens(answerTokens), answerTokens, segments, cursor);
    cursor = best.next;

    if (best.coverage < MIN_COVERAGE || !best.segments.length) {
      perTurn.push({ index, verified: false, reason: 'LOW_COVERAGE', coverage: round(best.coverage) });
      continue;
    }

    const words = best.segments.flatMap((item) => item.segment.words);
    if (!words.length) {
      perTurn.push({ index, verified: false, reason: 'NO_WORD_TIMESTAMPS', coverage: round(best.coverage) });
      continue;
    }
    if (words.length < MIN_WORDS) {
      perTurn.push({ index, verified: false, reason: 'TOO_FEW_WORDS', coverage: round(best.coverage) });
      continue;
    }

    const intervals = mergeIntervals(
      best.segments.flatMap((item) => speechIntervals(item.segment)),
      durationMs,
    );
    const speechMs = totalMs(intervals);
    if (speechMs <= 0) {
      perTurn.push({ index, verified: false, reason: 'NO_WORD_TIMESTAMPS', coverage: round(best.coverage) });
      continue;
    }
    if (speechMs < MIN_SPEECH_MS) {
      perTurn.push({ index, verified: false, reason: 'SHORT_SPEECH', coverage: round(best.coverage) });
      continue;
    }

    perTurn.push({
      index,
      verified: true,
      coverage: round(best.coverage),
      words: words.length,
      speechMs: Math.round(speechMs),
      wpm: round(words.length / (speechMs / 60000), 1),
    });
  }

  const verified = perTurn.filter((turn) => turn?.verified);
  const coverage = {
    answeredTurns: answeredTurns.length,
    verifiedTurns: verified.length,
    fraction: round(verified.length / answeredTurns.length),
    wordCoverage: verified.length ? round(verified.reduce((sum, turn) => sum + turn.coverage, 0) / verified.length) : 0,
    audioDurationSeconds: durationSeconds ?? null,
  };
  const base = { model, answeredTurns: answeredTurns.length, droppedSegments: dropped, audioDurationSeconds: durationSeconds, turns: perTurn, coverage };

  if (!verified.length) return unverified('NO_VERIFIED_TURNS', base);
  if (coverage.fraction < MIN_VERIFIED_FRACTION) return unverified('LOW_SESSION_COVERAGE', base);

  const totalWords = verified.reduce((sum, turn) => sum + turn.words, 0);
  const totalSpeechMs = verified.reduce((sum, turn) => sum + turn.speechMs, 0);
  if (totalSpeechMs < MIN_TOTAL_SPEECH_MS) return unverified('TOO_LITTLE_SPEECH', base);

  const wpm = totalWords / (totalSpeechMs / 60000);
  if (!isFiniteNumber(wpm) || wpm <= 0 || wpm > MAX_WPM_VALUE) return unverified('IMPLAUSIBLE_WPM', base);

  return {
    status: 'verified',
    reason: null,
    model,
    wpm: round(wpm, 1),
    speechMs: Math.round(totalSpeechMs),
    words: totalWords,
    turns: perTurn,
    coverage,
    droppedSegments: dropped,
  };
}

module.exports = {
  MAX_SEGMENTS_PER_TURN,
  MAX_WPM_VALUE,
  MIN_COVERAGE,
  MIN_SPEECH_MS,
  MIN_TOTAL_SPEECH_MS,
  MIN_VERIFIED_FRACTION,
  MIN_WORDS,
  PAUSE_GAP_MS,
  computeSpeechEvidence,
  countTokens,
  matchTurn,
  mergeIntervals,
  normalizeTokens,
  overlapCount,
  sanitizeSegments,
  speechIntervals,
  totalMs,
};
