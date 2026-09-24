import { useState } from 'react';
import toast from 'react-hot-toast';
import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Radio, Segmented } from '../components/ui';

export default function PoliticaRetencion() {
  const t = I.es.L.a3;
  const [retention, setRetention] = useState('full');
  const [term, setTerm] = useState(t.terms[1]);
  const [requests, setRequests] = useState([{ user: t.delRow[0], date: t.delRow[1] }]);

  const processRequest = (i) => {
    setRequests(requests.filter((_, j) => j !== i));
    toast.success('Solicitud procesada');
  };

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.sub} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t.q1} />
            <div className="space-y-3">
              <Radio checked={retention === 'full'} onChange={() => setRetention('full')} title={t.opt1} description={t.opt1d} />
              <Radio checked={retention === 'metrics'} onChange={() => setRetention('metrics')} title={t.opt2} description={t.opt2d} />
            </div>
          </Card>

          <Card>
            <CardHeader title={t.termL} />
            <Segmented options={t.terms} value={term} onChange={setTerm} />
            <p className="flex items-start gap-2 text-[13px] text-muted mt-4 leading-relaxed">
              <Icon name="info" size={15} className="mt-0.5 text-faint" />
              {t.termLeg}
            </p>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader
            title={t.delL}
            action={<Badge tone={requests.length ? 'accent' : 'neutral'}>{requests.length} pendiente{requests.length === 1 ? '' : 's'}</Badge>}
          />
          {requests.length === 0 ? (
            <EmptyState icon="check" title="Sin solicitudes pendientes" description="Todas las solicitudes de borrado fueron procesadas." />
          ) : (
            <ul className="divide-y divide-line -mx-6 border-t border-line">
              {requests.map((r, i) => (
                <li key={r.user} className="flex items-center gap-3 px-6 py-4">
                  <Avatar initials="V" size="sm" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-ink">{r.user}</div>
                    <div className="text-xs text-muted">{t.th[1]} el {r.date}</div>
                  </div>
                  <Button variant="danger" size="sm" icon="trash" onClick={() => processRequest(i)}>
                    {t.process}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 rounded-xl bg-subtle/60 p-4 flex gap-3">
            <Icon name="shield" size={18} className="text-muted mt-0.5" />
            <p className="text-xs text-muted leading-relaxed">
              Resumen: se conserva <b className="text-ink font-medium">{retention === 'full' ? 'video, audio y métricas' : 'solo métricas'}</b> durante{' '}
              <b className="text-ink font-medium">{term.toLowerCase()}</b>.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
