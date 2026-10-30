import { useState } from 'react';
import toast from 'react-hot-toast';
import { useI18n } from '../lib/i18n';
import { Badge, Button, Card, CardHeader, EmptyState } from './ui';
import useApiData from '../hooks/useApiData';
import { apiFetch } from '../lib/api';
import { timeAgo } from '../data/directory';

// Jobs de borrado y anonimización (GET /api/system/jobs): estado de cada proceso
// automático y situación de los datos por organización. Permite ejecutar la
// retención ahora, para todas las organizaciones o para una sola.

const JOB_STATE_TONE = { ok: 'success', running: 'accent', pending: 'neutral', error: 'danger' };
const TENANT_STATE_TONE = { ACTIVE: 'success', SUSPENDED: 'warning', DELETING: 'danger' };

export default function JobsPanel() {
  const { d } = useI18n();
  const t = d.L.jobs;
  const { data, loading, error, reload } = useApiData('/api/system/jobs');
  const [running, setRunning] = useState(null); // 'all' o id de la organización

  // Totales de la última ejecución, en lenguaje de negocio
  const describeResult = (result) => {
    if (!result) return null;
    const parts = [
      result.videosRemoved != null && t.recordingsRemoved(result.videosRemoved),
      result.transcriptsCleared != null && t.transcriptsRemoved(result.transcriptsCleared),
      result.reportsCleaned != null && t.reportsCleaned(result.reportsCleaned),
      result.total != null && t.orgsRemoved(result.done ?? 0, result.total),
    ].filter(Boolean);
    return parts.join(' · ') || null;
  };

  const jobs = data?.jobs || [];
  const tenants = data?.tenants || [];

  const runRetention = async (tenant) => {
    try {
      setRunning(tenant?.id || 'all');
      const { result } = await apiFetch('/api/system/jobs/retention/run', { method: 'POST', body: tenant ? { tenantId: tenant.id } : {} });
      toast.success(`${t.retentionApplied(tenant?.name)}: ${describeResult(result) || t.noChanges}`);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <Card padded={false} className="mb-6">
      <div className="p-6 pb-0">
        <CardHeader
          title={t.title}
          description={t.desc}
          action={
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => runRetention(null)} disabled={running != null}>
              {running === 'all' ? t.applying : t.applyNow}
            </Button>
          }
        />
      </div>

      {error ? (
        <EmptyState tone="danger" icon="server" title={t.loadFailed} description={error} />
      ) : (
        <>
          <ul className="divide-y divide-line border-t border-line">
            {jobs.map((job) => (
                <li key={job.name} className="flex flex-col sm:flex-row sm:items-center gap-2 px-6 py-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink">{job.label}</div>
                    <div className="text-xs text-faint">
                      {job.everyMinutes ? t.everyMinutes(job.everyMinutes) : t.manual}
                      {job.lastRunAt ? ` · ${t.lastRun(timeAgo(job.lastRunAt, d))}` : ''}
                      {job.lastError ? ` · ${job.lastError.message}` : describeResult(job.lastResult) ? ` · ${describeResult(job.lastResult)}` : ''}
                    </div>
                  </div>
                  <Badge tone={JOB_STATE_TONE[job.state] || JOB_STATE_TONE.error}>{t.jobStates[job.state] || t.jobStates.error}</Badge>
                </li>
            ))}
            {jobs.length === 0 && <li className="px-6 py-3.5 text-[13px] text-muted">{loading ? t.loading : t.noJobs}</li>}
          </ul>

          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="font-medium px-6 py-3">{t.thOrg}</th>
                  <th className="font-medium px-3 py-3">{t.thRetention}</th>
                  <th className="font-medium px-3 py-3 text-right">{t.thPractices}</th>
                  <th className="font-medium px-3 py-3 text-right">{t.thExpired}</th>
                  <th className="font-medium px-3 py-3 text-right">{t.thRecordings}</th>
                  <th className="font-medium px-3 py-3 text-right">{t.thAnonymized}</th>
                  <th className="font-medium px-3 py-3 text-right">{t.thOpenRequests}</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tenants.map((tn) => (
                    <tr key={tn.id}>
                      <td className="px-6 py-3">
                        <div className="font-medium text-ink">{tn.name}</div>
                        <Badge tone={TENANT_STATE_TONE[tn.status] || 'neutral'} className="mt-1">{t.tenantStates[tn.status] || tn.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-muted whitespace-nowrap">
                        {t.retentionDays(tn.retentionDays)} · {tn.retentionMode === 'METRICS' ? t.metricsOnly : t.videoMetrics}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{tn.sessions}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{tn.expiredSessions}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{tn.recordings}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{tn.anonymizedUsers}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{tn.openDeletionRequests}</td>
                      <td className="px-6 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => runRetention(tn)}
                          disabled={running != null || tn.status === 'DELETING'}
                        >
                          {running === tn.id ? t.applying : t.applyRetention}
                        </Button>
                      </td>
                    </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-4 text-[13px] text-muted">
                      {loading ? t.loading : t.noOrgs}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
