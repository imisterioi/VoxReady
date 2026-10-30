import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Segmented, cx } from '../components/ui';
import { apiFetch } from '../lib/api';
import { displayEmail } from '../lib/displayEmail';
import useApiData from '../hooks/useApiData';
import { formatDate } from '../data/directory';

// Editor de patrones de evaluación (configurador maestro).
// Cada patrón guardado es una versión; la IA usa el patrón ACTIVO, salvo en los
// escenarios que tengan un patrón excepcional asignado.

// Claves internas de las áreas evaluadas: la etiqueta y el canal visibles los aporta el diccionario.
const AREAS = [
  { key: 'expression', color: 'rgb(var(--c1))' },
  { key: 'voice', color: 'rgb(var(--c2))' },
  { key: 'coherence', color: 'rgb(var(--c3))' },
  { key: 'empathy', color: 'rgb(var(--c4))' },
];

// Parámetros editables de cada criterio medido (claves internas; texto visible en el diccionario)
const PARAMS = {
  voice: {
    wpm: [
      { key: 'idealMin', unit: 'wpm' },
      { key: 'idealMax', unit: 'wpm' },
    ],
    fillers: [{ key: 'tolerancePerMin', unit: 'perMinute' }],
    pauses: [{ key: 'tolerancePerAnswer', unit: 'perAnswer' }],
    variation: [
      { key: 'idealMin', unit: 'pct' },
      { key: 'idealMax', unit: 'pct' },
    ],
    latency: [{ key: 'idealMaxSec', unit: 'seconds' }],
  },
  expression: {
    presence: [{ key: 'idealMinPct', unit: 'pctOfTime' }],
    facing: [{ key: 'idealMinPct', unit: 'pctOfTime' }],
    posture: [{ key: 'idealMaxDeg', unit: 'degrees' }],
  },
};

// El VALOR de la exigencia se guarda en el patrón ('exigente'); solo se traduce su etiqueta.
const STRICTNESS = [
  { value: 'flexible', labelKey: 'flexible' },
  { value: 'normal', labelKey: 'normal' },
  { value: 'exigente', labelKey: 'exigente' },
];

const clone = (o) => JSON.parse(JSON.stringify(o));
const STATUS = { ACTIVE: 'success', DRAFT: 'warning', INACTIVE: 'neutral' };

// ------------------------------------------------------------------ Editor

function CriteriaCard({ area, config, setConfig }) {
  const { d } = useI18n();
  const t = d.L.m2;
  // Etiqueta visible del área y de cada criterio: la clave interna del criterio no se traduce.
  const areaLabel = t.areaNames[area.key] || area.key;
  const criterionLabel = (key, fallback) => t.criteriaLabels[key] || fallback;
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
        title={t.criteriaOf(areaLabel.toLowerCase())}
        description={t.areaSources[area.key] || ''}
        action={<Badge tone={total > 0 ? 'outline' : 'danger'}>{t.totalWeight(total)}</Badge>}
      />
      <div className="divide-y divide-line -mx-6 border-t border-line">
        {Object.entries(criteria).map(([key, c]) => {
          const share = total ? Math.round((Number(c.weight) / total) * 100) : 0;
          return (
            <div key={key} className="px-6 py-4">
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">{criterionLabel(key, c.label)}</div>
                  <div className="text-xs text-faint">{Number(c.weight) === 0 ? t.notEvaluated : t.ofArea(share)}</div>
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
                    aria-label={t.weightOf(criterionLabel(key, c.label))}
                  />
                  <span className="w-6 text-right text-sm font-semibold tabular-nums text-ink">{c.weight}</span>
                </div>
              </div>
              {PARAMS[area.key]?.[key] && Number(c.weight) > 0 && (
                <div className="flex flex-wrap gap-3 mt-3">
                  {PARAMS[area.key][key].map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-xs text-muted">
                      {t.paramLabels[`${area.key}.${key}.${p.key}`] || p.key}
                      <input
                        type="number"
                        step="0.5"
                        className="input h-8 w-20 text-right tabular-nums"
                        value={c[p.key] ?? ''}
                        onChange={(e) => setCriterion(key, p.key, e.target.value === '' ? '' : Number(e.target.value))}
                      />
                      {t.paramUnits[p.unit] || p.unit}
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
          <Field label={t.aiDescriptor} hint={t.aiDescriptorHint}>
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
            <Field label={t.visualWeightL(config.empathy.visualWeight)}>
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
  const { d } = useI18n();
  const t = d.L.m2;
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
    if (!valid) return toast.error(t.weightsError);
    if (!name.trim()) return toast.error(t.nameError);
    try {
      setSaving(true);
      const { pattern } = await apiFetch('/api/patterns', { method: 'POST', body: { name, config, activate } });
      toast.success(activate ? t.activatedToast(pattern.name, pattern.version) : t.draftToast(pattern.version));
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
          <Field label={t.startFrom}>
            <select className="input" value={base} onChange={(e) => loadBase(e.target.value)}>
              <option value="defaults">{t.recommendedValues}</option>
              {patterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · v{p.version}
                  {p.status === 'ACTIVE' ? t.activeSuffix : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.newPatternName}>
            <input className="input" value={name} placeholder={t.newPatternPh} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t.strictnessL}>
            <Segmented
              options={STRICTNESS.map((s) => ({ value: s.value, label: t.strictnessLabels[s.labelKey] || s.value }))}
              value={config.strictness}
              onChange={(v) => setConfig((c) => ({ ...c, strictness: v }))}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t.areaWeightsTitle}
          action={
            <Badge tone={valid ? 'success' : 'danger'} icon={valid ? 'check' : 'alert'}>
              {t.totalL(areaTotal)}
            </Badge>
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          {AREAS.map((a) => (
            <div key={a.key}>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="flex items-center gap-2 text-ink">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: a.color }} />
                  {t.areaNames[a.key] || a.key}
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
                aria-label={t.weightOf(t.areaNames[a.key] || a.key)}
              />
            </div>
          ))}
        </div>
        <div className="flex h-2 rounded-full overflow-hidden mt-5 gap-0.5">
          {AREAS.map((a) => (
            <div key={a.key} style={{ width: `${(config.areas[a.key] / Math.max(areaTotal, 1)) * 100}%`, background: a.color }} />
          ))}
        </div>
        {!valid && <p className="text-xs text-danger mt-3">{t.weightsMustSum}</p>}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {AREAS.map((a) => (
          <CriteriaCard key={a.key} area={a} config={config} setConfig={setConfig} />
        ))}
      </div>

      <div className="sticky bottom-4 z-10 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-line bg-surface/95 backdrop-blur shadow-lift px-5 py-4">
        <p className="text-[13px] text-muted flex-1">
          {t.saveCreates} <b className="text-ink font-medium">{t.saveNewVersion}</b>
          {t.saveCreatesTail}
        </p>
        <Button variant="secondary" onClick={() => save(false)} disabled={saving}>
          {t.saveDraft}
        </Button>
        <Button icon="check" onClick={() => save(true)} disabled={saving || !valid}>
          {saving ? t.savingL : t.saveAndActivate}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Versiones

function PatternVersions({ patterns, onChanged, onEdit }) {
  const { d, lang } = useI18n();
  const t = d.L.m2;
  const activate = async (p) => {
    try {
      await apiFetch(`/api/patterns/${p.id}/activate`, { method: 'POST' });
      toast.success(t.aiNowUses(p.name, p.version));
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (!patterns.length) {
    return (
      <Card>
        <EmptyState icon="sliders" title={t.noPatternsTitle} description={t.noPatternsDesc} />
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
                <Badge tone={STATUS[p.status] || 'neutral'}>{t.patternStatus[p.status] || p.status}</Badge>
                {p.overrides.length > 0 && <Badge tone="brand">{t.exclusiveThemes(p.overrides.length)}</Badge>}
                {p.voceroOverrides?.length > 0 && <Badge tone="brand">{t.exclusiveVoceros(p.voceroOverrides.length)}</Badge>}
              </div>
              <p className="text-xs text-muted mt-1">
                {p.createdBy?.name || '—'} · {formatDate(p.createdAt, lang)} ·{' '}
                {t.exigency(t.strictnessLabels[p.config.strictness] || p.config.strictness)}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {AREAS.map((a) => (
                  <Badge key={a.key} tone="outline">
                    {t.areaNames[a.key] || a.key} {p.config.areas[a.key]}%
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="ghost" size="sm" icon="file" onClick={() => onEdit(p)}>
                {t.editAsNewVersion}
              </Button>
              {p.status !== 'ACTIVE' && (
                <Button variant="secondary" size="sm" icon="check" onClick={() => activate(p)}>
                  {t.useThisPattern}
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
  const { d } = useI18n();
  const t = d.L.m2;
  const { data, loading, reload } = useApiData('/api/patterns/themes');
  const themes = useMemo(() => data?.themes || [], [data]);
  const [tenantFilter, setTenantFilter] = useState('all');
  const tenants = useMemo(() => [...new Map(themes.map((t) => [t.tenant.id, t.tenant])).values()], [themes]);
  const active = patterns.find((p) => p.status === 'ACTIVE');

  const change = async (theme, patternId) => {
    try {
      if (!patternId) await apiFetch(`/api/pattern-overrides/${theme.id}`, { method: 'DELETE' });
      else await apiFetch(`/api/pattern-overrides/${theme.id}`, { method: 'PUT', body: { patternId } });
      toast.success(patternId ? t.themeExclusiveToast(theme.title) : t.themeActiveToast(theme.title));
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card>
      <CardHeader
        title={t.themeOverrideTitle}
        description={t.themeOverrideDesc(active?.name)}
        action={
          <select className="input w-56" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
            <option value="all">{t.allOrganizations}</option>
            {tenants.map((tn) => (
              <option key={tn.id} value={tn.id}>
                {tn.name}
              </option>
            ))}
          </select>
        }
      />
      {loading && !data ? (
        <EmptyState icon="refresh" title={t.loadingThemes} />
      ) : (
        <div className="divide-y divide-line -mx-6 border-t border-line">
          {themes
            .filter((th) => tenantFilter === 'all' || th.tenant.id === tenantFilter)
            .map((th) => (
              <div key={th.id} className="flex flex-col md:flex-row md:items-center gap-3 px-6 py-3.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{th.title}</div>
                  <div className="text-xs text-muted">{th.tenant.name}</div>
                </div>
                {th.override && <Badge tone="brand" icon="sliders">{t.exclusive}</Badge>}
                <select className="input md:w-72" value={th.override?.patternId || ''} onChange={(e) => change(th, e.target.value)}>
                  <option value="">{t.usesActivePattern}</option>
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
  const { d } = useI18n();
  const t = d.L.m2;
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
      toast.success(patternId ? t.voceroExclusiveToast(v.name) : t.voceroGeneralToast(v.name));
      voceros.reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card>
      <CardHeader
        title={t.voceroOverrideTitle}
        description={t.voceroOverrideDesc}
      />
      <Field label={t.companyL}>
        <select className="input md:w-80" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">{t.selectCompany}</option>
          {tenants.map((tn) => (
            <option key={tn.id} value={tn.id}>
              {tn.name}
            </option>
          ))}
        </select>
      </Field>

      {tenantId && (
        <div className="divide-y divide-line -mx-6 border-t border-line mt-5">
          {voceros.loading && !voceros.data && <p className="px-6 py-4 text-sm text-muted">{t.loadingVoceros}</p>}
          {!voceros.loading && list.length === 0 && <p className="px-6 py-4 text-sm text-muted">{t.companyNoVoceros}</p>}
          {list.map((v) => (
            <div key={v.id} className="flex flex-col md:flex-row md:items-center gap-3 px-6 py-3.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink truncate">{v.name}</div>
                <div className="text-xs text-muted truncate">
                  {displayEmail(v)}
                  {v.area ? ` · ${d.L.dir.areaLabels[v.area] || v.area}` : ''}
                </div>
              </div>
              {v.override && <Badge tone="brand" icon="person">{t.exclusive}</Badge>}
              <select className="input md:w-72" value={v.override?.patternId || ''} onChange={(e) => change(v, e.target.value)}>
                <option value="">{t.usesGeneralPattern}</option>
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
  const { d } = useI18n();
  const t = d.L.m2;
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
        title={t.patternsTitle}
        description={t.patternsSub}
        actions={active && <Badge tone="success" icon="check">{t.aiUsing(active.name, active.version)}</Badge>}
      />

      <Segmented
        className="mb-6"
        options={[
          { value: 'editor', label: t.tabEditor },
          { value: 'versions', label: t.tabVersions(patterns.length) },
          { value: 'overrides', label: t.tabOverrides },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading && !data ? (
        <Card>
          <EmptyState icon="refresh" title={t.loadingPatterns} />
        </Card>
      ) : error ? (
        <Card>
          <EmptyState tone="danger" icon="server" title={t.loadPatternsFailed} description={error} />
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
            {t.priorityLead}<b className="text-ink font-medium">{t.priorityVocero}</b> → <b className="text-ink font-medium">{t.priorityScenario}</b> →{' '}
            <b className="text-ink font-medium">{t.priorityActive}</b>.
          </div>
          <PatternOverrides patterns={patterns} />
          <VoceroOverrides patterns={patterns} />
        </div>
      )}

      <p className="text-xs text-faint mt-6 flex items-center gap-1.5">
        <Icon name="info" size={13} /> {t.reportsKeepPattern}
      </p>
    </>
  );
}
