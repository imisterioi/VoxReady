// Comprobación estática: el dashboard de métricas no debe exponer nombres de campos
// técnicos del backend como texto visible, y debe usar lenguaje humano.
//
// Uso:  node tests/ui-labels.test.js
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'MetricsDashboard.jsx');
const source = fs.readFileSync(file, 'utf8');

// Se excluyen comentarios y las líneas que construyen URLs (no son texto visible).
const visible = source
  .split('\n')
  .filter((line) => {
    const t = line.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !line.includes('api/metrics');
  })
  .join('\n');

// Campos técnicos de Prisma / backend que NO deben aparecer en la interfaz.
const FORBIDDEN = [
  'createdAt', 'updatedAt', 'tenantId', 'anonymizedAt', 'passwordHash',
  'themeId', 'userId', 'sessionId', 'retentionDays', 'retentionMode', 'isGlobal', 'deletedAt',
];

// Etiquetas en lenguaje humano que SÍ deben estar presentes.
const REQUIRED = [
  'Todas las organizaciones',
  'Organización seleccionada',
  'Organizaciones creadas en el período',
  'Voceros activos',
  'Últimos 30 días',
  'Todo el período',
  'Temas más utilizados',
  'Temas menos utilizados',
  'Período',
];

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass += 1; console.log('  \u2713', msg); }
  else { fail += 1; console.log('  \u2717', msg); }
};

console.log('\nEtiquetas del dashboard de métricas');
for (const token of FORBIDDEN) {
  ok(!visible.includes(token), `No aparece el campo técnico "${token}"`);
}
for (const label of REQUIRED) {
  ok(source.includes(label), `Se usa la etiqueta humana "${label}"`);
}

console.log(`\nResultado: ${pass} aprobadas, ${fail} fallidas.`);
process.exitCode = fail === 0 ? 0 : 1;
