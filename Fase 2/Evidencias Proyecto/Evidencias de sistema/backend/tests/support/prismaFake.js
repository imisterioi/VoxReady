// Apoyo de pruebas: evaluador de condiciones y operaciones atómicas para un Prisma falso.
// Cubre SOLO lo que usan las rutas (igualdad, null, { in }, { not }, { lt }, { lte }, { gt },
// OR/AND y { increment }). No es un motor SQL: mantiene las pruebas deterministas y sin base real.
const compare = (a, b) => {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() - new Date(b).getTime();
  return Number(a) - Number(b);
};

// Valores nulos de Prisma para columnas JSON: DbNull = NULL de SQL, JsonNull = JSON null.
// En Prisma 7 son objetos SIN claves enumerables cuyo `String()` es 'Prisma.DbNull' (etc.).
function nullTag(value) {
  if (!value || typeof value !== 'object') return null;
  const text = String(value);
  if (text === 'Prisma.DbNull' || text === 'Prisma.AnyNull' || text === 'Prisma.JsonNull') return text;
  return value._tag || null;
}

function matchesNullTag(value, tag) {
  if (tag === 'DbNull' || tag === 'AnyNull' || tag === 'Prisma.DbNull' || tag === 'Prisma.AnyNull') {
    return value === null || value === undefined;
  }
  if (tag === 'JsonNull' || tag === 'Prisma.JsonNull') return value === null;
  return true;
}

function matchesValue(value, expected) {
  const tag = nullTag(expected);
  if (tag) return matchesNullTag(value, tag);
  if (expected === null) return value === null || value === undefined;
  return value === expected;
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return expected.some((clause) => matches(row, clause));
    if (key === 'AND') return expected.every((clause) => matches(row, clause));
    const value = row[key];
    if (expected === null) return value === null || value === undefined;
    if (expected instanceof Date) return value != null && new Date(value).getTime() === expected.getTime();
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const tag = nullTag(expected);
      if (tag) return matchesNullTag(value, tag);
      if ('equals' in expected) return matchesValue(value, expected.equals);
      if ('in' in expected) return expected.in.includes(value);
      if ('not' in expected) return expected.not === null ? value != null : value !== expected.not;
      if ('lt' in expected) return value != null && compare(value, expected.lt) < 0;
      if ('lte' in expected) return value != null && compare(value, expected.lte) <= 0;
      if ('gt' in expected) return value != null && compare(value, expected.gt) > 0;
      if ('gte' in expected) return value != null && compare(value, expected.gte) >= 0;
    }
    return value === expected;
  });
}

// Aplica `data` resolviendo las operaciones atómicas de Prisma ({ increment }, { decrement }).
function applyOps(row, data = {}) {
  const out = { ...data };
  for (const [key, value] of Object.entries(data || {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) continue;
    if ('increment' in value) out[key] = Number(row?.[key] || 0) + Number(value.increment);
    if ('decrement' in value) out[key] = Number(row?.[key] || 0) - Number(value.decrement);
  }
  return out;
}

module.exports = { matches, applyOps, compare };
