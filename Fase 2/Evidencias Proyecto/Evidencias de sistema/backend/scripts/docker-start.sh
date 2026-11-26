#!/bin/sh
# Arranque del backend en Docker (VoxReady).
#
# Secuencia obligatoria ANTES de servir trÃ¡fico:
#   1) esperar a que PostgreSQL acepte conexiones (con reintentos);
#   2) generar el cliente Prisma (por si el schema montado cambiÃ³);
#   3) aplicar las migraciones PENDIENTES con `prisma migrate deploy`
#      (nunca `migrate dev` ni `migrate reset`: no crea migraciones ni borra datos);
#   4) comprobar que no queden migraciones pendientes.
#
# Si cualquier paso falla, el proceso termina con cÃ³digo != 0 y el servidor NO arranca.
# Prisma registra lo aplicado en `_prisma_migrations`, asÃ­ que `migrate deploy` no repite
# migraciones ya completadas: si no hay pendientes, no toca la base de datos.
#
# Variables opcionales: DB_MAX_ATTEMPTS (por defecto 60), DB_RETRY_SECONDS (por defecto 2).
set -eu

cd "$(dirname "$0")/.."

DB_MAX_ATTEMPTS="${DB_MAX_ATTEMPTS:-60}"
DB_RETRY_SECONDS="${DB_RETRY_SECONDS:-2}"

log() { echo "[arranque] $*"; }

# Espera a la base y aplica migraciones pendientes. Solo reintenta si el fallo es de CONEXIÃ“N;
# un fallo real de migraciÃ³n (SQL invÃ¡lido, conflicto, permisos) aborta el arranque de inmediato.
run_migrations() {
  attempt=1
  while [ "$attempt" -le "$DB_MAX_ATTEMPTS" ]; do
    if output=$(npx prisma migrate deploy 2>&1); then
      printf '%s\n' "$output"
      return 0
    fi
    printf '%s\n' "$output"
    case "$output" in
      *P1001*|*P1002*|*P1003*|*P1017*|*"Can't reach database server"*|*"Connection refused"*|*"the database system is starting up"*|*"Connection terminated"*)
        log "PostgreSQL no estÃ¡ listo todavÃ­a (intento $attempt/$DB_MAX_ATTEMPTS); reintento en ${DB_RETRY_SECONDS}s"
        attempt=$((attempt + 1))
        sleep "$DB_RETRY_SECONDS"
        ;;
      *)
        log "ERROR: la migraciÃ³n fallÃ³ y no es un problema de conexiÃ³n. Se detiene el arranque."
        return 1
        ;;
    esac
  done
  log "ERROR: PostgreSQL no estuvo disponible tras $DB_MAX_ATTEMPTS intentos."
  return 1
}

log "Generando el cliente Prismaâ€¦"
npx prisma generate

log "Aplicando migraciones pendientes (prisma migrate deploy)â€¦"
run_migrations

log "Comprobando el estado de las migracionesâ€¦"
if status_output=$(npx prisma migrate status 2>&1); then
  printf '%s\n' "$status_output"
else
  printf '%s\n' "$status_output"
  log "ERROR: quedan migraciones pendientes o el estado no es vÃ¡lido. Se detiene el arranque."
  exit 1
fi

log "Migraciones al dÃ­a. Arrancando el servidorâ€¦"
exec "$@"
