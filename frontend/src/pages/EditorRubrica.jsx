import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Segmented, cx } from '../components/ui';
import { apiFetch } from '../lib/api';
import useApiData from '../hooks/useApiData';
import { formatDate } from '../data/directory';

// Editor de patrones de evaluación (configurador maestro).
// Cada patrón guardado es una versión; la IA usa el patrón ACTIVO, salvo en los
// escenarios que tengan un patrón excepcional asignado.

const AREAS = [
  { key: 'expression', label: 'Expresión', source: 'Cámara (MediaPipe)', color: 'rgb(var(--c1))' },
  { key: 'voice', label: 'Tono de voz', source: 'Micrófono', color: 'rgb(var(--c2))' },
  { key: 'coherence', label: 'Coherencia', source: 'IA evaluadora', color: 'rgb(var(--c3))' },
  { key: 'empathy', label: 'Empatía', source: 'IA evaluadora + mirada', color: 'rgb(var(--c4))' },
];

// Parámetros editables de cada criterio medido
const PARAMS = {
  voice: {
    wpm: [
      { key: 'idealMin', label: 'Mínimo ideal', unit: 'pal/min' },
      { key: 'idealMax', label: 'Máximo ideal', unit: 'pal/min' },
    ],
    fillers: [{ key: 'tolerancePerMin', label: 'Tolerancia', unit: 'por minuto' }],
    pauses: [{ key: 'tolerancePerAnswer', label: 'Tolerancia', unit: 'por respuesta' }],
    variation: [
      { key: 'idealMin', label: 'Mínimo', unit: '%' },
      { key: 'idealMax', label: 'Máximo', unit: '%' },
    ],
    latency: [{ key: 'idealMaxSec', label: 'Máximo ideal', unit: 'segundos' }],
  },
  expression: {
    presence: [{ key: 'idealMinPct', label: 'Mínimo', unit: '% del tiempo' }],
    facing: [{ key: 'idealMinPct', label: 'Mínimo', unit: '% del tiempo' }],
    posture: [{ key: 'idealMaxDeg', label: 'Inclinación máxima', unit: '°' }],
  },
};

const STRICTNESS = [
  { value: 'flexible', label: 'Flexible' },
  { value: 'normal', label: 'Normal' },
  { value: 'exigente', label: 'Exigente' },
];

const clone = (o) => JSON.parse(JSON.stringify(o));
const STATUS = { ACTIVE: { label: 'Activo', tone: 'success' }, DRAFT: { label: 'Borrador', tone: 'warning' }, INACTIVE: { label: 'Inactivo', tone: 'neutral' } };

// ------------------------------------------------------------------ Editor

function CriteriaCard({ area, config, setConfig }) {
  const criteria = config[area.key].criteria;
  const setCriterion = (key, field, value) =>
    setConfig((c) => {
      const next = clone(c);
      next[area.key].criteria[key][field] = value;
      return next;
    });
  const total = Object.values(criteria).reduce((s, c) => s + Number(c.weight || 0), 0);

  return (
    <Card>
      <CardHeader
        title={`Criterios de ${area.label.toLowerCase()}`}
        description={area.source}
        action={<Badge tone={total > 0 ? 'outline' : 'danger'}>Peso total {total}</Badge>}
      />
      <div className="divide-y divide-line -mx-6 border-t border-line">
        {Object.entries(criteria).map(([key, c]) => {
          const share = total ? Math.round((Number(c.weight) / total) * 100) : 0;
          return (
            <div key={key} className="px-6 py-4">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">{c.label}</div>
                  <div className="text-xs text-faint">{Number(c.weight) === 0 ? 'No se evalúa' : `${share}% del área`}</div>
                </div>
                <div className="flex items-center gap-3 md:w-56">
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="1"
                    value={c.weight}
                    onChange={(e) => setCriterion(key, 'weight', Number(e.target.value))}
                    className="flex-1 accent-[rgb(var(--accent))]"
                    aria-label={`Peso de ${c.label}`}
                  />
                  <span className="w-6 text-right text-sm font-semibold tabular-nums text-ink">{c.weight}</span>
                </div>
              </div>
              {PARAMS[area.key]?.[key] && Number(c.weight) > 0 && (
                <div className="flex flex-wrap gap-3 mt-3">
                  {PARAMS[area.key][key].map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-xs text-muted">
                      {p.label}
                      <input
                        type="number"
                        step="0.5"
                        className="input h-8 w-20 text-right tabular-nums"
                        value={c[p.key] ?? ''}
                        onChange={(e) => setCriterion(key, p.key, e.target.value === '' ? '' : Number(e.target.value))}
                      />
                      {p.unit}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(area.key === 'coherence' || area.key === 'empathy') && (
        <div className="mt-5 space-y-4">
          <Field label="Descripción para la IA" hint="La IA evaluadora usa este texto como estándar de lo que es un buen desempeño.">
            <textarea
              className="textarea min-h-[80px]"
              value={config[area.key].descriptor}
              onChange={(e) =>
                setConfig((cfg) => {
                  const next = clone(cfg);
                  next[area.key].descriptor = e.target.value;
                  return next;
                })
              }
            />
          </Field>
          {area.key === 'empathy' && (
            <Field label={`Peso de la mirada a cámara en la empatía: ${config.empathy.visualWeight}%`}>
              <input
                type="range"
                min="0"
                max="50"
                step="5"
                value={config.empathy.visualWeight}
                onChange={(e) =>
                  setConfig((cfg) => {
                    const next = clone(cfg);
                    next.empathy.visualWeight = Number(e.target.value);
                    return next;
                  })
                }
                className="w-full accent-[rgb(var(--accent))]"
              />
            </Field>
          )}
        </div>
      )}
    </Card>
  );
}

function PatternEditor({ defaults, patterns, initial, onSaved }) {
  const [config, setConfig] = useState(() => clone(initial?.config || defaults));
  const [name, setName] = useState(initial ? `${initial.name} (copia)` : '');
  const [base, setBase] = useState(initial?.id || 'defaults');
  const [saving, setSaving] = useState(false);

  // Cambiar el patrón de partida
  const loadBase = (id) => {
    setBase(id);
    const p = patterns.find((x) => x.id === id);
    setConfig(clone(p ? p.config : defaults));
    setName(p ? `${p.name} (copia)` : '');
  };

  const areaTotal = AREAS.reduce((s, a) => s + Number(config.areas[a.key] || 0), 0);
  const valid = areaTotal === 100;

  const setArea = (key, value) =>
    setConfig((c) => {
      const next = clone(c);
      next.areas[key] = value;
      return next;
    });

  const save = async (activate) => {
    if (!valid) return toast.error('Los pesos de las áreas deben sumar 100%.');
    if (!name.trim()) return toast.error('Ponle un nombre al patrón.');
    try {
      setSaving(true);
      const { pattern } = await apiFetch('/api/patterns', { method: 'POST', body: { name, config, activate } });
      toast.success(activate ? `${pattern.name} (v${pattern.version}) ahora es el patrón activo` : `Borrador guardado: v${pattern.version}`);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Partir desde">
            <select className="input" value={base} onChange={(e) => loadBase(e.target.value)}>
              <option value="defaults">Valores recomendados</option>
              {patterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · v{p.version}
                  {p.status === 'ACTIVE' ? ' (activo)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nombre del nuevo patrón">
            <input className="input" value={name} placeholder="Ej. Crisis de alta presión" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Exigencia de la IA evaluadora">
            <Segmented options={STRICTNESS} value={config.strictness} onChange={(v) => setConfig((c) => ({ ...c, strictness: v }))} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Peso de cada área en el puntaje global"
          action={
            <Badge tone={valid ? 'success' : 'danger'} icon={valid ? 'check' : 'alert'}>
              Total {areaTotal}%
            </Badge>
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          {AREAS.map((a) => (
            <div key={a.key}>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="flex items-center gap-2 text-ink">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: a.color }} />
                  {a.label}
                </span>
                <span className="font-semibold tabular-nums text-ink">{config.areas[a.key]}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="60"
                step="5"
                value={config.areas[a.key]}
                onChange={(e) => setArea(a.key, Number(e.target.value))}
                className="w-full accent-[rgb(var(--accent))]"
                aria-label={`Peso de ${a.label}`}
              />
            </div>
          ))}
        </div>
        <div className="flex h-2 rounded-full overflow-hidden mt-5 gap-0.5">
          {AREAS.map((a) => (
            <div key={a.key} style={{ width: `${(config.areas[a.key] / Math.max(areaTotal, 1)) * 100}%`, background: a.color }} />
          ))}
        </div>
        {!valid && <p className="text-xs text-danger mt-3">Los pesos deben sumar 100% para guardar.</p>}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {AREAS.map((a) => (
          <CriteriaCard key={a.key} area={a} config={config} setConfig={setConfig} />
        ))}
      </div>

      <div className="sticky bottom-4 z-10 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-line bg-surface/95 backdrop-blur shadow-lift px-5 py-4">
        <p className="text-[13px] text-muted flex-1">
          Guardar crea una <b className="text-ink font-medium">nueva versión</b>; las anteriores quedan en el historial.
        </p>
        <Button variant="secondary" onClick={() => save(false)} disabled={saving}>
          Guardar como borrador
        </Button>
        <Button icon="check" onClick={() => save(true)} disabled={saving || !valid}>
          {saving ? 'Guardando…' : 'Guardar y activar'}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Versiones

function PatternVersions({ patterns, onChanged, onEdit }) {
  const activate = async (p) => {
    try {
      await apiFetch(`/api/patterns/${p.id}/activate`, { method: 'POST' });
      toast.success(`La IA ahora usa "${p.name}" (v${p.version})`);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (!patterns.length) {
    return (
      <Card>
        <EmptyState icon="sliders" title="Aún no hay patrones guardados" description="La IA usa los valores recomendados hasta que guardes uno." />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {patterns.map((p) => (
        <Card key={p.id} className={cx('p-5', p.status === 'ACTIVE' && 'border-success/40')}>
          <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold text-ink">{p.name}</h3>
                <Badge tone="outline">v{p.version}</Badge>
                <Badge tone={STATUS[p.status]?.tone || 'neutral'}>{STATUS[p.status]?.label || p.status}</Badge>
                {p.overrides.length > 0 && <Badge tone="brand">{p.overrides.length} escenario(s) exclusivo(s)</Badge>}
                {p.voceroOverrides?.length > 0 && <Badge tone="brand">{p.voceroOverrides.length} vocero(s) exclusivo(s)</Badge>}
              </div>
              <p className="text-xs text-muted mt-1">
                {p.createdBy?.name || '—'} · {formatDate(p.createdAt)} · exigencia {p.config.strictness}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {AREAS.map((a) => (
                  <Badge key={a.key} tone="outline">
                    {a.label} {p.config.areas[a.key]}%
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="ghost" size="sm" icon="file" onClick={() => onEdit(p)}>
                Editar como nueva versión
              </Button>
              {p.status !== 'ACTIVE' && (
                <Button variant="secondary" size="sm" icon="check" onClick={() => activate(p)}>
                  Usar este patrón
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ------------------------------------------------ Excepciones por escenario

function PatternOverrides({ patterns }) {
  const { data, loading, reload } = useApiData('/api/patterns/themes');
  const themes = useMemo(() => data?.themes || [], [data]);
  const [tenantFilter, setTenantFilter] = useState('all');
  const tenants = useMemo(() => [...new Map(themes.map((t) => [t.tenant.id, t.tenant])).values()], [themes]);
  const active = patterns.find((p) => p.status === 'ACTIVE');

  const change = async (theme, patternId) => {
    try {
      if (!patternId) await apiFetch(`/api/pattern-overrides/${theme.id}`, { method: 'DELETE' });
      else await apiFetch(`/api/pattern-overrides/${theme.id}`, { method: 'PUT', body: { patternId } });
      toast.success(patternId ? `"${theme.title}" usará un patrón exclusivo` : `"${theme.title}" vuelve al patrón activo`);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Patrón exclusivo por escenario"
        description={`Por defecto todos los escenarios usan el patrón activo${active ? ` (${active.name})` : ''}. Aquí puedes asignar otro, de forma excepcional, a un escenario de una organización.`}
        action={
          <select className="input w-56" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
            <option value="all">Todas las organizaciones</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        }
      />
      {loading && !data ? (
        <EmptyState icon="refresh" title="Cargando escenarios…" />
      ) : (
        <div className="divide-y divide-line -mx-6 border-t border-line">
          {themes
            .filter((t) => tenantFilter === 'all' || t.tenant.id === tenantFilter)
            .map((t) => (
              <div key={t.id} className="flex flex-col md:flex-row md:items-center gap-3 px-6 py-3.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{t.title}</div>
                  <div className="text-xs text-muted">{t.tenant.name}</div>
                </div>
                {t.override && <Badge tone="brand" icon="sliders">Exclusivo</Badge>}
                <select className="input md:w-72" value={t.override?.patternId || ''} onChange={(e) => change(t, e.target.value)}>
                  <option value="">Usa el patrón activo</option>
                  {patterns.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · v{p.version}
                    </option>
                  ))}
                </select>
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------ Excepciones por vocero

function VoceroOverrides({ patterns }) {
  const tenantsData = useApiData('/api/patterns/themes');
  const tenants = useMemo(
    () => [...new Map((tenantsData.data?.themes || []).map((t) => [t.tenant.id, t.tenant])).values()],
    [tenantsData.data],
  );
  const [tenantId, setTenantId] = useState('');
  const voceros = useApiData(tenantId ? `/api/patterns/voceros?tenantId=${tenantId}` : null);
  const list = voceros.data?.voceros || [];

  const change = async (v, patternId) => {
    try {
      if (!patternId) await apiFetch(`/api/pattern-overrides/vocero/${v.id}`, { method: 'DELETE' });
      else await apiFetch(`/api/pattern-overrides/vocero/${v.id}`, { method: 'PUT', body: { patternId } });
      toast.success(patternId ? `${v.name} será evaluado con un patrón exclusivo` : `${v.name} vuelve al patrón general`);
      voceros.reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Patrón exclusivo por vocero"
        description="Para casos particulares, por ejemplo un vocero con dificultades del habla al que conviene dar más peso a lo visual. Tiene prioridad sobre el patrón del escenario."
      />
      <Field label="Empresa">
        <select className="input md:w-80" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">Selecciona una empresa…</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>

      {tenantId && (
        <div className="divide-y divide-line -mx-6 border-t border-line mt-5">
          {voceros.loading && !voceros.data && <p className="px-6 py-4 text-sm text-muted">Cargando voceros…</p>}
          {!voceros.loading && list.length === 0 && <p className="px-6 py-4 text-sm text-muted">Esta empresa no tiene voceros.</p>}
          {list.map((v) => (
            <div key={v.id} className="flex flex-col md:flex-row md:items-center gap-3 px-6 py-3.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink truncate">{v.name}</div>
                <div className="text-xs text-muted truncate">
                  {v.email}
                  {v.area ? ` · ${v.area}` : ''}
                </div>
              </div>
              {v.override && <Badge tone="brand" icon="person">Exclusivo</Badge>}
              <select className="input md:w-72" value={v.override?.patternId || ''} onChange={(e) => change(v, e.target.value)}>
                <option value="">Usa el patrón general</option>
                {patterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · v{p.version}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ Página

export default function EditorRubrica() {
  const t = I.es.L.m2;
  const { data, loading, error, reload } = useApiData('/api/patterns');
  const [tab, setTab] = useState('editor');
  const [editFrom, setEditFrom] = useState(null);
  const [editorKey, setEditorKey] = useState(0);

  const patterns = useMemo(() => data?.patterns || [], [data]);
  const active = patterns.find((p) => p.status === 'ACTIVE');

  // Al abrir, el editor parte del patrón activo
  useEffect(() => {
    if (active && !editFrom) setEditFrom(active);
  }, [active, editFrom]);

  const editPattern = (p) => {
    setEditFrom(p);
    setEditorKey((k) => k + 1);
    setTab('editor');
  };

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title="Patrones de evaluación"
        description="Define qué es una buena vocería: el peso de cada área, de cada criterio y los rangos ideales. La IA evaluadora usa el patrón activo."
        actions={active && <Badge tone="success" icon="check">IA usando: {active.name} · v{active.version}</Badge>}
      />

      <Segmented
        className="mb-6"
        options={[
          { value: 'editor', label: 'Editor' },
          { value: 'versions', label: `Versiones guardadas (${patterns.length})` },
          { value: 'overrides', label: 'Excepciones (escenario y vocero)' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading && !data ? (
        <Card>
          <EmptyState icon="refresh" title="Cargando patrones…" />
        </Card>
      ) : error ? (
        <Card>
          <EmptyState tone="danger" icon="server" title="No se pudieron cargar los patrones" description={error} />
        </Card>
      ) : tab === 'editor' ? (
        <PatternEditor
          key={`${editorKey}-${editFrom?.id || 'defaults'}`}
          defaults={data.defaults}
          patterns={patterns}
          initial={editFrom}
          onSaved={() => {
            reload();
            setTab('versions');
          }}
        />
      ) : tab === 'versions' ? (
        <PatternVersions patterns={patterns} onChanged={reload} onEdit={editPattern} />
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl bg-subtle/60 px-4 py-3 text-[13px] text-muted flex items-start gap-2">
            <Icon name="info" size={15} className="mt-0.5 text-faint shrink-0" />
            Prioridad al evaluar: <b className="text-ink font-medium">patrón del vocero</b> → <b className="text-ink font-medium">patrón del escenario</b> →{' '}
            <b className="text-ink font-medium">patrón activo</b>.
          </div>
          <PatternOverrides patterns={patterns} />
          <VoceroOverrides patterns={patterns} />
        </div>
      )}

      <p className="text-xs text-faint mt-6 flex items-center gap-1.5">
        <Icon name="info" size={13} /> Los informes ya generados conservan el patrón con que fueron evaluados.
      </p>
    </>
  );
}
