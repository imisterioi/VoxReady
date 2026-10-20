// Métricas de texto del flujo del vocero, calculadas en el SERVIDOR.
//
// La lista de muletillas y el conteo de palabras son los mismos que usa el navegador en
// `frontend/src/lib/practice/speech.js` (const FILLER_RE / analyzeText). Aquí se mantiene
// una única definición del patrón en el backend y un test (`tests/evaluation-integrity.test.js`)
// comprueba que NO diverja del patrón del frontend.
//
// Por qué existe: el cliente puede manipular `words` y `fillers` en la petición; el servidor
// los recalcula a partir del texto de las respuestas (dato que también envía el cliente, pero
// que es la única fuente de contenido disponible y queda registrado tal cual en la sesión).

// Mismo patrón que frontend/src/lib/practice/speech.js (FILLER_RE).
const FILLER_PATTERN = '\\b(e+h+|e+m+|m{2,}|este|o sea|bueno|pues|digamos|cachai|onda|como que|a ver)\\b';
const FILLER_RE = new RegExp(FILLER_PATTERN, 'gi');

// Límites de cordura: por encima de esto el dato no es creíble y se descarta.
const MAX_WORDS = 5000; // por respuesta
const MAX_ANSWER_CHARS = 20000;
const MAX_WPM = 400; // una persona no habla a 400 palabras/min de forma sostenida
const MAX_FILLERS_PER_MIN = 100;

function countWords(text = '') {
  const clean = String(text ?? '').trim();
  return clean ? clean.split(/\s+/).length : 0;
}

// Misma forma que analyzeText del frontend: { words, fillers, fillerWords }.
function analyzeText(text = '') {
  const source = String(text ?? '');
  const found = (source.match(FILLER_RE) || []).map((word) => word.toLowerCase());
  return { words: countWords(source), fillers: found.length, fillerWords: found };
}

// Palabras por minuto a partir de una duración de HABLA (no de la grabación completa).
// Devuelve null si la duración no sirve para calcular una velocidad creíble.
function wordsPerMinute(words, speakingMs) {
  if (!Number.isFinite(words) || !Number.isFinite(speakingMs)) return null;
  if (speakingMs < 3000 || words <= 0) return null; // < 3 s de habla no da una tasa fiable
  const minutes = speakingMs / 60000;
  const wpm = words / minutes;
  return Number.isFinite(wpm) && wpm > 0 && wpm <= MAX_WPM ? wpm : null;
}

module.exports = {
  FILLER_PATTERN,
  FILLER_RE,
  MAX_ANSWER_CHARS,
  MAX_FILLERS_PER_MIN,
  MAX_WORDS,
  MAX_WPM,
  analyzeText,
  countWords,
  wordsPerMinute,
};
