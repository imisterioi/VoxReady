// Conservación de Unicode en el flujo del informe (determinista, SIN red: proveedor simulado).
// El defecto real fue texto doblemente codificado en un archivo fuente; esta prueba garantiza que el
// CAMINO DE DATOS (respuesta del proveedor -> validación -> objeto para Prisma -> HTTP) no altera ni
// un byte de acentos, eñes, comillas curvas, guiones largos ni símbolos.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || 'clave-de-prueba';

const path = require('node:path');
const express = require('express');
const { judgeContent, evaluateSession } = require('../ai/evaluator');
const { DEFAULT_CONFIG } = require('../ai/patternConfig');

// Referencia con todos los caracteres que aparecieron dañados (y algunos más).
const REF =
  'Según tu área más débil: “eñe” — año, niño, comillas ‘simples’, flecha →, medio ·, grado °, ' +
  'Época, mitad ½, micro µ, euro € y un emoji ✅.';

const hex = (valor) => Buffer.from(String(valor), 'utf8').toString('hex');

function juicioCompleto() {
  return {
    coherencia: Object.fromEntries(Object.keys(DEFAULT_CONFIG.coherence.criteria).map((clave) => [clave, 80])),
    empatia: Object.fromEntries(Object.keys(DEFAULT_CONFIG.empathy.criteria).map((clave) => [clave, 70])),
    resumen: REF,
    cita: REF,
    fortalezas: [REF],
    mejoras: [REF],
    mensajesClave: [{ mensaje: REF, cubierto: true }],
    lineasRojas: [{ linea: REF, cruzada: false, evidencia: REF }],
    porPregunta: [{ pregunta: 1, puntaje: 85, comentario: REF }],
    risa: { consistencia: 50, comentario: REF },
  };
}

const entrada = () => ({
  theme: {
    id: 't1',
    title: 'Tema',
    context: 'Contexto',
    keyMessages: '[]',
    redLines: '[]',
    interviewConfig: { questionCount: 1, followUps: 0 },
  },
  transcript: [{ question: '¿Qué ocurrió?', answer: REF, metrics: {} }],
  voice: {},
  body: {},
  lighting: null,
  cfg: DEFAULT_CONFIG,
});

test('la respuesta del proveedor se decodifica como UTF-8 sin alterar los caracteres', async () => {
  const cuerpo = Buffer.from(
    JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(juicioCompleto()) } }] }),
    'utf8',
  );
  // Los bytes del cuerpo llevan la referencia tal cual.
  assert.ok(cuerpo.indexOf(Buffer.from(REF, 'utf8')) >= 0, 'el cuerpo del proveedor debe llevar los bytes UTF-8 exactos');

  const respuesta = new Response(cuerpo, { status: 200, headers: { 'content-type': 'application/json' } });
  const datos = await respuesta.json();
  const contenido = datos.choices[0].message.content;
  assert.ok(contenido.includes(REF), 'el texto del modelo debe conservarse tras response.json()');
  assert.equal(hex(JSON.parse(contenido).resumen), hex(REF), 'el hexadecimal debe coincidir exactamente');
});

test('la validación del informe conserva el texto carácter a carácter', async () => {
  const parseado = juicioCompleto();
  const ganador = await judgeContent(entrada(), { models: ['modelo-simulado'], call: async () => parseado });
  assert.equal(ganador.validated, true, 'el ganador sale validado de la carrera');
  assert.equal(ganador.judgement.resumen, REF);
  assert.equal(ganador.judgement.cita, REF);
  assert.equal(ganador.judgement.mensajesClave[0].mensaje, REF);
  assert.equal(ganador.judgement.porPregunta[0].comentario, REF);
});

test('el objeto que se envía a Prisma conserva el texto (y así lo guarda jsonb)', async () => {
  const ganador = await judgeContent(entrada(), { models: ['modelo-simulado'], call: async () => juicioCompleto() });
  const informe = await evaluateSession({
    theme: entrada().theme,
    transcript: entrada().transcript,
    metrics: { voice: {}, body: {}, lighting: null },
    pattern: null,
    judge: async () => ganador,
  });

  assert.equal(informe.resumen, REF);
  assert.equal(informe.cita, REF);
  assert.equal(informe.porPregunta[0].comentario, REF);

  // Lo mismo que se serializa hacia la base de datos.
  const serializado = JSON.stringify({ report: informe });
  assert.ok(serializado.includes(REF), 'la serialización para Prisma debe llevar el texto intacto');
  assert.ok(!serializado.includes('\uFFFD'), 'no puede haber caracteres de reemplazo');
});

test('la respuesta HTTP del informe declara UTF-8 y conserva los bytes', async () => {
  const ganador = await judgeContent(entrada(), { models: ['modelo-simulado'], call: async () => juicioCompleto() });
  const informe = await evaluateSession({
    theme: entrada().theme,
    transcript: entrada().transcript,
    metrics: { voice: {}, body: {}, lighting: null },
    pattern: null,
    judge: async () => ganador,
  });

  const app = express();
  app.get('/informe', (_req, res) => res.json({ status: 'ok', session: { report: informe } }));
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = servidor.address();
    const respuesta = await fetch(`http://127.0.0.1:${port}/informe`);
    assert.match(respuesta.headers.get('content-type') || '', /charset=utf-8/i, 'la cabecera debe declarar charset=utf-8');

    const bytes = Buffer.from(await respuesta.arrayBuffer());
    assert.ok(bytes.indexOf(Buffer.from(REF, 'utf8')) >= 0, 'los bytes UTF-8 de la referencia deben viajar intactos');

    const json = JSON.parse(bytes.toString('utf8'));
    assert.equal(json.session.report.resumen, REF);
    assert.equal(json.session.report.cita, REF);
  } finally {
    servidor.closeAllConnections?.();
    await new Promise((resolve) => servidor.close(resolve));
  }
});
