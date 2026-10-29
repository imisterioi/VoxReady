// E2: progreso de la entrevista y límites de configuración (logica pura, sin navegador).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { emptyProgress, applyServerProgress, isInterviewDone, progressLabel, progressPercent } from './interviewProgress.js';
import { autoMinutes, DEFAULT_MINUTES, maxTurnsPotential, interviewConfigIssues, followUpBudget } from './interviewLimits.js';

const interview = { questionCount: 3, followUps: 1, totalTurns: 6 };

test('1) una pregunta principal incrementa el contador que informa el backend', () => {
  const { progress, changed } = applyServerProgress(emptyProgress(interview), { mainsAsked: 1, mainsTotal: 3, total: 6 });
  assert.equal(changed, true);
  assert.equal(progress.mainsAsked, 1);
  assert.equal(progress.mainsTotal, 3);
});

test('2) una repregunta NO incrementa el contador de principales', () => {
  const before = applyServerProgress(emptyProgress(interview), { mainsAsked: 1, mainsTotal: 3 }).progress;
  const after = applyServerProgress(before, { mainsAsked: 1, mainsTotal: 3, kind: 'followup' });
  assert.equal(after.progress.mainsAsked, 1);
  assert.equal(after.changed, false);
});

test('3) la interfaz respeta el done del backend', () => {
  const done = applyServerProgress(emptyProgress(interview), { mainsAsked: 3, mainsTotal: 3, done: true });
  assert.equal(done.done, true);
  assert.equal(done.progress.done, true);
});

test('4) y 5) el cierre se detecta por done o por INTERVIEW_DONE, sin ciclo', () => {
  assert.equal(isInterviewDone({ done: true }), true);
  assert.equal(isInterviewDone({ code: 'INTERVIEW_DONE' }), true);
  assert.equal(isInterviewDone({ question: 'x', done: false }), false);
  const twice = applyServerProgress(applyServerProgress(emptyProgress(interview), { done: true }).progress, { done: true });
  assert.equal(twice.changed, false, 'aplicar dos veces el mismo cierre no cambia nada');
});

test('8) sin dato del backend no se inventa un total de cinco', () => {
  const progress = emptyProgress(null);
  assert.equal(progress.mainsTotal, null);
  assert.equal(progress.total, null);
  assert.equal(progressPercent(progress), 0);
  assert.equal(progressLabel({ mainsAsked: 1, mainsTotal: null }), 'Pregunta');
});

test('9) errores de red o respuestas repetidas no duplican progreso', () => {
  const first = applyServerProgress(emptyProgress(interview), { mainsAsked: 2, mainsTotal: 3 });
  const again = applyServerProgress(first.progress, { mainsAsked: 2, mainsTotal: 3 });
  assert.equal(again.changed, false);
  assert.equal(again.progress.mainsAsked, 2);
});

test('etiquetas: pregunta principal vs repregunta', () => {
  assert.equal(progressLabel({ isFollowUp: true, mainsAsked: 2, mainsTotal: 3 }), 'Repregunta');
  assert.equal(progressLabel({ isFollowUp: false, mainsAsked: 2, mainsTotal: 3 }), 'Pregunta 2 de 3');
  assert.equal(progressPercent({ mainsAsked: 1, mainsTotal: 4 }), 25);
});

test('6) la duracion maxima es obligatoria: el formulario muestra 5 minutos', () => {
  const source = readFileSync(new URL('../../components/InterviewConfig.jsx', import.meta.url), 'utf8');
  // La duracion MAXIMA de la entrevista la define el usuario y es obligatoria (nunca queda vacia).
  assert.equal(source.includes("onChange={set('estimatedMinutes')}"), true, 'debe existir un input editable de duracion');
  assert.equal(source.includes('Duración máxima de la entrevista'), true);
  assert.equal(DEFAULT_MINUTES, 5, 'el valor inicial/predeterminado es 5 minutos');
  assert.match(source, /estimatedMinutes: DEFAULT_MINUTES/, 'el formulario parte de 5 minutos');
  assert.match(source, /estimatedMinutes: Number\(form\.estimatedMinutes\)/, 'el payload envia siempre un numero (nunca null)');
  assert.match(source, /estimatedMinutes: interview\.estimatedMinutes \?\? DEFAULT_MINUTES/, 'un escenario antiguo muestra el valor efectivo');
  assert.equal(autoMinutes({ questionCount: 4, followUps: 1 }), 10, 'la estimacion de referencia sigue disponible');
});

test('6b) una duracion vacia, nula o fuera de rango bloquea el guardado', () => {
  const base = { questionCount: 3, followUps: 1, aggressiveness: 'MEDIA' };
  assert.deepEqual(interviewConfigIssues({ ...base, estimatedMinutes: 5 }), [], 'una duracion valida no tiene problemas');
  const cases = [['', 'REQUIRED'], [null, 'REQUIRED'], [undefined, 'REQUIRED'], [0, 'BELOW_MIN'], [121, 'ABOVE_MAX'], ['mucho', 'INVALID']];
  for (const [value, code] of cases) {
    const issues = interviewConfigIssues({ ...base, estimatedMinutes: value });
    assert.ok(
      issues.some((issue) => issue.field === 'estimatedMinutes' && issue.code === code),
      `"${String(value)}" debe dar ${code}`,
    );
  }
});

test('7) una configuracion que supera 30 turnos se bloquea con explicacion', () => {
  const issues = interviewConfigIssues({ questionCount: 12, followUps: 3, aggressiveness: 'EXTREMA', estimatedMinutes: 5 });
  const limit = issues.find((issue) => issue.code === 'TURN_LIMIT');
  assert.ok(limit, 'debe haber un error de limite de turnos');
  assert.equal(limit.potential, 84);
  assert.match(limit.mensaje, /84 turnos y el m[aá]ximo es 30/);
  assert.deepEqual(interviewConfigIssues({ questionCount: 3, followUps: 1, aggressiveness: 'MEDIA', estimatedMinutes: 5 }), []);
});

test('11) el cierre por tiempo del backend se reconoce y no se pierde el progreso', () => {
  // Payload real de la ruta cuando cierra por tiempo (done + closeReason + pendingMains).
  const close = { done: true, closeReason: 'TIME_LIMIT', question: null, mainsAsked: 1, mainsTotal: 3, pendingMains: 2 };
  assert.equal(isInterviewDone(close), true, 'el cierre por tiempo termina la entrevista');

  const applied = applyServerProgress(emptyProgress(interview), close);
  assert.equal(applied.done, true);
  assert.equal(applied.progress.mainsAsked, 1, 'se conservan las principales realizadas');
  assert.equal(applied.progress.mainsTotal, 3, 'y el total, para poder informar las pendientes');
  assert.equal(progressPercent(applied.progress), 33, 'el progreso refleja lo respondido');

  // Repetir el mismo cierre (reintento) no cambia nada.
  const again = applyServerProgress(applied.progress, close);
  assert.equal(again.changed, false);
});

test('12) un error 409 con done=true se trata como cierre, no como fallo', () => {
  // Así responde el backend cuando la sesión ya estaba cerrada (INTERVIEW_DONE + done).
  assert.equal(isInterviewDone({ status: 'error', code: 'INTERVIEW_DONE', done: true, closeReason: 'TIME_LIMIT' }), true);
  assert.equal(isInterviewDone({ status: 'error', mensaje: 'Demasiadas preguntas en poco tiempo.' }), false);
});

test('7b) presupuestos y estimacion coherentes con el backend', () => {
  assert.deepEqual(followUpBudget({ followUps: 0, aggressiveness: 'EXTREMA' }), { habitual: 0, clarity: 1, extraordinary: 2, contingency: 1, perMain: 4 });
  assert.equal(maxTurnsPotential({ questionCount: 5, followUps: 3, aggressiveness: 'EXTREMA' }), 35);
  assert.equal(autoMinutes({ questionCount: 4, followUps: 1 }), 10);
});

test('13) la etiqueta de pregunta del componente usa el progreso del backend', () => {
  // El progreso es autoritativo del backend: el componente no debe referenciar el contador local
  // (`currentNumber` / `total`), que rompería el render con ReferenceError.
  // Se comprueba sobre el fuente porque el repositorio no tiene entorno de DOM para renderizar.
  const source = readFileSync(new URL('../../pages/SesionPractica.jsx', import.meta.url), 'utf8');
  assert.equal(source.includes('currentNumber'), false, 'no debe quedar ninguna referencia al contador local eliminado');

  const labelLine = source.split('\n').find((line) => line.includes("'Preparando'"));
  assert.ok(labelLine, 'debe existir la etiqueta de estado de la pregunta');
  assert.ok(labelLine.includes('mainLabel'), 'la etiqueta debe salir de progressLabel (mainsAsked/mainsTotal)');
  assert.equal(labelLine.includes('turnCount'), false, 'la etiqueta no se recalcula con un contador local');
  assert.ok((source.match(/mainLabel/g) ?? []).length >= 2, 'mainLabel debe declararse y usarse');
});
