// A3: pruebas del diagnostico offline de JSONL (solo lectura, sin red, sin exponer contenido).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPORT = require('../scripts/audit-report');

const SENSITIVE = {
  prompt: 'PROMPT_SECRETO_DEL_SISTEMA',
  answer: 'RESPUESTA_LITERAL_DEL_VOCERO',
  modelOut: 'SALIDA_CRUDA_DEL_MODELO',
  focus: 'FOCO_SENSIBLE',
  reason: 'MOTIVO_SENSIBLE',
  question: 'PREGUNTA_SENSIBLE',
};
const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const provider = (over = {}) => ({
  at: '2026-11-18T06:47:52.000Z',
  type: 'provider-request',
  kind: 'classification',
  sessionId: SESSION,
  turn: 1,
  model: 'm-ok',
  ok: true,
  status: 200,
  ms: 100,
  request: { host: 'proveedor', model: 'm-ok', messages: [{ role: 'user', content: SENSITIVE.prompt }] },
  response: { choices: [{ message: { content: SENSITIVE.modelOut } }] },
  ...over,
});
const fail410 = (over = {}) => provider({ ok: false, status: 410, ms: 350, response: { error: SENSITIVE.modelOut }, ...over });
const timeout = (ms, over = {}) =>
  provider({ ok: false, status: null, ms, error: { name: 'AbortError', message: 'This operation was aborted' }, ...over });

const turn = (over = {}) => ({
  at: '2026-11-18T06:47:55.000Z',
  type: 'turn',
  sessionId: SESSION,
  turn: 1,
  mainsAsked: 1,
  mainsTotal: 5,
  answer: SENSITIVE.answer,
  question: SENSITIVE.question,
  assessment: { status: 'partial', source: 'ai:m-ok', focus: SENSITIVE.focus, reason: SENSITIVE.reason, evidence: ['cita literal'] },
  decision: { action: 'followup', budget: 'clarity', reason: 'x' },
  ...over,
});

const FIXTURE = [
  provider({ ms: 100 }),
  provider({ ms: 200 }),
  provider({ ms: 300 }),
  fail410({ turn: 2 }),
  fail410({ turn: 3 }),
  fail410({ turn: 4 }),
  timeout(15000),
  timeout(15000),
  timeout(15000),
  provider({ kind: 'generation', ms: 700, turn: null }),
  provider({ kind: 'generation', ms: 1400, turn: null }),
  fail410({ kind: 'generation' }),
  fail410({ kind: 'generation' }),
  timeout(20000, { kind: 'generation' }),
  timeout(20000, { kind: 'generation' }),
  turn({ turn: 1 }),
  turn({ turn: 2, assessment: { status: 'sufficient', source: 'ai:m-ok', focus: '', reason: '', evidence: [] }, decision: { action: 'advance', budget: null, reason: 'respuesta_suficiente' }, mainsAsked: 2 }),
  turn({ turn: 3, assessment: { status: 'partial', source: 'rule:empty', focus: '', reason: '', evidence: [] }, decision: { action: 'advance', budget: null, reason: 'presupuesto_agotado:partial' } }),
  turn({ turn: 4, event: 'close', closeReason: 'COMPLETED', assessment: { status: 'partial', source: null, focus: '', reason: '', evidence: [] }, decision: { action: 'advance', budget: null, reason: 'presupuesto_agotado:partial' }, mainsAsked: 5 }),
];
// Cada modelo del fixture: m-ok (valido), m-dead (410), m-slow (timeout).
const withModel = (record, model) => JSON.stringify(model ? { ...record, model } : record);
const FILE_TEXT = [
  ...FIXTURE.slice(0, 3).map((record) => withModel(record, 'm-ok')),
  ...FIXTURE.slice(3, 6).map((record) => withModel(record, 'm-dead')),
  ...FIXTURE.slice(6, 9).map((record) => withModel(record, 'm-slow')),
  withModel(FIXTURE[9], 'm-ok'),
  withModel(FIXTURE[10], 'm-ok'),
  withModel(FIXTURE[11], 'm-dead'),
  withModel(FIXTURE[12], 'm-dead'),
  withModel(FIXTURE[13], 'm-slow'),
  withModel(FIXTURE[14], 'm-slow'),
  ...FIXTURE.slice(15).map((record) => withModel(record, null)),
  '{"type":"turn",',
  '',
  '[]',
].join('\n');

test('el parser tolera lineas malformadas y las informa', () => {
  const parsed = REPORT.parseAuditLines(FILE_TEXT);
  assert.equal(parsed.records.length, 19, 'registros utiles');
  assert.equal(parsed.discarded.length, 2);
  assert.equal(parsed.discarded.filter((item) => item.reason === 'json_invalido').length, 1);
  assert.equal(parsed.discarded.filter((item) => item.reason === 'no_es_objeto').length, 1);
  assert.equal(parsed.blank, 1);
});

test('calcula solicitudes, errores y latencias por modelo', () => {
  const report = REPORT.computeReport([{ file: 'fixture.jsonl', text: FILE_TEXT }]);
  assert.equal(report.totals.parsed, 19);
  assert.equal(report.totals.discarded, 2);
  assert.equal(report.totals.byType.get('provider-request'), 15);
  assert.equal(report.totals.byType.get('turn'), 4);

  const classification = report.kinds.get('classification');
  assert.equal(classification.total, 9);
  assert.equal(classification.ok, 3);
  assert.equal(classification.failed, 6);
  assert.equal(classification.timeouts, 3);
  assert.deepEqual([...classification.errors.entries()].sort(), [['http_410', 3], ['timeout', 3]]);

  const generation = report.kinds.get('generation');
  assert.equal(generation.total, 6);
  assert.equal(generation.ok, 2);
  assert.equal(generation.timeouts, 2);

  const okModel = classification.perModel.get('m-ok');
  assert.equal(okModel.attempts, 3);
  assert.equal(okModel.ok, 3);
  assert.deepEqual(REPORT.latencyStats(okModel.msAll), { n: 3, min: 100, mean: 200, p50: 200, p95: 300, max: 300 });

  const dead = classification.perModel.get('m-dead');
  assert.equal(dead.ok, 0);
  assert.equal(dead.timeouts, 0);
  assert.deepEqual([...dead.errors.entries()], [['http_410', 3]]);

  const slow = classification.perModel.get('m-slow');
  assert.equal(slow.ok, 0);
  assert.equal(slow.timeouts, 3);
  assert.equal(REPORT.isTimeout(FIXTURE[6]), true);
});

test('identifica modelos sin resultados validos y los ganadores de la clasificacion', () => {
  const report = REPORT.computeReport([{ file: 'fixture.jsonl', text: FILE_TEXT }]);
  const barren = REPORT.modelsWithoutValidResult(report.kinds.get('classification')).map((item) => item.model).sort();
  assert.deepEqual(barren, ['m-dead', 'm-slow'], 'm-ok si aporto resultados validos');

  const winners = REPORT.winnerDistribution(report.turns);
  assert.deepEqual(winners.winners, { 'm-ok': 2 });
  assert.deepEqual(winners.nonAi, { 'rule:empty': 1, sin_fuente: 1 });
});

test('resume los turnos (eventos, estados, decisiones y cierre)', () => {
  const report = REPORT.computeReport([{ file: 'fixture.jsonl', text: FILE_TEXT }]);
  assert.equal(report.turns.records, 4);
  assert.deepEqual(Object.fromEntries([...report.turns.events.entries()].sort()), { close: 1, turn: 3 });
  assert.deepEqual(Object.fromEntries([...report.turns.statuses.entries()].sort()), { partial: 3, sufficient: 1 });
  assert.equal(report.turns.closeReasons.get('COMPLETED'), 1);
  assert.equal(report.turns.mainsTotal, 5);
});

test('el informe impreso no contiene prompts, respuestas, foco ni ids completos', () => {
  const report = REPORT.computeReport([{ file: 'fixture.jsonl', text: FILE_TEXT }]);
  const text = REPORT.formatReport(report);
  for (const value of Object.values(SENSITIVE)) {
    assert.ok(!text.includes(value), `no debe aparecer contenido sensible (${value.slice(0, 12)}...)`);
  }
  assert.ok(!text.includes(SESSION), 'no debe aparecer el identificador completo de la sesion');
  assert.ok(text.includes(SESSION.slice(0, 8)), 'si el prefijo, para poder agrupar');
  assert.ok(text.includes('SOLO LECTURA'), 'el informe declara su modo');
});

test('lee archivos locales sin modificarlos (directorio temporal)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voxready-audit-'));
  const file = path.join(dir, 'interview-audit.test.jsonl');
  try {
    fs.writeFileSync(file, '{"type":"turn"}\nno-json\n', 'utf8');
    const before = fs.readFileSync(file, 'utf8');
    assert.deepEqual(REPORT.listJsonlFiles(dir), [file]);
    const read = REPORT.readAuditFile(file);
    assert.equal(read.records.length, 1);
    assert.equal(read.discarded.length, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'el archivo no se modifica');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('la CLI responde y nunca escribe', () => {
  const logged = console.log;
  const errored = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    assert.equal(REPORT.main(['--help']), 0);
    assert.equal(REPORT.main([path.join(os.tmpdir(), 'no-existe-voxready.jsonl')]), 1);
  } finally {
    console.log = logged;
    console.error = errored;
  }
});

const REAL_FILE = path.join(REPORT.UPLOADS_DIR, 'interview-audit-test1.jsonl');

test('el JSONL real de la entrevista se analiza sin descartes', { skip: !fs.existsSync(REAL_FILE) ? 'no hay JSONL real en uploads' : false }, () => {
  const text = fs.readFileSync(REAL_FILE, 'utf8');
  const read = REPORT.readAuditFile(REAL_FILE);
  assert.equal(read.discarded.length, 0, 'el archivo real no deberia tener lineas descartadas');
  assert.ok(read.records.length >= 70, `registros esperados >= 70, obtenidos ${read.records.length}`);
  const report = REPORT.computeReport([{ file: REAL_FILE, text }]);
  const printed = REPORT.formatReport(report);
  const firstAnswer = String(read.records.find((record) => record.type === 'turn' && record.answer)?.answer || '');
  if (firstAnswer.length > 40) {
    assert.ok(!printed.includes(firstAnswer.slice(0, 40)), 'no se imprime la respuesta del vocero');
  }
  const fullSession = String(read.records[0].sessionId || '');
  assert.ok(!fullSession || !printed.includes(fullSession), 'no se imprime el id completo de la sesion');
});


