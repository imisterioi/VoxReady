import { useState } from 'react';
import toast from 'react-hot-toast';
import { useI18n } from '../lib/i18n';
import { Button, Field, Modal } from './ui';
import { displayEmail } from '../lib/displayEmail';
import {
  MAX_DAYS,
  buildRequestPayload,
  emptyRequestForm,
  localizedRequestType,
  requestTypes,
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
  const { d } = useI18n();
  const t = d.L.req.form;
  const types = requestTypes(d);
  const [form, setForm] = useState(() => emptyRequestForm());
  const type = localizedRequestType(form.type, d) || types[0];
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  // Al cambiar de tipo se parte de un formulario limpio del nuevo tipo.
  const changeType = (value) => {
    const next = switchRequestType(value);
    if (next.type === 'RETENTION_EXTENSION') next.requestedDays = String(suggestedExtensionDays(currentDays));
    setForm(next);
  };

  const extensionBlocked = type.kind === 'retention' && Boolean(pendingExtension);

  const submit = () => {
    const validation = validateRequestForm(form, { currentDays, d });
    if (!validation.ok) return toast.error(validation.error);
    const payload = buildRequestPayload(form, { currentDays, d });
    if (payload) onSubmit?.(payload);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.newTitle}
      description={`${type.description} ${t.resolvedByTeam}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t.cancel}
          </Button>
          <Button icon="check" onClick={submit} disabled={saving || extensionBlocked}>
            {saving ? t.sending : t.create}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label={t.typeL} hint={t.typeHint}>
          <select className="input" value={form.type} onChange={(event) => changeType(event.target.value)}>
            {types.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {type.kind === 'privacy' ? (
          <>
            <Field label={t.voceroL} hint={t.voceroHint}>
              <select className="input" value={form.targetUserId} onChange={set('targetUserId')}>
                <option value="">{t.selectVocero}</option>
                {voceros.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {displayEmail(v)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.reasonL} hint={t.reasonHint}>
              <textarea
                className="textarea min-h-[80px]"
                value={form.reason}
                onChange={set('reason')}
                placeholder={t.reasonPh}
              />
            </Field>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-subtle/60 px-4 py-3">
              <div className="text-[11px] text-muted">{t.currentPeriod}</div>
              <div className="text-sm font-medium text-ink mt-0.5">{t.days(currentDays)}</div>
            </div>
            <Field
              label={t.requestedDaysL}
              hint={t.requestedDaysHint(MAX_DAYS)}
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
            <Field label={t.reasonL} hint={t.reasonExtensionHint}>
              <textarea
                className="textarea min-h-[80px]"
                value={form.reason}
                onChange={set('reason')}
                placeholder={t.extensionPh}
              />
            </Field>
            <p className="text-xs text-muted leading-relaxed">
              {t.extensionNote}
            </p>
            {extensionBlocked && (
              <p className="text-xs text-danger leading-relaxed">
                {t.extensionBlocked}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
