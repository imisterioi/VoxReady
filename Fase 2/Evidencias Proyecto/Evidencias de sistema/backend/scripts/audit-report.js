// Diagnostico OFFLINE de los archivos de auditoria JSONL de la entrevista (A3).
//
// QUE HACE
//  - Lee archivos .jsonl locales ya existentes y calcula estadisticas agrupadas: solicitudes por
//    modelo, exitosas y fallidas, errores por tipo y codigo HTTP, timeouts, latencias por modelo,
//    resultados de generacion y clasificacion, modelos que no aportaron resultados validos y
//    distribucion de los modelos ganadores de la clasificacion.
//  - Tolera registros incompletos o malformados: informa cuantos proceso y cuantos descarto.
//
// QUE NO HACE (limites explicitos)
//  - No hace peticiones HTTP ni contacta con NVIDIA ni con ningun otro proveedor.
//  - No inicia entrevistas, warm-up, precalentamiento ni pruebas de generacion.
//  - No modifica el JSONL ni ningun otro archivo: solo lee.
//  - No toca la base de datos, ni .env, ni la configuracion de modelos.
//  - No deshabilita, excluye, reemplaza ni recomienda modelos: solo informa hechos.
//  - No imprime texto del vocero, prompts, respuestas de los modelos ni otros datos sensibles.
//
// USO
//   node scripts/audit-report.js                 (el .jsonl mas reciente de backend/uploads)
//   node scripts/audit-report.js <archivo.jsonl> [<archivo2.jsonl> ...]
//   node scripts/audit-report.js --all           (todos los .jsonl de backend/uploads)
const fs = require('node:fs');
const path = require('node:path');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const SESSION_LABEL = 8; // solo el prefijo del id: no se imprime el identificador completo

// --- utilidades numericas -------------------------------------------------------------

// Numero util o null. Ojo: Number(null) es 0 y Number('') es 0, asi que un valor ausente o nulo
// debe tratarse como "sin dato" y no como un cero real (no es lo mismo 0 ms que "no informado").
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

function latencyStats(values) {
  const clean = values.map(num).filter((v) => v !== null).sort((a, b) => a - b);
  if (!clean.length) return { n: 0, min: null, mean: null, p50: null, p95: null, max: null };
  const sum = clean.reduce((acc, v) => acc + v, 0);
  return {
    n: clean.length,
    min: clean[0],
    mean: Math.round(sum / clean.length),
    p50: quantile(clean, 0.5),
    p95: quantile(clean, 0.95),
    max: clean[clean.length - 1],
  };
}

// --- lectura tolerante del JSONL ------------------------------------------------------

// Devuelve { records, total, blank, discarded:[{line, reason}] }. Nunca lanza por una linea mala.
function parseAuditLines(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const records = [];
  const discarded = [];
  let blank = 0;
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) {
      blank += 1;
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      discarded.push({ line: index + 1, reason: 'json_invalido' });
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      discarded.push({ line: index + 1, reason: 'no_es_objeto' });
      return;
    }
    records.push(parsed);
  });
  return { records, total: lines.length, blank, discarded };
}

function readAuditFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { file, ...parseAuditLines(text) };
}

// --- clasificacion de errores (sin exponer contenido) ---------------------------------

// Categoria del resultado de una solicitud. Solo usa codigos y nombres de error: nunca mensajes.
function outcomeCategory(record) {
  if (record?.ok === true) return 'ok';
  const status = num(record?.status);
  if (status !== null) return `http_${status}`;
  if (record?.error?.name === 'AbortError') return 'timeout';
  if (record?.error) return 'error_sin_codigo';
  return 'sin_estado';
}

const isTimeout = (record) => outcomeCategory(record) === 'timeout';

// --- agregacion ----------------------------------------------------------------------

function emptyBucket() {
  return { attempts: 0, ok: 0, failed: 0, timeouts: 0, errors: new Map(), msAll: [], msOk: [] };
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

const mapToSortedObject = (map) =>
  Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));

// `files` es [{ file, text }] (se parsea) o [{ file, records }] (ya parseado, para pruebas).
function computeReport(files = []) {
  const report = {
    files: [],
    totals: { records: 0, parsed: 0, discarded: 0, blank: 0, byType: new Map(), discardedReasons: new Map() },
    sessions: new Map(),
    kinds: new Map(), // kind -> { total, ok, failed, timeouts, perModel: Map, errors: Map }
    turns: {
      records: 0,
      events: new Map(),
      statuses: new Map(),
      sources: new Map(),
      decisions: new Map(),
      closeReasons: new Map(),
      evidence: { n: 0, min: null, max: null, sum: 0 },
      mainsAskedMax: 0,
      mainsTotal: null,
    },
  };

  for (const item of files) {
    const parsed = item.records
      ? { records: item.records, total: item.records.length, blank: 0, discarded: [] }
      : parseAuditLines(item.text);
    report.files.push({
      file: item.file,
      parsed: parsed.records.length,
      discarded: parsed.discarded.length,
      blank: parsed.blank,
    });
    report.totals.blank += parsed.blank;
    for (const reason of parsed.discarded) bump(report.totals.discardedReasons, reason.reason);

    for (const record of parsed.records) {
      report.totals.parsed += 1;
      bump(report.totals.byType, String(record.type || 'sin_tipo'));
      if (record.sessionId) bump(report.sessions, String(record.sessionId).slice(0, SESSION_LABEL));

      if (record.type === 'provider-request') {
        const kind = String(record.kind || 'sin_kind');
        if (!report.kinds.has(kind)) {
          report.kinds.set(kind, { total: 0, ok: 0, failed: 0, timeouts: 0, perModel: new Map(), errors: new Map() });
        }
        const bucket = report.kinds.get(kind);
        const category = outcomeCategory(record);
        bucket.total += 1;
        if (category === 'ok') bucket.ok += 1;
        else {
          bucket.failed += 1;
          bump(bucket.errors, category);
        }
        if (category === 'timeout') bucket.timeouts += 1;

        const model = String(record.model || 'sin_modelo');
        if (!bucket.perModel.has(model)) bucket.perModel.set(model, emptyBucket());
        const per = bucket.perModel.get(model);
        per.attempts += 1;
        const ms = num(record.ms);
        if (ms !== null) per.msAll.push(ms);
        if (category === 'ok') {
          per.ok += 1;
          if (ms !== null) per.msOk.push(ms);
        } else {
          per.failed += 1;
          if (category === 'timeout') per.timeouts += 1;
          bump(per.errors, category);
        }
        continue;
      }

      if (record.type === 'turn') {
        const turns = report.turns;
        turns.records += 1;
        bump(turns.events, String(record.event || 'turn'));
        bump(turns.statuses, record.assessment?.status ? String(record.assessment.status) : 'sin_clasificacion');
        bump(turns.sources, record.assessment?.source ? String(record.assessment.source) : 'sin_fuente');
        const action = record.decision?.action ? String(record.decision.action) : 'sin_decision';
        const budget = record.decision?.budget ? String(record.decision.budget) : '-';
        bump(turns.decisions, `${action}/${budget}`);
        if (record.closeReason) bump(turns.closeReasons, String(record.closeReason));
        const evidence = Array.isArray(record.assessment?.evidence) ? record.assessment.evidence.length : 0;
        turns.evidence.n += 1;
        turns.evidence.sum += evidence;
        turns.evidence.min = turns.evidence.min === null ? evidence : Math.min(turns.evidence.min, evidence);
        turns.evidence.max = turns.evidence.max === null ? evidence : Math.max(turns.evidence.max, evidence);
        const mainsAsked = num(record.mainsAsked);
        if (mainsAsked !== null) turns.mainsAskedMax = Math.max(turns.mainsAskedMax, mainsAsked);
        const mainsTotal = num(record.mainsTotal);
        if (mainsTotal !== null) turns.mainsTotal = mainsTotal;
      }
    }

    report.totals.records += parsed.records.length + parsed.discarded.length + parsed.blank;
  }

  report.totals.discarded = report.files.reduce((acc, file) => acc + file.discarded, 0);
  return report;
}

// Modelos con intentos y CERO resultados validos en ese tipo. Dato informativo: no se recomienda
// nada (la administracion de modelos es del operador).
function modelsWithoutValidResult(kindBucket) {
  return [...kindBucket.perModel.entries()]
    .filter(([, bucket]) => bucket.attempts > 0 && bucket.ok === 0)
    .map(([model, bucket]) => ({ model, attempts: bucket.attempts }))
    .sort((a, b) => b.attempts - a.attempts);
}

// Distribucion de modelos ganadores de la clasificacion: solo cuentan las clasificaciones hechas
// por IA (`ai:<modelo>`); las decisiones por regla o sin clasificacion se agrupan aparte.
// `turnStats.sources` ya viene agregado (fuente -> numero de turnos), asi que se suma su cuenta.
function winnerDistribution(turnStats) {
  const winners = new Map();
  const rules = new Map();
  for (const [source, count] of turnStats.sources.entries()) {
    const total = Number(count) || 0;
    if (String(source).startsWith('ai:')) {
      const model = String(source).slice(3);
      winners.set(model, (winners.get(model) || 0) + total);
    } else {
      rules.set(source, (rules.get(source) || 0) + total);
    }
  }
  return { winners: mapToSortedObject(winners), nonAi: mapToSortedObject(rules) };
}

// --- informe legible ------------------------------------------------------------------

const pad = (value, width, align = 'left') => {
  const text = String(value ?? '');
  if (text.length >= width) return text;
  return align === 'right' ? text.padStart(width) : text.padEnd(width);
};

const round1 = (value) => (value === null || value === undefined ? null : Math.round(value * 10) / 10);

function formatReport(report, { title = 'Diagnostico de auditoria de entrevistas' } = {}) {
  const out = [];
  const line = (text = '') => out.push(text);
  const rule = () => line('-'.repeat(78));

  line(`== ${title} ==`);
  line('Modo: SOLO LECTURA / OFFLINE. No se ha contactado con ningun proveedor.');
  line('No se imprime texto del vocero, prompts ni respuestas de los modelos.');
  line();

  line('ARCHIVOS PROCESADOS');
  rule();
  for (const file of report.files) {
    line(`  ${pad(file.file, 52)} registros=${pad(file.parsed, 5, 'right')}  descartados=${pad(file.discarded, 3, 'right')}`);
  }
  line(`  ${pad('TOTAL', 52)} registros=${pad(report.totals.parsed, 5, 'right')}  descartados=${pad(report.totals.discarded, 3, 'right')}  lineas vacias=${report.totals.blank}`);
  if (report.totals.discarded > 0) {
    line(`  Motivos de descarte: ${JSON.stringify(mapToSortedObject(report.totals.discardedReasons))}`);
  }
  line();

  line('REGISTROS POR TIPO');
  rule();
  for (const [type, count] of [...report.totals.byType.entries()].sort((a, b) => b[1] - a[1])) {
    line(`  ${pad(type, 20)} ${pad(count, 6, 'right')}`);
  }
  line();

  line('SESIONES (prefijo del id)');
  rule();
  for (const [session, count] of [...report.sessions.entries()].sort((a, b) => b[1] - a[1])) {
    line(`  ${pad(session, 12)} ${pad(count, 6, 'right')} registros`);
  }
  line();

  for (const [kind, bucket] of report.kinds.entries()) {
    // Ancho de la columna de modelos: se adapta al nombre mas largo para no desalinear las cifras.
    const modelWidth = Math.max(12, ...[...bucket.perModel.keys()].map((name) => String(name).length)) + 2;
    line(`SOLICITUDES (${kind})`);
    rule();
    line(`  total=${bucket.total}  exitosas=${bucket.ok}  fallidas=${bucket.failed}  timeouts=${bucket.timeouts}`);
    if (bucket.errors.size) line(`  Errores por tipo/codigo: ${JSON.stringify(mapToSortedObject(bucket.errors))}`);
    line();
    line(`  ${pad('modelo', modelWidth)}${pad('int', 5, 'right')}${pad('ok', 5, 'right')}${pad('fall', 5, 'right')}${pad('t.o.', 5, 'right')}  ${pad('min', 9, 'right')}${pad('media', 9, 'right')}${pad('p50', 9, 'right')}${pad('p95', 9, 'right')}${pad('max', 9, 'right')}`);
    for (const [model, per] of [...bucket.perModel.entries()].sort((a, b) => b[1].attempts - a[1].attempts)) {
      const stats = latencyStats(per.msAll);
      line(
        `  ${pad(model, modelWidth)}${pad(per.attempts, 5, 'right')}${pad(per.ok, 5, 'right')}${pad(per.failed, 5, 'right')}${pad(per.timeouts, 5, 'right')}  ` +
          `${pad(stats.min, 9, 'right')}${pad(stats.mean, 9, 'right')}${pad(stats.p50, 9, 'right')}${pad(stats.p95, 9, 'right')}${pad(stats.max, 9, 'right')}`,
      );
      if (per.errors.size) line(`      errores: ${JSON.stringify(mapToSortedObject(per.errors))}`);
    }
    const barren = modelsWithoutValidResult(bucket);
    if (barren.length) {
      line(`  Sin ningun resultado valido (informativo, sin recomendaciones): ${barren.map((item) => `${item.model} (${item.attempts} intentos)`).join(', ')}`);
    }
    line();
  }

  const winners = winnerDistribution(report.turns);
  const winnerWidth = Math.max(12, ...[...Object.keys(winners.winners), ...Object.keys(winners.nonAi)].map((name) => String(name).length)) + 2;
  line('GANADORES DE LA CLASIFICACION (fuente del veredicto)');
  rule();
  for (const [model, count] of Object.entries(winners.winners)) line(`  ${pad(model, winnerWidth)}${pad(count, 5, 'right')}`);
  for (const [other, count] of Object.entries(winners.nonAi)) line(`  ${pad(other, winnerWidth)}${pad(count, 5, 'right')}`);
  line();

  line('TURNOS');
  rule();
  line(`  registros de turno: ${report.turns.records}`);
  line(`  eventos: ${JSON.stringify(mapToSortedObject(report.turns.events))}`);
  line(`  estados del clasificador: ${JSON.stringify(mapToSortedObject(report.turns.statuses))}`);
  line(`  decisiones: ${JSON.stringify(mapToSortedObject(report.turns.decisions))}`);
  if (report.turns.closeReasons.size) line(`  motivos de cierre: ${JSON.stringify(mapToSortedObject(report.turns.closeReasons))}`);
  const evidenceMean = report.turns.evidence.n ? round1(report.turns.evidence.sum / report.turns.evidence.n) : null;
  line(`  evidencias por turno: min=${report.turns.evidence.min ?? '-'} media=${evidenceMean ?? '-'} max=${report.turns.evidence.max ?? '-'}`);
  line(`  principales: mainsAsked maximo=${report.turns.mainsAskedMax}  mainsTotal=${report.turns.mainsTotal ?? '-'}`);
  line();
  line('FIN DEL INFORME (no se ha escrito ni modificado ningun archivo)');
  return out.join('\n');
}

// --- archivos y CLI -------------------------------------------------------------------

function listJsonlFiles(dir = UPLOADS_DIR) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.jsonl'))
      .map((name) => {
        const full = path.join(dir, name);
        return { file: full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map((item) => item.file);
  } catch {
    return [];
  }
}

const USAGE = [
  'Uso:',
  '  node scripts/audit-report.js                 (el .jsonl mas reciente de backend/uploads)',
  '  node scripts/audit-report.js <archivo.jsonl> [<archivo2.jsonl> ...]',
  '  node scripts/audit-report.js --all           (todos los .jsonl de backend/uploads)',
  '',
  'Solo lectura: no contacta con ningun proveedor, no toca la base de datos y no modifica archivos.',
].join('\n');

// Devuelve el codigo de salida (0 = ok). Nunca escribe ni modifica nada.
function main(argv = []) {
  const args = argv.filter(Boolean);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  let files;
  if (args.includes('--all')) {
    files = listJsonlFiles();
  } else if (args.length) {
    files = args;
  } else {
    files = listJsonlFiles().slice(0, 1);
    if (!files.length) {
      console.error(`No hay archivos .jsonl en ${UPLOADS_DIR}. Indica una ruta explicita o usa --all.`);
      return 1;
    }
  }
  const loaded = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`No existe el archivo: ${file}`);
      return 1;
    }
    try {
      loaded.push({ file, text: fs.readFileSync(file, 'utf8') });
    } catch (error) {
      console.error(`No se pudo leer ${file}: ${error?.message}`);
      return 1;
    }
  }
  console.log(formatReport(computeReport(loaded)));
  return 0;
}

module.exports = {
  UPLOADS_DIR,
  USAGE,
  parseAuditLines,
  readAuditFile,
  outcomeCategory,
  isTimeout,
  latencyStats,
  computeReport,
  modelsWithoutValidResult,
  winnerDistribution,
  listJsonlFiles,
  formatReport,
  main,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}



