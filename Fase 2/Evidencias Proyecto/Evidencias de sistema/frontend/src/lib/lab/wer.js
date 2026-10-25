// Métricas de error de transcripción (WER/CER) para el laboratorio.
//
// Normalización DOCUMENTADA (se aplica igual a referencia e hipótesis):
//   1. minúsculas
//   2. se quitan las tildes/diacríticos (NFD + eliminación de marcas): «sesión» → «sesion»
//   3. todo lo que no sea letra, dígito o espacio se convierte en espacio
//   4. espacios repetidos se colapsan
// Las cifras se conservan. El texto ORIGINAL no se modifica: esta función sólo devuelve
// una versión normalizada para comparar.
export function normalizeForComparison(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Distancia de Levenshtein sobre arrays (palabras o caracteres).
export function levenshtein(a = [], b = []) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

// WER con desglose de sustituciones, eliminaciones e inserciones.
// Devuelve null si no hay referencia: nunca se inventa una puntuación.
export function wordErrorRate(reference, hypothesis) {
  const ref = normalizeForComparison(reference);
  if (!ref) return null;
  const refWords = ref.split(' ');
  const hypWords = normalizeForComparison(hypothesis).split(' ').filter(Boolean);

  const rows = refWords.length + 1;
  const cols = hypWords.length + 1;
  const d = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 1; i < rows; i += 1) d[i][0] = i;
  for (let j = 1; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = refWords[i - 1] === hypWords[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }

  // Recorrido inverso para separar los tres tipos de error.
  let i = refWords.length;
  let j = hypWords.length;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refWords[i - 1] === hypWords[j - 1]) {
      i -= 1;
      j -= 1;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      substitutions += 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      deletions += 1;
      i -= 1;
    } else {
      insertions += 1;
      j -= 1;
    }
  }

  return {
    wer: d[refWords.length][hypWords.length] / refWords.length,
    errors: substitutions + deletions + insertions,
    substitutions,
    deletions,
    insertions,
    referenceWords: refWords.length,
    hypothesisWords: hypWords.length,
  };
}

// CER sobre caracteres normalizados (sin espacios), útil cuando el modelo no separa palabras.
export function characterErrorRate(reference, hypothesis) {
  const ref = normalizeForComparison(reference).replace(/\s/g, '');
  if (!ref) return null;
  const hyp = normalizeForComparison(hypothesis).replace(/\s/g, '');
  const distance = levenshtein(ref.split(''), hyp.split(''));
  return { cer: distance / ref.length, distance, referenceChars: ref.length, hypothesisChars: hyp.length };
}
