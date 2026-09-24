import I from '../data/dictionary';
import Icon from '../components/Icon';
import { Badge, Button, Card, CardHeader, PageHeader, Stat, Table } from '../components/ui';

export default function AdminHome() {
  const t = I.es.L.a1;
  const statValues = [6, 38, 152, 71];
  const statIcons = ['file', 'users', 'activity', 'target'];

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.sub}
        actions={
          <>
            <Button variant="secondary" to="/admin/retencion" icon="lock">
              Retención
            </Button>
            <Button to="/admin/tema" icon="plus">
              {t.newT}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {t.st.map((k, i) => (
          <Stat key={k} label={k} value={statValues[i]} icon={statIcons[i]} />
        ))}
      </div>

      <Card>
        <CardHeader title={t.themesL} description={`${t.rows.length} temas disponibles para tus voceros`} />
        <Table columns={t.th.map((h, i) => ({ label: h, align: i === t.th.length - 1 ? 'right' : 'left' }))}>
          {t.rows.map((row) => (
            <tr key={row[0]} className="group hover:bg-subtle/50 transition-colors">
              <td className="py-4 px-6">
                <div className="flex items-center gap-3">
                  <span className="h-9 w-9 rounded-lg bg-subtle flex items-center justify-center text-muted">
                    <Icon name="file" size={16} />
                  </span>
                  <span className="font-medium text-ink">{row[0]}</span>
                </div>
              </td>
              <td className="py-4 px-6 text-muted">{row[1]}</td>
              <td className="py-4 px-6">
                <div className="flex gap-1">
                  {row[2].split(', ').map((l) => (
                    <Badge key={l} tone="outline">{l}</Badge>
                  ))}
                </div>
              </td>
              <td className="py-4 px-6 text-muted">{row[3]}</td>
              <td className="py-4 px-6 text-right">
                <Button variant="ghost" size="sm" to="/admin/tema" iconRight="chevronRight">
                  {t.edit}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
