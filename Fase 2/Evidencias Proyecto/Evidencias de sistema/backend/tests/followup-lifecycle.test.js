// A1/A3: ciclo de vida de los candidatos de repregunta. Pruebas LOCALES con dobles y reloj falso:
// sin red, sin proveedores y deterministas.
//
// Regla bajo prueba: una candidata solo puede entregarse si pertenece al turno LOGICO que sigue
// activo (`dispatchTurn === state.turn`); los resultados de un turno ya resuelto se descartan y no
// se acumulan; una candidata tardia del MISMO turno (aunque venga de una solicitud anterior) sigue
// siendo valida; y una candidata ya disponible al vencer el plazo no se pierde.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInterviewSession } = require('../lib/interviewSession');

const ok = (question) => ({ question });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Reloj falso: `sleep` avanza el reloj, ejecuta el hook opcional (llegadas en un instante exacto) y
// drena microtareas para que la cadena askModel -> handleResult sea visible antes del `pick()`.
function fakeClock({ onSleep } = {}) {
  let t = 1000;
  return {
    now: () => t,
    set: (value) => {
      t = value;
    },
    sleep: async (ms) => {
      t += ms;
      if (onSleep) await onSleep(t);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    },
  };
}

const drain = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

// Doble de modelos: para turnos normales devuelve una pregunta; para repreguntas devuelve una
// promesa controlada por el test (una por cada llamada, en orden de despacho).
function modelDouble() {
  const gates = [];
  const calls = [];
  const askModel = async (model, context) => {
    calls.push({ model, kind: context?.kind ?? null, turn: context?.turn ?? null });
    if (context?.kind === 'followup') {
      const gate = deferred();
      gates.push({ model, turn: context.turn, ...gate });
      return gate.promise;
    }
    return ok(`¿Principal de ${model}?`);
  };
  return { askModel, gates, calls };
}

function build({ models = ['m1', 'm2'], clock = fakeClock(), double = modelDouble() } = {}) {
  const events = [];
  const session = createInterviewSession({
    sessionId: 's1',
    models,
    askModel: double.askModel,
    now: clock.now,
    sleep: clock.sleep,
    logger: (event) => events.push(event),
  });
  return { session, events, double, clock };
}

const followUp = (session, timeoutMs) => session.next({ needsFollowUp: true, focus: 'el dato pendiente', context: {}, timeoutMs });

test('1) dos modelos generan candidatas del mismo turno y se entrega la primera valida', async () => {
  const { session, events, double } = build();
  const pending = followUp(session, 500);
  await drain(); // el despacho invoca askModel en el siguiente microtask

  double.gates[0].resolve(ok('¿Repregunta del primer modelo?'));
  const item = await pending;
  assert.equal(item.ok, true);
  assert.equal(item.kind, 'followup');
  assert.equal(item.origin, 'repregunta');
  assert.equal(item.question, '¿Repregunta del primer modelo?');
  assert.equal(item.model, 'm1');

  // La segunda candidata del mismo despacho llega DESPUES de resolver el turno: no se acumula.
  double.gates[1].resolve(ok('¿Repregunta del segundo modelo?'));
  await drain();
  assert.equal(session.snapshot().followups.length, 0);
  assert.ok(events.some((event) => event.event === 'followup-dropped' && event.model === 'm2'));
});

test('2) una candidata de un turno anterior no se entrega en el turno actual', async () => {
  const { session, double } = build();
  const primera = followUp(session, 500);
  await drain();
  double.gates[0].resolve(ok('¿Repregunta del turno 0?'));
  const uno = await primera;
  assert.equal(uno.question, '¿Repregunta del turno 0?');

  // Tardia del turno 0, que ya quedo resuelto.
  double.gates[1].resolve(ok('¿Tardia del turno 0?'));
  await drain();
  assert.equal(session.snapshot().followups.length, 0, 'la tardia no espera en la cola');

  // Turno 1: solo puede entregarse una candidata del turno 1.
  const segunda = followUp(session, 500);
  await drain();
  assert.equal(double.calls[2].turn, 1, 'el nuevo despacho pertenece al turno 1');
  double.gates[2].resolve(ok('¿Repregunta del turno 1?'));
  const dos = await segunda;
  assert.equal(dos.question, '¿Repregunta del turno 1?');
  assert.notEqual(dos.question, '¿Tardia del turno 0?');
  assert.equal(session.snapshot().followups.length, 0);
});

test('3) una candidata que llega despues de resolver su turno se descarta con su trazabilidad', async () => {
  const { session, events, double } = build();
  const pending = followUp(session, 500);
  await drain();
  double.gates[0].resolve(ok('¿Repregunta entregada?'));
  await pending; // turno 0 resuelto -> state.turn = 1
  await drain();
  assert.equal(events.filter((event) => event.event === 'followup-dropped').length, 0, 'la entregada no se descarta');

  double.gates[1].resolve(ok('¿Tardia del turno 0?'));
  await drain();
  const dropped = events.filter((event) => event.event === 'followup-dropped');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].dispatchTurn, 0, 'turno logico de origen');
  assert.equal(dropped[0].turn, 1, 'turno activo al llegar');
  assert.equal(session.snapshot().followups.length, 0);
});


test('4) una tardia de una solicitud anterior se acepta si es del mismo turno y sigue activo', async () => {
  const { session, events, double } = build({ models: ['m1'] });
  const primero = await followUp(session, 100);
  assert.equal(primero.ok, false);
  assert.equal(primero.code, 'NO_FOLLOWUP_IN_TIME', 'sin candidatas vence el plazo');
  assert.equal(session.snapshot().turn, 0, 'el turno no avanza');

  // Reintento del MISMO turno: la candidata de la solicitud ANTERIOR sigue siendo valida.
  const segundo = followUp(session, 500);
  await drain();
  double.gates[0].resolve(ok('¿Candidata del primer intento?'));
  const item = await segundo;
  assert.equal(item.ok, true);
  assert.equal(item.question, '¿Candidata del primer intento?');

  const listas = events.filter((event) => event.event === 'followup-ready');
  assert.equal(listas.length, 1);
  assert.equal(listas[0].requestId, 's1:1', 'la candidata aceptada proviene de la solicitud anterior');
  assert.equal(events.filter((event) => event.event === 'followup-dropped').length, 0, 'no se descarta: el turno seguia activo');
  assert.equal(session.snapshot().followups.length, 0);
});

test('5) si no hay candidata valida para el turno actual se conserva NO_FOLLOWUP_IN_TIME', async () => {
  const { session, events, double } = build();
  const result = await followUp(session, 100);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_FOLLOWUP_IN_TIME');
  assert.equal(session.snapshot().turn, 0, 'el turno no avanza sin repregunta');
  assert.equal(session.snapshot().followups.length, 0);
  assert.ok(events.every((event) => event.event !== 'followup-ready'));
  assert.equal(double.calls.filter((call) => call.kind === 'followup').length, 2, 'se consultaron ambos modelos del despacho');
  assert.equal(result.pending, 2, 'el error informa las solicitudes en curso');

  // Las solicitudes terminan y se limpian: nada queda colgado.
  double.gates[0].resolve(ok('¿Candidata que llega justo despues del plazo?'));
  double.gates[1].resolve(ok('¿Candidata que llega tarde del segundo modelo?'));
  await drain();
  assert.equal(session.pendingCount(), 0);
  assert.equal(session.snapshot().followups.length, 2, 'se conservan: siguen siendo del turno activo');
});

test('6) una candidata antigua no evita un timeout legitimo del turno actual', async () => {
  const { session, double } = build();
  const primera = followUp(session, 500);
  await drain();
  double.gates[0].resolve(ok('¿Repregunta del turno 0?'));
  await primera;
  double.gates[1].resolve(ok('¿Tardia del turno 0?'));
  await drain();

  // Turno 1: ninguna candidata del turno 1 llega -> debe vencer, nunca servir la vieja.
  const segunda = await followUp(session, 100);
  assert.equal(segunda.ok, false);
  assert.equal(segunda.code, 'NO_FOLLOWUP_IN_TIME');
  assert.equal(session.snapshot().turn, 1, 'el turno no avanza');
  assert.equal(session.snapshot().followups.length, 0);
});

test('7) la llegada de una candidata en el limite del plazo se resuelve de forma determinista', async () => {
  // (a) La candidata llega durante el ultimo sondeo, exactamente al vencer el plazo.
  let resuelto = false;
  const doubleA = modelDouble();
  const clock = fakeClock({
    onSleep: (t) => {
      if (t >= 1100 && !resuelto) {
        resuelto = true;
        doubleA.gates[0].resolve(ok('¿Justo en el limite?'));
      }
    },
  });
  const { session } = build({ clock, double: doubleA });
  const item = await followUp(session, 100); // plazo = 1100
  assert.equal(item.ok, true, 'no se pierde por la carrera con el temporizador');
  assert.equal(item.question, '¿Justo en el limite?');
  assert.equal(clock.now(), 1100, 'llego exactamente al vencer el plazo');

  // (b) Plazo 0 con una candidata ya disponible del turno activo: se consume igualmente.
  const { session: segunda, double } = build({ models: ['m1'] });
  const vencida = await followUp(segunda, 100);
  assert.equal(vencida.ok, false, 'sin candidatas disponibles vence');
  double.gates[0].resolve(ok('¿Ya disponible antes del plazo cero?'));
  await drain();
  assert.equal(segunda.snapshot().followups.length, 1, 'el turno sigue activo: la candidata espera');

  const inmediata = await followUp(segunda, 0);
  assert.equal(inmediata.ok, true, 'una candidata ya disponible no provoca un falso timeout');
  assert.equal(inmediata.question, '¿Ya disponible antes del plazo cero?');
  assert.equal(segunda.snapshot().followups.length, 0);
});

test('8) la cola no acumula candidatas de turnos ya terminados', async () => {
  const { session, double } = build();
  const entregadas = [];
  for (let turno = 0; turno < 3; turno += 1) {
    const pending = followUp(session, 500);
    await drain();
    double.gates[turno * 2].resolve(ok(`¿Repregunta del turno ${turno}?`));
    const item = await pending;
    assert.equal(item.ok, true);
    entregadas.push(item.question);
    // La candidata restante del mismo despacho llega tarde (turno ya resuelto).
    double.gates[turno * 2 + 1].resolve(ok(`¿Tardia del turno ${turno}?`));
    await drain();
    assert.equal(session.snapshot().followups.length, 0, `cola limpia tras el turno ${turno}`);
  }
  assert.equal(session.snapshot().turn, 3);
  assert.equal(session.pendingCount(), 0);
  assert.equal(new Set(entregadas).size, 3, 'tres repreguntas distintas, ninguna reutilizada');
});

test('9) no se entregan dos candidatas para un mismo turno', async () => {
  const { session, double } = build();
  const entregadas = [];
  const primero = followUp(session, 500);
  await drain();
  double.gates[0].resolve(ok('¿Repregunta unica del turno 0?'));
  entregadas.push((await primero).question);
  double.gates[1].resolve(ok('¿Repregunta unica del turno 0?'));
  await drain();

  const segundo = followUp(session, 500);
  await drain();
  double.gates[2].resolve(ok('¿Repregunta unica del turno 1?'));
  entregadas.push((await segundo).question);
  double.gates[3].resolve(ok('¿Repregunta unica del turno 1?'));
  await drain();

  assert.notEqual(entregadas[0], entregadas[1]);
  assert.equal(new Set(entregadas).size, 2, 'cada turno entrega una sola candidata');
  assert.equal(session.snapshot().followups.length, 0);
});

test('10) la limpieza de solicitudes pendientes y dispose siguen funcionando', async () => {
  const { session, double } = build();
  const vencida = await followUp(session, 100);
  assert.equal(vencida.ok, false);
  assert.equal(vencida.pending, 2, 'las solicitudes del despacho siguen en curso');

  // Ambas candidatas llegan despues del plazo, pero siguen siendo del turno activo.
  double.gates[0].resolve(ok('¿Candidata valida del turno activo?'));
  double.gates[1].resolve(ok('¿Candidata valida del segundo modelo?'));
  await drain();
  assert.equal(session.pendingCount(), 0, 'las solicitudes se limpian al asentarse');
  assert.equal(session.snapshot().followups.length, 2, 'siguen siendo validas mientras el turno este activo');

  session.dispose();
  assert.equal(session.isDisposed(), true);
  assert.equal(session.pendingCount(), 0);
  assert.equal(session.snapshot().followups.length, 0, 'dispose limpia las candidatas de repregunta');
});

test('11) una candidata que llega despues del cierre no se encola', async () => {
  const { session, double } = build({ models: ['m1'] });
  const vencida = await followUp(session, 100);
  assert.equal(vencida.ok, false);
  session.dispose();

  double.gates[0].resolve(ok('¿Resultado posterior al cierre?'));
  await drain();
  assert.equal(session.snapshot().followups.length, 0, 'nada se encola despues del cierre');
  assert.equal(session.pendingCount(), 0);
});

