// Ventana del historial de prácticas (misma para el vocero y para el administrador).
//
// Reglas:
//  - Al entrar se muestran como máximo 10 sesiones (las más recientes, el orden lo pone el backend).
//  - Si hay más de 10, aparece la flecha para ampliar hasta 20 dentro del bloque actual.
//  - Si hay más de 20, se añade paginación: el backend devuelve bloques de 20 (no todo el historial).
//  - Nunca se muestran páginas vacías: la página pedida se acota al rango existente.
export const PAGE_SIZE = 20; // filas que se piden al backend por página
export const COLLAPSED = 10; // filas visibles antes de expandir

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function historyWindow({ total = 0, page = 1, expanded = false } = {}) {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / PAGE_SIZE));
  const parsed = Math.floor(Number(page));
  const current = clamp(Number.isFinite(parsed) && parsed > 0 ? parsed : 1, 1, pages);
  const offset = (current - 1) * PAGE_SIZE;
  const inBlock = clamp(Math.max(0, total) - offset, 0, PAGE_SIZE);
  return {
    page: current,
    pages,
    offset,
    limit: PAGE_SIZE,
    visible: Math.min(inBlock, expanded ? PAGE_SIZE : COLLAPSED),
    inBlock,
    // La flecha solo tiene sentido si hay más de 10 sesiones en total y quedan por mostrar.
    showExpand: total > COLLAPSED,
    canExpand: inBlock > COLLAPSED,
    // La paginación solo aparece cuando hay más de 20 sesiones.
    showPagination: total > PAGE_SIZE,
  };
}

// Números de página a pintar: `1 2 3 4 5 … 12`, siempre con la activa dentro de la ventana.
// El hueco se representa con la cadena 'gap' (el componente lo pinta como «…»).
export function pageNumbers(pages, current, { size = 5 } = {}) {
  if (pages <= 1) return [1];
  if (pages <= size) return Array.from({ length: pages }, (_, i) => i + 1);

  const half = Math.floor(size / 2);
  const start = clamp(current - half, 1, pages - size + 1);
  const end = Math.min(pages, start + size - 1);

  const items = [];
  if (start > 1) {
    items.push(1);
    if (start > 2) items.push('gap');
  }
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < pages) {
    if (end < pages - 1) items.push('gap');
    items.push(pages);
  }
  return items;
}
