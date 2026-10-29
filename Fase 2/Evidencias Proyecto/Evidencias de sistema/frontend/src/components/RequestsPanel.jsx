import Icon from './Icon';
import { Badge, Card, CardHeader, EmptyState, Segmented } from './ui';
import { REQUEST_KINDS, countRequestsByKind, feedFilterOptions, filterRequestsFeed } from '../lib/requestsFeed';

// Panel ÚNICO de solicitudes.
//
// Mezcla en una sola lista los tipos que gestiona el sistema (privacidad y retención del plazo)
// y los diferencia con una etiqueta de tipo por fila y un filtro interno, en lugar de mostrarlos
// en contenedores separados. Cada pantalla decide qué solicitudes entrega (ya acotadas por
// organización) y qué acciones ofrece; este componente no cambia ningún permiso.
export default function RequestsPanel({
  title = 'Solicitudes',
  description,
  actions,
  items = [],
  filter = 'all',
  onFilterChange,
  onOpen,
  loading = false,
  error = '',
  emptyTitle = 'Sin solicitudes',
  emptyDescription,
  note,
}) {
  const options = feedFilterOptions(items);
  const visible = filterRequestsFeed(items, filter);
  // El filtro por tipo solo aporta cuando hay de los dos tipos.
  const counts = countRequestsByKind(items);
  const showFilter = Boolean(onFilterChange) && counts.privacy > 0 && counts.retention > 0;

  return (
    <Card className="mb-6">
      <CardHeader title={title} description={description} action={actions} />

      {error ? (
        <EmptyState tone="danger" icon="server" title="No se pudieron cargar las solicitudes" description={error} />
      ) : loading ? (
        <EmptyState icon="refresh" title="Cargando solicitudes…" />
      ) : items.length === 0 ? (
        <EmptyState icon="shield" title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {showFilter && (
            <div className="mb-4">
              <Segmented options={options} value={filter} onChange={onFilterChange} />
            </div>
          )}

          <ul className="divide-y divide-line">
            {visible.map((item) => {
              const kind = REQUEST_KINDS[item.kind] || { label: item.kind, tone: 'neutral' };
              return (
                <li key={item.key}>
                  {/* Toda la fila abre el detalle de la solicitud (botón real: teclado y lector de pantalla) */}
                  <button
                    type="button"
                    onClick={() => onOpen?.(item)}
                    className="w-full text-left flex flex-wrap items-center gap-3 px-3 py-4 rounded-lg transition-colors hover:bg-subtle/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 flex-wrap">
                        <Badge tone={kind.tone}>{kind.label}</Badge>
                        <span className="text-sm font-medium text-ink truncate">{item.title}</span>
                      </span>
                      {item.subtitle && <span className="block text-xs text-muted truncate mt-1">{item.subtitle}</span>}
                      {item.meta && <span className="block text-[11px] text-faint truncate mt-0.5">{item.meta}</span>}
                    </span>
                    {item.status && <Badge tone={item.status.tone}>{item.status.label}</Badge>}
                    <span className="hidden sm:inline text-xs text-muted whitespace-nowrap">{item.actionLabel || 'Revisar'}</span>
                    <Icon name="chevronRight" size={16} className="text-faint" />
                  </button>
                </li>
              );
            })}
          </ul>

          {visible.length === 0 && (
            <p className="text-sm text-muted px-3 py-6 text-center">No hay solicitudes de este tipo.</p>
          )}
        </>
      )}

      {note && <p className="text-xs text-faint mt-4">{note}</p>}
    </Card>
  );
}
