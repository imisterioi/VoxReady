import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Field, Modal } from './ui';
import { displayEmail } from '../lib/displayEmail';
import {
  MAX_DAYS,
  REQUEST_TYPES,
  buildRequestPayload,
  emptyRequestForm,
  requestType,
  suggestedExtensionDays,
  switchRequestType,
  validateRequestForm,
} from '../lib/requestForm';

// Formulario ÚNICO de solicitudes del administrador del cliente.
//
// Se elige primero el tipo de solicitud y solo aparecen los campos de ese tipo; al cambiarlo, los
// campos del tipo anterior se descartan (ver lib/requestForm.js), así nunca se envían datos
// incompatibles. El envío lo ejecuta la pantalla, que conoce las listas que hay que refrescar.
export default function RequestFormModal({
  open = true,
  onClose,
  onSubmit,
  voceros = [],
  currentDays = 0,
  pendingExtension = null,
  saving = false,
}) {
  const [form, setForm] = useState(() => emptyRequestForm());
  const type = requestType(form.type) || REQUEST_TYPES[0];
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  // Al cambiar de tipo se parte de un formulario limpio del nuevo tipo.
  const changeType = (value) => {
    const next = switchRequestType(value);
    if (next.type === 'RETENTION_EXTENSION') next.requestedDays = String(suggestedExtensionDays(currentDays));
    setForm(next);
  };

  const extensionBlocked = type.kind === 'retention' && Boolean(pendingExtension);

  const submit = () => {
    const validation = validateRequestForm(form, { currentDays });
    if (!validation.ok) return toast.error(validation.error);
    const payload = buildRequestPayload(form, { currentDays });
    if (payload) onSubmit?.(payload);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva solicitud"
      description={`${type.description} La resolución la realiza el equipo VoxReady.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button icon="check" onClick={submit} disabled={saving || extensionBlocked}>
            {saving ? 'Enviando…' : 'Crear solicitud'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Tipo de solicitud" hint="Según el tipo verás solo los campos que necesita.">
          <select className="input" value={form.type} onChange={(event) => changeType(event.target.value)}>
            {REQUEST_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {type.kind === 'privacy' ? (
          <>
            <Field label="Vocero" hint="Solo voceros de tu organización.">
              <select className="input" value={form.targetUserId} onChange={set('targetUserId')}>
                <option value="">Selecciona un vocero…</option>
                {voceros.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {displayEmail(v)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Motivo" hint="Opcional. Queda registrado en la solicitud.">
              <textarea
                className="textarea min-h-[80px]"
                value={form.reason}
                onChange={set('reason')}
                placeholder="Ej. Solicitud del titular por derecho al olvido."
              />
            </Field>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-subtle/60 px-4 py-3">
              <div className="text-[11px] text-muted">Plazo vigente</div>
              <div className="text-sm font-medium text-ink mt-0.5">{currentDays} días</div>
            </div>
            <Field
              label="Plazo solicitado (días)"
              hint={`Debe ser mayor que el plazo vigente. Máximo ${MAX_DAYS} días.`}
            >
              <input
                type="number"
                min="1"
                max={MAX_DAYS}
                className="input w-40"
                value={form.requestedDays}
                onChange={set('requestedDays')}
              />
            </Field>
            <Field label="Motivo" hint="Opcional, pero ayuda a justificar la extensión.">
              <textarea
                className="textarea min-h-[80px]"
                value={form.reason}
                onChange={set('reason')}
                placeholder="Ej. Necesitamos conservar las grabaciones para una auditoría interna."
              />
            </Field>
            <p className="text-xs text-muted leading-relaxed">
              Al aprobarse, la extensión se aplica de inmediato: los datos existentes quedan protegidos y la
              retención no los borrará hasta que se cumpla el nuevo plazo.
            </p>
            {extensionBlocked && (
              <p className="text-xs text-danger leading-relaxed">
                Ya tienes una solicitud de extensión pendiente: espera su resolución antes de pedir otra.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
