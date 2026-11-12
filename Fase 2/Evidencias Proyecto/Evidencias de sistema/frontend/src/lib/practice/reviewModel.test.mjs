// Modelo de la revisión humana: edición, recálculo y vista del informe revisado.
// Los valores esperados del recálculo son los MISMOS que en `backend/lib/reviewScore.test.js`
// (las dos implementaciones comparten la regla de la rúbrica).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewView, editableSections, resolveAreaScore, resolveGlobal, weightedAverage } from './reviewModel.js';

const report = {
  global: 74,
  weights: { expression: 25, voice: 25, coherence: 30, empathy: 20 },
  resumen: 'Resumen de la IA',
  cita: 'Frase de la IA',
  fortalezas: ['Claridad'],
  mejoras: ['Empatía'],
  porPregunta: [{ pregunta: 1, comentario: 'Comentario IA 1' }],
  areas: [
    { key: 'expression', label: 'Expresión', score: 82, weight: 25, details: [{ key: 'presence', label: 'Presencia', weight: 2, score: 90 }, { key: 'facing', label: 'Mirada', weight: 3, score: 78 }] },
    { key: 'voice', label: 'Tono', score: 75, weight: 25, details: [{ key: 'wpm', label: 'Velocidad', weight: 3, score: 80 }, { key: 'fillers', label: 'Muletillas', weight: 3, score: 70 }] },
    { key: 'coherence', label: 'Coherencia', score: 78, weight: 30, details: [{ key: 'keyMessages', label: 'Mensajes', weight: 3, score: 80 }, { key: 'clarity', label: 'Claridad', weight: 1, score: 70 }] },
    { key: 'empathy', label: 'Empatía', score: 45, weight: 20, details: [{ key: 'impact', label: 'Impacto', weight: 3, score: 40 }, { key: 'warmth', label: 'Calidez', weight: 2, score: 50 }, { key: 'responsibility', label: 'Responsabilidad', weight: 2, score: 50 }] },
  ],
};

test('la media ponderada replica la rúbrica', () => {
  assert.equal(weightedAverage([{ weight: 2, score: 90 }, { weight: 3, score: 80 }]), 84);
  assert.equal(weightedAverage([{ weight: 2, score: 90 }, { weight: 3, score: null }]), 90);
  assert.equal(weightedAverage([]), null);
});

test('las secciones editables salen del informe (modular)', () => {
  const sections = editableSections(report);
  assert.deepEqual(sections.texts.map((t) => t.key), ['resumen', 'cita']);
  assert.deepEqual(sections.lists.map((l) => l.key), ['fortalezas', 'mejoras']);
  assert.deepEqual(sections.questions.map((q) => q.key), ['1']);
  assert.deepEqual(sections.areas.map((a) => a.key), ['expression', 'voice', 'coherence', 'empathy']);
  assert.deepEqual(sections.areas[3].details.map((d) => d.key), ['impact', 'warmth', 'responsibility']);
});

test('cambiar un subcriterio recalcula el área con la rúbrica (igual que el backend)', () => {
  const resolved = resolveAreaScore(report.areas[3], { 'empathy.warmth': { score: 80 } });
  assert.equal(resolved.score, 54);
  assert.equal(resolved.source, 'details');
});

test('la puntuación de un área no se puede fijar a mano: se deriva de sus subcriterios', () => {
  // Aunque se pase una puntuación de área, el resultado sale de los subcriterios (o de la IA).
  assert.equal(resolveAreaScore(report.areas[3], {}).score, 45, 'sin cambios se conserva la de la IA');
  assert.equal(resolveAreaScore(report.areas[3], { 'empathy.warmth': { score: 50 } }).score, 45, 'mismo valor → sin cambio');
  const global = resolveGlobal(report, { expression: 82, voice: 75, coherence: 78, empathy: 54 });
  // (82×25 + 75×25 + 78×30 + 54×20) / 100 = 73,45 → 73
  assert.equal(global, 73);
});

test('sin revisión la vista muestra exactamente el informe original', () => {
  const view = buildReviewView({ report });
  assert.equal(view.reviewed, false);
  assert.equal(view.global, 74);
  assert.equal(view.texts.resumen.value, 'Resumen de la IA');
  assert.equal(view.texts.resumen.edited, false);
  assert.deepEqual(view.lists.mejoras.values, ['Empatía']);
  assert.equal(view.lists.mejoras.edited, false);
  assert.equal(view.comment.empty, true);
  assert.equal(view.areas[3].score, 45);
  assert.equal(view.areas[3].delta, 0, 'sin revisión no hay indicadores');
  assert.equal(view.areas[3].details[1].score, 50);
});

test('un texto editado reemplaza al de la IA y queda marcado', () => {
  const view = buildReviewView({ report, review: { texts: { resumen: 'Resumen revisado' }, reviewer: { name: 'Revisora' } } });
  assert.equal(view.texts.resumen.value, 'Resumen revisado');
  assert.equal(view.texts.resumen.edited, true);
  assert.equal(view.texts.cita.value, 'Frase de la IA', 'lo no tocado se conserva');
  assert.equal(view.texts.cita.edited, false);
});

test('con fragmentos guardados solo se marca la parte modificada de cada elemento', () => {
  const view = buildReviewView({
    report,
    review: {
      lists: { fortalezas: ['Demostraste mucha seguridad y claridad al responder.', 'Mantuviste una buena postura.'] },
      segments: {
        lists: {
          fortalezas: [
            [
              { text: 'Demostraste', changed: false },
              { text: ' mucha seguridad y claridad', changed: true },
              { text: ' al responder.', changed: false },
            ],
            [{ text: 'Mantuviste una buena postura.', changed: false }],
          ],
        },
      },
    },
  });
  const items = view.lists.fortalezas.items;
  assert.equal(items.length, 2);
  assert.equal(items[0].edited, true, 'el primer elemento cambió');
  assert.equal(items[1].edited, false, 'el segundo NO cambió: no se marca');
  assert.deepEqual(items[0].segments.map((s) => s.changed), [false, true, false]);
  assert.equal(view.lists.fortalezas.edited, true);
});

test('una lista editada reemplaza la de la IA; si es igual, no se marca', () => {
  const changed = buildReviewView({ report, review: { lists: { mejoras: ['Escucha activa'] } } });
  assert.deepEqual(changed.lists.mejoras.values, ['Escucha activa']);
  assert.equal(changed.lists.mejoras.edited, true);
  const same = buildReviewView({ report, review: { lists: { mejoras: ['Empatía'] } } });
  assert.equal(same.lists.mejoras.edited, false, 'sin cambios reales no se marca');
});

test('las puntuaciones revisadas indican subida o bajada', () => {
  const view = buildReviewView({
    report,
    // La puntuación del área se IGNORA: todo se deriva de los subcriterios.
    review: { areas: { empathy: { score: 60 } }, details: { 'empathy.warmth': { score: 30 } } },
  });
  const empathy = view.areas.find((area) => area.key === 'empathy');
  // (40×3 + 30×2 + 50×2) / 7 = 40
  assert.equal(empathy.score, 40);
  assert.equal(empathy.delta, -1, 'baja → indicador de bajada');
  assert.equal(empathy.details[1].score, 30);
  assert.equal(empathy.details[1].delta, -1, 'baja → indicador de bajada');
  assert.equal(empathy.details[0].delta, 0, 'sin cambio → sin indicador');
  // El global mostrado es el que guarda el servidor (derivado); si falta, el del informe.
  assert.equal(view.global, 74);
  assert.equal(view.globalDelta, 0);
});

test('el global guardado se respeta si existe (valor ya derivado por el servidor)', () => {
  const view = buildReviewView({ report, review: { global: 77 } });
  assert.equal(view.global, 77);
  assert.equal(view.globalDelta, 1, 'sube → indicador de subida');
});

test('los subcriterios solo se puntúan: no tienen retroalimentación propia', () => {
  const view = buildReviewView({
    report,
    // Aunque un borrador antiguo tuviera texto por subcriterio, NO se muestra.
    review: { details: { 'empathy.warmth': { score: 80, feedback: 'Texto antiguo' } } },
  });
  const detail = view.areas[3].details.find((item) => item.key === 'warmth');
  assert.equal(detail.score, 80);
  assert.equal(detail.feedback, undefined, 'sin retroalimentación por subcriterio');
  assert.equal(view.areas[3].feedback, null, 'la retroalimentación vive a nivel de área');
});

test('el comentario adicional solo cuenta si hay texto (sin textos genéricos)', () => {
  assert.deepEqual(buildReviewView({ report }).comment, { text: '', empty: true });
  assert.deepEqual(buildReviewView({ report, review: { comment: null } }).comment, { text: '', empty: true });
  assert.deepEqual(buildReviewView({ report, review: { comment: 'Buen trabajo' } }).comment, {
    text: 'Buen trabajo',
    empty: false,
  });
});

test('el comentario adicional se marca vacío cuando no se dejó ninguno', () => {
  assert.equal(buildReviewView({ report, review: { comment: 'Buen trabajo' } }).comment.text, 'Buen trabajo');
  assert.equal(buildReviewView({ report, review: { comment: 'Buen trabajo' } }).comment.empty, false);
  assert.equal(buildReviewView({ report, review: {} }).comment.empty, true);
});
