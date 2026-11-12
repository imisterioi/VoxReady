// Modelo de la revisión humana de un informe: qué se puede editar y cómo se muestra.
//
// Lógica PURA (sin React) para poder probarla. Se usa en dos sitios:
//   · la cola de etiquetado (edición): `editableSections(report)`;
//   · el informe del vocero (lectura): `buildReviewView({ report, review })`.
//
// El CÁLCULO de puntuaciones es un ESPEJO del backend (`backend/lib/reviewScore.js`), que es la
// fuente autoritativa: la misma regla de la rúbrica (media ponderada con reparto del peso de lo no
// medido). Aquí solo sirve para mostrar el resultado en vivo mientras se edita; lo que se guarda y
// lo que ve el vocero lo calcula el servidor.
//
// Es modular: un área, un subcriterio o una sección de texto nuevos funcionan sin tocar este archivo
// (las claves son dinámicas y las secciones se describen en `editableSections`).

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

// Media ponderada de la rúbrica (idéntica al evaluador y al backend).
export function weightedAverage(items = []) {
  const valid = items.filter((item) => item && item.score != null && num(item.weight) > 0);
  const total = valid.reduce((sum, item) => sum + num(item.weight), 0);
  return total ? valid.reduce((sum, item) => sum + item.score * num(item.weight), 0) / total : null;
}

const round = (value) => (value == null || !Number.isFinite(value) ? null : Math.round(value));
const filled = (value) => value != null && value !== '';

// Puntuación de un área: SIEMPRE derivada de sus subcriterios (no se puede fijar a mano).
//  - si algún subcriterio cambia de valor → media ponderada de sus subcriterios (la rúbrica);
//  - si no cambia ninguno → se conserva la de la IA (no se altera lo que nadie revisó).
export function resolveAreaScore(area, detailEdits = {}) {
  const details = area?.details || [];
  const changed = details.some((detail) => {
    const value = detailEdits[`${area.key}.${detail.key}`]?.score;
    return filled(value) && Number(value) !== Number(detail.score);
  });
  if (changed) {
    const weighted = details.map((detail) => {
      const value = detailEdits[`${area.key}.${detail.key}`]?.score;
      return { weight: detail.weight, score: filled(value) ? Number(value) : detail.score };
    });
    return { score: round(weightedAverage(weighted)), source: 'details' };
  }
  if (area?.score != null) return { score: area.score, source: 'ai' };
  return { score: null, source: 'none' };
}

// Puntuación entera de un subcriterio (se muestra siempre sin decimales).
export function subcriterionScore(detail, change) {
  const value = change?.score;
  const raw = filled(value) ? Number(value) : detail?.score;
  return raw == null || !Number.isFinite(Number(raw)) ? null : Math.round(Number(raw));
}

// Puntaje global: media ponderada de las áreas (nunca editable).
export function resolveGlobal(report, scores = {}) {
  return round(
    weightedAverage(
      (report?.areas || []).map((area) => ({
        weight: area.weight ?? report?.weights?.[area.key] ?? 0,
        score: scores[area.key] ?? area.score,
      })),
    ),
  );
}

// ------------------------------------------------------------------ Edición

// Secciones editables del informe, en el orden en que se muestran a la persona que revisa.
export function editableSections(report = {}) {
  return {
    texts: [
      { key: 'resumen', value: report.resumen || '' },
      { key: 'cita', value: report.cita || '' },
    ],
    lists: [
      { key: 'fortalezas', values: report.fortalezas || [] },
      { key: 'mejoras', values: report.mejoras || [] },
    ],
    questions: (report.porPregunta || []).map((item) => ({ key: String(item.pregunta), value: item.comentario || '' })),
    areas: (report.areas || []).map((area) => ({
      key: area.key,
      weight: area.weight,
      score: area.score,
      details: (area.details || []).map((detail) => ({
        key: detail.key,
        weight: detail.weight,
        score: detail.score,
        value: detail.value,
        unit: detail.unit,
      })),
    })),
  };
}

// ------------------------------------------------------------------ Lectura

const sameText = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
const sameList = (a = [], b = []) => a.length === b.length && a.every((item, index) => String(item) === String(b[index] ?? ''));

// Vista del informe con la revisión PUBLICADA aplicada.
//   · texto editado → se muestra SOLO el de la persona, marcado como editado (no se muestra el de la IA);
//   · puntuación → `delta` 1 (sube) | -1 (baja) | 0 (sin indicador);
//   · campo no tocado → exactamente el original.
export function buildReviewView({ report = {}, review = null } = {}) {
  const texts = {};
  for (const key of ['resumen', 'cita']) {
    const original = report[key] || '';
    const edited = review?.texts?.[key];
    texts[key] = {
      value: edited ?? original,
      edited: Boolean(edited),
      original,
      // Fragmentos guardados por el servidor: solo los cambiados se destacan en el informe.
      segments: review?.segments?.texts?.[key] || null,
    };
  }

  const lists = {};
  for (const key of ['fortalezas', 'mejoras']) {
    const original = report[key] || [];
    const edited = review?.lists?.[key];
    const values = edited ?? original;
    const storedSegments = review?.segments?.lists?.[key] || null;
    lists[key] = {
      values,
      // La marca es POR ELEMENTO: solo se resalta el texto que cambió.
      items: values.map((value, index) => {
        const segments = storedSegments?.[index] || null;
        const itemEdited = segments ? segments.some((segment) => segment.changed) : Boolean(edited) && !sameText(value, original[index]);
        return { value, segments, edited: itemEdited };
      }),
      edited: Boolean(edited) && !sameList(values, original),
    };
  }

  const questions = {};
  for (const item of report.porPregunta || []) {
    const key = String(item.pregunta);
    const original = item.comentario || '';
    const edited = review?.questions?.[key];
    questions[key] = {
      value: edited ?? original,
      edited: Boolean(edited) && !sameText(edited, original),
      segments: review?.segments?.questions?.[key] || null,
    };
  }

  const areas = (report.areas || []).map((area) => {
    const resolved = resolveAreaScore(area, review?.details || {});
    const score = review ? resolved.score : area.score;
    const details = (area.details || []).map((detail) => {
      const change = review?.details?.[`${area.key}.${detail.key}`];
      // Las puntuaciones se muestran SIEMPRE como enteros (sin decimales).
      const score = subcriterionScore(detail, change);
      const originalScore = detail.score == null ? null : Math.round(Number(detail.score));
      return {
        ...detail,
        score,
        originalScore,
        // Los subcriterios solo se puntúan: no tienen retroalimentación propia.
        delta: score != null && originalScore != null ? Math.sign(score - originalScore) : 0,
      };
    });
    return {
      ...area,
      score: score == null ? null : Math.round(Number(score)),
      feedback: review?.areas?.[area.key]?.feedback || null,
      // El indicador compara la puntuación final (derivada) con la que midió la IA.
      delta:
        review && area.score != null && score != null ? Math.sign(Math.round(Number(score)) - Math.round(Number(area.score))) : 0,
      details,
    };
  });

  const comment = review?.comment || '';
  return {
    reviewed: Boolean(review),
    reviewer: review?.reviewer || null,
    sentAt: review?.sentAt || review?.at || null,
    global: review?.global ?? report.global ?? null,
    globalDelta: review?.global != null && report.global != null ? Math.sign(review.global - report.global) : 0,
    comment: { text: comment, empty: !comment },
    texts,
    lists,
    questions,
    areas,
  };
}

