// Revisión humana de un informe: normalización de los cambios y recálculo del puntaje.
//
// REGLA DE CÁLCULO (la MISMA que la rúbrica y el evaluador, `ai/evaluator.js`):
//   media ponderada = Σ(score × weight) / Σ(weight), contando solo los elementos con puntuación
//   medida y peso > 0 (el peso de lo no medido se reparte, exactamente igual que en la rúbrica).
//     · puntuación del ÁREA  = media ponderada de sus SUBCRITERIOS (details) con puntuación medida;
//     · puntuación GLOBAL    = media ponderada de las cuatro ÁREAS.
// El puntaje global NUNCA se acepta del cliente: se recalcula aquí (el frontend solo lo muestra).
//
// El formato del borrador y el de la revisión publicada son el MISMO, de modo que publicar es
// "mover" el borrador a `review` añadiendo la marca de envío. Es modular: un área o un subcriterio
// nuevo funciona sin tocar este archivo (las claves son dinámicas).
//
// QUÉ SE ACEPTA DEL CLIENTE:
//   · textos, listas, comentario de pregunta y RETROALIMENTACIÓN DE ÁREA (la escrita por la persona);
//   · puntuación de SUBCRITERIO (nunca su retroalimentación: los subcriterios solo se puntúan);
//   · comentario adicional (opcional: si llega vacío se BORRA el anterior).
//   · NUNCA la puntuación de un área ni el puntaje global: se derivan aquí con la rúbrica del informe.

const AREAS = ['expression', 'voice', 'coherence', 'empathy', 'listening', 'pressure'];

// Áreas del informe (los informes antiguos tienen cuatro; los nuevos, seis)
const areaKeysOf = (report) =>
  Array.isArray(report?.areas) && report.areas.length ? report.areas.map((area) => area.key).filter(Boolean) : AREAS.slice(0, 4);

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const round = (value) => (value == null || !Number.isFinite(value) ? null : Math.round(value));

// Puntuación válida (0-100) o null si no se envió / se dejó vacía.
function clampScore(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

// Media ponderada de la rúbrica (idéntica al `average()` del evaluador).
function weightedAverage(items = []) {
  const valid = items.filter((item) => item && item.score != null && num(item.weight) > 0);
  const total = valid.reduce((sum, item) => sum + num(item.weight), 0);
  return total ? valid.reduce((sum, item) => sum + item.score * num(item.weight), 0) / total : null;
}

const cleanText = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const cleanList = (value) => {
  if (!Array.isArray(value)) return null;
  const list = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  return list.length ? list : null;
};

// Normaliza lo que envía el cliente: solo se guarda lo que tiene contenido.
function normalizeDraft(body = {}) {
  const draft = {};

  const texts = {};
  for (const key of ['resumen', 'cita']) {
    if (body.texts?.[key] !== undefined) {
      const value = cleanText(body.texts[key]);
      if (value) texts[key] = value;
    }
  }
  if (Object.keys(texts).length) draft.texts = texts;

  const lists = {};
  for (const key of ['fortalezas', 'mejoras']) {
    if (body.lists?.[key] !== undefined) {
      const value = cleanList(body.lists[key]);
      if (value) lists[key] = value;
    }
  }
  if (Object.keys(lists).length) draft.lists = lists;

  if (body.questions && typeof body.questions === 'object') {
    const questions = {};
    for (const [key, value] of Object.entries(body.questions)) {
      const text = cleanText(value);
      if (text) questions[String(key)] = text;
    }
    if (Object.keys(questions).length) draft.questions = questions;
  }

  // Áreas: SOLO se acepta la retroalimentación escrita por la persona. La puntuación del área NO se
  // acepta del cliente (ni con el formato nuevo ni con el antiguo `scores`): se DERIVA de sus
  // subcriterios con la rúbrica del informe. Así no puede quedar inconsistente con ellos.
  const areas = {};
  const source = { ...(body.areas || {}) };
  for (const [key, value] of Object.entries(source)) {
    const entry = value && typeof value === 'object' ? value : {};
    const feedback = cleanText(entry.feedback);
    if (feedback) areas[key] = { feedback };
  }
  if (Object.keys(areas).length) draft.areas = areas;

  // Subcriterios: SOLO su puntuación. La retroalimentación individual de un subcriterio no se acepta:
  // la retroalimentación escrita existe únicamente a nivel de las cuatro áreas principales.
  const details = {};
  for (const [key, value] of Object.entries(body.details || {})) {
    const entry = value && typeof value === 'object' ? value : { score: value };
    const score = clampScore(entry.score);
    if (score != null) details[String(key)] = { score };
  }
  if (Object.keys(details).length) draft.details = details;

  // Comentario adicional (opcional). Se distingue «no lo he tocado» (el campo no viene) de «lo he
  // dejado vacío» (llega vacío): lo segundo BORRA el comentario anterior, para que el apartado
  // desaparezca del informe del vocero.
  if (body.comment !== undefined) draft.comment = cleanText(body.comment);

  return draft;
}

// ¿El borrador no tiene ningún cambio real? Un valor vacío (o `null`, como el comentario borrado) no
// cuenta como cambio: así no se publica una revisión que no toca nada.
function isEmptyDraft(draft) {
  if (!draft) return true;
  const blank = (value) =>
    value == null || value === '' || (typeof value === 'object' && !Object.keys(value).length);
  return Object.values(draft).every(blank);
}

// Puntuación final de un área: SIEMPRE derivada (no se puede fijar a mano).
//  - si la persona cambió algún subcriterio → media ponderada de sus subcriterios (rúbrica);
//  - si no cambió ninguno → se conserva la puntuación de la IA (no se altera lo que nadie revisó).
// Solo se considera «cambiado» un subcriterio cuyo valor final DIFIERE del original.
function areaScore(report, draft, key) {
  const original = report?.areas?.find((area) => area.key === key);
  const details = original?.details || [];
  const changed = details.some((detail) => {
    const edited = draft?.details?.[`${key}.${detail.key}`]?.score;
    return edited != null && edited !== detail.score;
  });

  if (changed) {
    const weighted = details.map((detail) => ({
      weight: detail.weight,
      score: draft?.details?.[`${key}.${detail.key}`]?.score ?? detail.score,
    }));
    return { score: round(weightedAverage(weighted)), source: 'details' };
  }
  if (original?.score != null) return { score: original.score, source: 'ai' };
  return { score: null, source: 'none' };
}

// Construye la revisión final: borrador normalizado + puntuaciones recalculadas + metadatos.
// `report` es el informe ORIGINAL de la IA (fuente de la rúbrica: áreas, subcriterios y pesos).
function buildReview(report, draft, { reviewer = null, at = null, sentAt = null } = {}) {
  const normalized = normalizeDraft(draft);
  const keys = areaKeysOf(report);

  const scores = {};
  const areaSources = {};
  for (const key of keys) {
    const resolved = areaScore(report, normalized, key);
    scores[key] = resolved.score;
    areaSources[key] = resolved.source;
  }

  // Puntaje global: media ponderada de las áreas, con los pesos del informe original.
  const global = round(
    weightedAverage(
      keys.map((key) => ({
        weight: report?.areas?.find((area) => area.key === key)?.weight ?? report?.weights?.[key] ?? 0,
        score: scores[key],
      })),
    ),
  );

  // Diferencia con la IA por área (mide el acuerdo IA-humano; se conserva el campo histórico).
  const agreement = Object.fromEntries(
    keys.map((key) => {
      const ai = report?.areas?.find((area) => area.key === key)?.score ?? null;
      return [key, ai != null && scores[key] != null ? Math.abs(ai - scores[key]) : null];
    }),
  );

  // Fragmentos: para cada texto revisado se guarda QUÉ PARTE cambió respecto del informe original.
  const segments = {};
  const textSegments = {};
  for (const [key, value] of Object.entries(normalized.texts || {})) {
    textSegments[key] = diffSegments(report?.[key] || '', value);
  }
  if (Object.keys(textSegments).length) segments.texts = textSegments;

  const listSegments = {};
  for (const [key, values] of Object.entries(normalized.lists || {})) {
    const original = Array.isArray(report?.[key]) ? report[key] : [];
    listSegments[key] = values.map((value, index) => diffSegments(original[index] ?? '', value));
  }
  if (Object.keys(listSegments).length) segments.lists = listSegments;

  const questionSegments = {};
  for (const [key, value] of Object.entries(normalized.questions || {})) {
    const original = (report?.porPregunta || []).find((item) => String(item.pregunta) === String(key))?.comentario || '';
    questionSegments[key] = diffSegments(original, value);
  }
  if (Object.keys(questionSegments).length) segments.questions = questionSegments;

  return {
    ...normalized,
    // Fragmentos cambiados de cada texto (para destacar solo lo modificado en el informe del vocero).
    segments,
    scores,
    areaSources,
    global,
    agreement,
    reviewer: reviewer ? { id: reviewer.id, name: reviewer.name } : null,
    at: at || new Date().toISOString(),
    ...(sentAt ? { sentAt } : {}),
  };
}

// ---------------------------------------------------------------- Fragmentos
//
// Para destacar SOLO la parte del texto que la persona cambió (y no todo el apartado) se guarda, en
// cada texto revisado, la lista de fragmentos con una marca de «cambiado». El diff es por palabras
// (LCS), determinista y sin dependencias: no se muestra el texto original de la IA, solo se sabe qué
// fragmentos del texto final son nuevos o modificados.

const tokenize = (text) => String(text ?? '').split(/(\s+)/).filter((token) => token !== '');
// Tope de seguridad: con textos muy largos se marca todo como cambiado (no se degrada la respuesta).
const MAX_DIFF_TOKENS = 600;

// Devuelve [{ text, changed }] sobre el TEXTO EDITADO. Los espacios heredan la marca de la palabra
// anterior para que las frases cambiadas no se partan en trozos ilegibles.
function diffSegments(original, edited) {
  const before = tokenize(original);
  const after = tokenize(edited);
  if (!after.length) return [];
  if (!before.length) return [{ text: edited, changed: true }];
  if (before.length > MAX_DIFF_TOKENS || after.length > MAX_DIFF_TOKENS) return [{ text: edited, changed: true }];

  // Longitud de la subsecuencia común más larga (LCS) por tokens.
  const rows = before.length + 1;
  const cols = after.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = before[i - 1] === after[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const keep = new Array(after.length).fill(false);
  let i = before.length;
  let j = after.length;
  while (i > 0 && j > 0) {
    if (before[i - 1] === after[j - 1]) {
      keep[j - 1] = true;
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  // Marca por token: las palabras según el LCS; los espacios heredan la marca de la palabra anterior
  // (o de la siguiente, si son los primeros) para que una frase cambiada no se parta en trozos.
  const flags = after.map((token, index) => (/^\s+$/.test(token) ? null : !keep[index]));
  for (let index = 0; index < after.length; index += 1) {
    if (flags[index] !== null) continue;
    let previous = index - 1;
    while (previous >= 0 && flags[previous] === null) previous -= 1;
    if (previous >= 0) {
      flags[index] = flags[previous];
    } else {
      let next = index + 1;
      while (next < after.length && flags[next] === null) next += 1;
      flags[index] = next < after.length ? flags[next] : false;
    }
  }

  // Unir tokens contiguos con la misma marca.
  const segments = [];
  after.forEach((token, index) => {
    const changed = flags[index];
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) last.text += token;
    else segments.push({ text: token, changed });
  });
  return segments;
}

module.exports = {
  AREAS,
  clampScore,
  weightedAverage,
  normalizeDraft,
  isEmptyDraft,
  areaScore,
  buildReview,
  diffSegments,
};


