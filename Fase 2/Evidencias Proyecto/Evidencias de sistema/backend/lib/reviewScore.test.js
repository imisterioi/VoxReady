// Cálculo y normalización de la revisión humana: misma regla que la rúbrica del evaluador.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReview, normalizeDraft, weightedAverage, areaScore, clampScore, diffSegments, isEmptyDraft } = require('./reviewScore');

// Informe original de la IA (estructura real del evaluador, recortada a lo necesario).
const report = {
  global: 74,
  weights: { expression: 25, voice: 25, coherence: 30, empathy: 20 },
  areas: [
    { key: 'expression', label: 'Expresión', score: 82, weight: 25, details: [{ key: 'presence', label: 'Presencia', weight: 2, score: 90 }, { key: 'facing', label: 'Mirada', weight: 3, score: 78 }] },
    { key: 'voice', label: 'Tono', score: 75, weight: 25, details: [{ key: 'wpm', label: 'Velocidad', weight: 3, score: 80 }, { key: 'fillers', label: 'Muletillas', weight: 3, score: 70 }] },
    { key: 'coherence', label: 'Coherencia', score: 78, weight: 30, details: [{ key: 'keyMessages', label: 'Mensajes', weight: 3, score: 80 }, { key: 'clarity', label: 'Claridad', weight: 1, score: 70 }] },
    { key: 'empathy', label: 'Empatía', score: 45, weight: 20, details: [{ key: 'impact', label: 'Impacto', weight: 3, score: 40 }, { key: 'warmth', label: 'Calidez', weight: 2, score: 50 }, { key: 'responsibility', label: 'Responsabilidad', weight: 2, score: 50 }] },
  ],
};

test('la media ponderada reproduce la regla de la rúbrica (peso de lo no medido se reparte)', () => {
  assert.equal(weightedAverage([{ weight: 2, score: 90 }, { weight: 3, score: 80 }]), 84);
  assert.equal(weightedAverage([{ weight: 2, score: 90 }, { weight: 3, score: null }]), 90);
  assert.equal(weightedAverage([{ weight: 0, score: 90 }]), null);
  assert.equal(weightedAverage([]), null);
});

test('clampScore acepta 0-100, redondea y descarta lo inválido', () => {
  assert.equal(clampScore('55'), 55);
  assert.equal(clampScore(120), 100);
  assert.equal(clampScore(-5), 0);
  assert.equal(clampScore(''), null);
  assert.equal(clampScore('abc'), null);
  assert.equal(clampScore(null), null);
});

test('normalizar un borrador vacío no inventa cambios', () => {
  const draft = normalizeDraft({ texts: { resumen: '   ' }, lists: { fortalezas: [] }, areas: { empathy: { score: '' } }, details: {} });
  assert.deepEqual(draft, {});
  assert.equal(isEmptyDraft(draft), true);
  assert.equal(isEmptyDraft({ comment: null }), true, 'un comentario borrado no es un cambio');
  assert.equal(isEmptyDraft({ details: { 'empathy.warmth': { score: 80 } } }), false);
});

test('un comentario vacío BORRA el anterior; no enviarlo lo conserva', () => {
  assert.deepEqual(normalizeDraft({ comment: '   ' }), { comment: null }, 'vacío → se borra');
  assert.equal(normalizeDraft({ comment: 'Buen trabajo' }).comment, 'Buen trabajo');
  assert.equal(normalizeDraft({ texts: { resumen: 'Hola' } }).comment, undefined, 'no enviarlo no lo toca');
});

test('la retroalimentación de un subcriterio se ignora: solo se acepta su puntuación', () => {
  const draft = normalizeDraft({
    details: { 'empathy.warmth': { score: 70, feedback: 'Texto' }, 'empathy.impact': { feedback: 'Solo texto' } },
  });
  assert.deepEqual(draft.details, { 'empathy.warmth': { score: 70 } });
});

test('normalizar acepta los textos y los subcriterios; la puntuación de área se ignora', () => {
  const legacy = normalizeDraft({ scores: { empathy: 60 }, comment: 'Revisado' });
  assert.equal(legacy.areas, undefined, 'una puntuación de área enviada a mano se ignora');
  assert.equal(legacy.comment, 'Revisado');

  const current = normalizeDraft({
    texts: { resumen: 'Nuevo resumen', cita: 'Frase' },
    lists: { fortalezas: ['Claridad', ' '], mejoras: ['Empatía'] },
    questions: { '1': 'Buen arranque' },
    areas: { empathy: { score: 70, feedback: 'Mejoró el tono' } },
    details: { 'empathy.warmth': { score: 75 } },
  });
  assert.deepEqual(current.texts, { resumen: 'Nuevo resumen', cita: 'Frase' });
  assert.deepEqual(current.lists, { fortalezas: ['Claridad'], mejoras: ['Empatía'] });
  assert.deepEqual(current.questions, { '1': 'Buen arranque' });
  assert.deepEqual(current.areas.empathy, { feedback: 'Mejoró el tono' }, 'solo la retroalimentación');
  assert.deepEqual(current.details['empathy.warmth'], { score: 75 });
});

test('cambiar un subcriterio recalcula la puntuación del área con la rúbrica', () => {
  const draft = normalizeDraft({ details: { 'empathy.warmth': { score: 80 } } });
  const resolved = areaScore(report, draft, 'empathy');
  // (40×3 + 80×2 + 50×2) / 7 = 54.28 → 54
  assert.equal(resolved.score, 54);
  assert.equal(resolved.source, 'details');
});

test('la puntuación de un área NO se acepta del cliente: se deriva de sus subcriterios', () => {
  // Se envía una puntuación de área a mano (formato nuevo y antiguo): se ignora por completo.
  const review = buildReview(report, { areas: { empathy: { score: 10, feedback: 'Texto' } }, scores: { empathy: 5 } });
  assert.equal(review.areas.empathy.score, undefined, 'la puntuación del área no se guarda');
  assert.equal(review.areas.empathy.feedback, 'Texto', 'la retroalimentación sí se guarda');
  assert.equal(review.scores.empathy, 45, 'sin subcriterios cambiados se conserva la de la IA');
  assert.equal(review.areaSources.empathy, 'ai');
});

test('cambiar un subcriterio deriva la puntuación del área con la rúbrica (el global se recalcula)', () => {
  const review = buildReview(report, { details: { 'empathy.warmth': { score: 80 } } });
  assert.equal(review.scores.empathy, 54); // (40×3 + 80×2 + 50×2) / 7 = 54,28 → 54
  assert.equal(review.areaSources.empathy, 'details');
  assert.equal(review.global, 73); // (82×25 + 75×25 + 78×30 + 54×20) / 100 = 73,45 → 73
});

test('un subcriterio enviado con el MISMO valor no altera el área', () => {
  const review = buildReview(report, { details: { 'empathy.warmth': { score: 50 }, 'empathy.impact': { score: 40 } } });
  assert.equal(review.areaSources.empathy, 'ai');
  assert.equal(review.scores.empathy, 45);
});

test('sin cambios se conserva la puntuación de la IA', () => {
  assert.equal(areaScore(report, {}, 'empathy').score, 45);
  assert.equal(areaScore(report, {}, 'empathy').source, 'ai');
});

test('el diff destaca solo la parte modificada del texto', () => {
  const original = 'Demostraste seguridad al responder las preguntas. Mantuviste una buena postura durante la entrevista.';
  const edited = 'Demostraste mucha seguridad y claridad al responder las preguntas. Mantuviste una buena postura durante la entrevista.';
  const segments = diffSegments(original, edited);

  // El texto se reconstruye exacto (nada se pierde ni se duplica).
  assert.equal(segments.map((segment) => segment.text).join(''), edited);

  const changed = segments.filter((segment) => segment.changed).map((segment) => segment.text).join('').trim();
  assert.ok(changed.includes('mucha') && changed.includes('claridad'), changed);
  assert.ok(!changed.includes('Mantuviste'), 'la parte no tocada NO debe marcarse');

  const kept = segments.filter((segment) => !segment.changed).map((segment) => segment.text).join('');
  assert.ok(kept.includes('Mantuviste una buena postura durante la entrevista.'), kept);
});

test('sin cambios reales no se marca nada; un texto nuevo se marca entero', () => {
  assert.deepEqual(diffSegments('Hola mundo', 'Hola mundo'), [{ text: 'Hola mundo', changed: false }]);
  assert.deepEqual(diffSegments('', 'Todo nuevo'), [{ text: 'Todo nuevo', changed: true }]);
  assert.deepEqual(diffSegments('Se quitó todo', ''), []);
});

test('el borrador guarda los fragmentos de los textos editados', () => {
  const review = buildReview(report, { texts: { resumen: 'Resumen nuevo' }, lists: { fortalezas: ['Claridad total'] } });
  assert.equal(review.segments.texts.resumen.map((segment) => segment.text).join(''), 'Resumen nuevo');
  assert.equal(review.segments.texts.resumen.every((segment) => segment.changed), true);
  assert.equal(review.segments.lists.fortalezas.length, 1);
  assert.equal(review.segments.lists.fortalezas[0].map((segment) => segment.text).join(''), 'Claridad total');
});

test('el puntaje global se recalcula con los pesos del informe y nunca se acepta del cliente', () => {
  // Se envían a mano la puntuación del área y el global: los dos se ignoran.
  const review = buildReview(report, { areas: { empathy: { score: 90 } }, global: 1000 }, { reviewer: { id: 'r1', name: 'Revisora' } });
  // Empatía se queda como la midió la IA (45): (82×25 + 75×25 + 78×30 + 45×20) / 100 = 71,65 → 72
  assert.equal(review.scores.empathy, 45);
  assert.equal(review.global, 72);
  assert.notEqual(review.global, 1000);
  assert.deepEqual(review.reviewer, { id: 'r1', name: 'Revisora' });
});

test('el acuerdo IA-humano se conserva por área (campo histórico)', () => {
  // Al cambiar un subcriterio, la empatía derivada queda en 54 frente a los 45 de la IA.
  const review = buildReview(report, { details: { 'empathy.warmth': { score: 80 } } });
  assert.deepEqual(review.agreement, { expression: 0, voice: 0, coherence: 0, empathy: 9 });
});

test('el global ignora las áreas sin puntuación (reparte su peso)', () => {
  const partial = {
    areas: [
      { key: 'empathy', score: 50, weight: 20 },
      { key: 'coherence', score: null, weight: 30 },
      { key: 'expression', score: 80, weight: 25 },
      { key: 'voice', score: null, weight: 25 },
    ],
  };
  const review = buildReview(partial, { texts: { resumen: 'Sin tocar puntuaciones' } });
  // (50×20 + 80×25) / 45 = 66,67 → 67
  assert.equal(review.global, 67);
});
