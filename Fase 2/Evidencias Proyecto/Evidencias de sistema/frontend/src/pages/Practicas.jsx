import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import Icon from '../components/Icon';
import { Avatar, Badge, Card, EmptyState, PageHeader, Table } from '../components/ui';
import useApiData from '../hooks/useApiData';
import { formatDate, initialsOf } from '../data/directory';

const scoreTone = (s) => (s >= 70 ? 'success' : s >= 50 ? 'warning' : 'danger');

// Prácticas realizadas por los voceros de la organización (admin del cliente)
export default function Practicas() {
  const { d, lang } = useI18n();
  const t = d.L.a4;
  const { data, loading, error } = useApiData('/api/practices');
  const practices = useMemo(() => data?.practices || [], [data]);
  const [vocero, setVocero] = useState('all');
  const [theme, setTheme] = useState('all');

  const voceros = useMemo(() => [...new Map(practices.map((p) => [p.user.id, p.user])).values()], [practices]);
  const themes = useMemo(() => [...new Map(practices.filter((p) => p.theme).map((p) => [p.theme.id, p.theme])).values()], [practices]);
  const filtered = practices.filter((p) => (vocero === 'all' || p.user.id === vocero) && (theme === 'all' || p.theme?.id === theme));
  const avg = filtered.length ? Math.round(filtered.reduce((s, p) => s + p.score, 0) / filtered.length) : null;

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <select className="input sm:w-56" value={vocero} onChange={(e) => setVocero(e.target.value)}>
          <option value="all">{t.allVoceros}</option>
          {voceros.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <select className="input sm:w-72" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="all">{t.allScenarios}</option>
          {themes.map((th) => (
            <option key={th.id} value={th.id}>
              {th.title}
            </option>
          ))}
        </select>
        {avg != null && (
          <div className="sm:ml-auto flex items-center gap-2 text-sm text-muted">
            {t.average} <b className="text-ink tabular-nums">{avg}</b> {t.inPractices(filtered.length)}
          </div>
        )}
      </div>

      <Card>
        {error ? (
          <EmptyState tone="danger" icon="server" title={t.loadFailed} description={error} />
        ) : loading && !data ? (
          <EmptyState icon="refresh" title={t.loading} />
        ) : filtered.length === 0 ? (
          <EmptyState icon="activity" title={t.empty} description={t.emptyDesc} />
        ) : (
          <Table
            columns={[
              { label: t.thVocero },
              { label: t.thScenario },
              { label: t.thDate },
              { label: t.thScore },
              { label: t.thAlerts },
              { label: '', align: 'right' },
            ]}
          >
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-subtle/50 transition-colors">
                <td className="py-3.5 px-6">
                  <div className="flex items-center gap-3 min-w-[180px]">
                    <Avatar initials={initialsOf(p.user.name)} size="sm" />
                    <span className="font-medium text-ink">{p.user.name}</span>
                  </div>
                </td>
                <td className="py-3.5 px-6 text-muted max-w-[260px] truncate">{p.theme?.title}</td>
                <td className="py-3.5 px-6 text-muted whitespace-nowrap">{formatDate(p.completedAt || p.createdAt, lang)}</td>
                <td className="py-3.5 px-6">
                  <Badge tone={scoreTone(p.score)}>{p.score}/100</Badge>
                </td>
                <td className="py-3.5 px-6 whitespace-nowrap">
                  <div className="flex gap-1.5">
                    {p.redLinesCrossed > 0 && <Badge tone="danger" icon="alert">{t.redLines(p.redLinesCrossed)}</Badge>}
                    {p.hasVideo && <Badge tone="outline" icon="video">{t.video}</Badge>}
                    {p.reviewed && <Badge tone="brand" icon="shield">{t.reviewed}</Badge>}
                  </div>
                </td>
                <td className="py-3.5 px-6 text-right">
                  <Link to={`/admin/informe?sesion=${p.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
                    {t.viewReport} <Icon name="chevronRight" size={14} />
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
