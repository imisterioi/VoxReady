import { useNavigate } from 'react-router-dom';
import { homeFor } from '../data/mockData';
import { Button } from '../components/ui';
import { getCurrentUser } from '../lib/api';
import { useI18n } from '../lib/i18n';

export default function NotFound() {
  const { d } = useI18n();
  const navigate = useNavigate();
  const user = getCurrentUser();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <span className="font-display font-bold text-[120px] md:text-[160px] leading-none tracking-[-0.04em] text-ink/10 select-none">404</span>
      <h1 className="text-2xl font-semibold tracking-tight text-ink -mt-4">{d.ui.notFound.title}</h1>
      <p className="text-sm text-muted max-w-sm mt-3 leading-relaxed">
        {d.ui.notFound.description}
      </p>
      <div className="flex items-center gap-2 mt-8">
        <Button variant="secondary" icon="arrowLeft" onClick={() => navigate(-1)}>
          {d.ui.notFound.back}
        </Button>
        <Button onClick={() => navigate(user ? homeFor(user.role) : '/login')}>{d.ui.notFound.home}</Button>
      </div>
    </div>
  );
}
