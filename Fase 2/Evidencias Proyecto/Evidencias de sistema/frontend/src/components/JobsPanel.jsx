import { useState } from 'react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, CardHeader, EmptyState } from './ui';
import useApiData from '../hooks/useApiData';
import { apiFetch } from '../lib/api';
import { timeAgo } from '../data/directory';

// Jobs de borrado y anonimización (GET /api/system/jobs): estado de cada proceso
// automático y situación de los datos por organización. Permite ejecutar la
// retención ahora, para todas las organizaciones o para una sola.

const JOB_STATE = {
  ok: { label: 'Operativo', tone: 'success' },
  running: { label: 'En ejecución', tone: 'accent' },
  pending: { label: 'Aún no se ejecuta', tone: 'neutral' },
  error: { label: 'Con errores', tone: 'danger' },
};

const TENANT_STATE = {
  ACTIVE: { label: 'Activa', tone: 'success' },
  SUSPENDED: { label: 'Suspendida', tone: 'warning' },
  DELETING: { label: 'Eliminándose', tone: 'danger' },
};

// Totales de la última ejecución, en lenguaje de negocio
function describeResult(result) {
  if (!result) return null;
  const parts = [
    result.videosRemoved != null && `${result.videosRemoved} grabación(es) eliminada(s)`,
    result.transcriptsCleared != null && `${result.transcriptsCleared} transcripción(es) eliminada(s)`,
    result.reportsCleaned != null && `${result.reportsCleaned} informe(s) limpiado(s)`,
    result.total != null && `${result.done ?? 0} de ${result.total} organización(es) eliminada(s)`,
  ].filter(Boolean);
  return parts.join(' · ') || null;
}

export default function JobsPanel() {
  const { data, loading, error, reload } = useApiData('/api/system/jobs');
  const [running, setRunning] = useState(null); // 'all' o id de la organización

  const jobs = data?.jobs || [];
  const tenants = data?.tenants || [];

  const runRetention = async (tenant) => {
    try {
      setRunning(tenant?.id || 'all');
      const { result } = await apiFetch('/api/system/jobs/retention/run', { method: 'POST', body: tenant ? { tenantId: tenant.id } : {} });
      toast.success(`Retención aplicada${tenant ? ` a ${tenant.name}` : ''}: ${describeResult(result) || 'sin cambios'}`);
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
          title="Borrado y anonimización de datos"
          description="Procesos automáticos y situación de los datos de cada organización"
          action={
            <Button variant="secondary" size="sm" icon="refresh" onClick={() => runRetention(null)} disabled={running != null}>
              {running === 'all' ? 'Aplicando…' : 'Aplicar retención ahora'}
            </Button>
          }
        />
      </div>

      {error ? (
        <EmptyState tone="danger" icon="server" title="No se pudo cargar el estado de los jobs" description={error} />
      ) : (
        <>
          <ul className="divide-y divide-line border-t border-line">
            {jobs.map((job) => {
              const ui = JOB_STATE[job.state] || JOB_STATE.error;
              return (
                <li key={job.name} className="flex flex-col sm:flex-row sm:items-center gap-2 px-6 py-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink">{job.label}</div>
                    <div className="text-xs text-faint">
                      {job.everyMinutes ? `Cada ${job.everyMinutes >= 60 ? `${job.everyMinutes / 60} h` : `${job.everyMinutes} min`}` : 'Manual'}
                      {job.lastRunAt ? ` · última ejecución ${timeAgo(job.lastRunAt)}` : ''}
                      {job.lastError ? ` · ${job.lastError.message}` : describeResult(job.lastResult) ? ` · ${describeResult(job.lastResult)}` : ''}
                    </div>
                  </div>
                  <Badge tone={ui.tone}>{ui.label}</Badge>
                </li>
              );
            })}
            {jobs.length === 0 && <li className="px-6 py-3.5 text-[13px] text-muted">{loading ? 'Cargando…' : 'No hay procesos registrados.'}</li>}
          </ul>

          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="font-medium px-6 py-3">Organización</th>
                  <th className="font-medium px-3 py-3">Retención</th>
                  <th className="font-medium px-3 py-3 text-right">Prácticas</th>
                  <th className="font-medium px-3 py-3 text-right">Fuera de plazo</th>
                  <th className="font-medium px-3 py-3 text-right">Grabaciones</th>
                  <th className="font-medium px-3 py-3 text-right">Voceros anonimizados</th>
                  <th className="font-medium px-3 py-3 text-right">Solicitudes abiertas</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tenants.map((t) => {
                  const state = TENANT_STATE[t.status] || { label: t.status, tone: 'neutral' };
                  return (
                    <tr key={t.id}>
                      <td className="px-6 py-3">
                        <div className="font-medium text-ink">{t.name}</div>
                        <Badge tone={state.tone} className="mt-1">{state.label}</Badge>
                      </td>
                      <td className="px-3 py-3 text-muted whitespace-nowrap">
                        {t.retentionDays} días · {t.retentionMode === 'METRICS' ? 'solo métricas' : 'video y métricas'}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{t.sessions}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{t.expiredSessions}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{t.recordings}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{t.anonymizedUsers}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink">{t.openDeletionRequests}</td>
                      <td className="px-6 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => runRetention(t)}
                          disabled={running != null || t.status === 'DELETING'}
                        >
                          {running === t.id ? 'Aplicando…' : 'Aplicar retención'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-4 text-[13px] text-muted">
                      {loading ? 'Cargando…' : 'No hay organizaciones.'}
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
