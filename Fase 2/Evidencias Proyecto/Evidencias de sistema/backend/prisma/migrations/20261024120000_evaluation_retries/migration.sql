-- Reintentos automáticos de evaluación: metadatos ADITIVOS en "Session".
-- Compatible con datos existentes (defaults seguros). No borra ni recrea nada.
ALTER TABLE "Session" ADD COLUMN "evalAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Session" ADD COLUMN "evalNextAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "evalLeaseUntil" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "evalLastError" TEXT;
ALTER TABLE "Session" ADD COLUMN "evalFinishedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "evalExhausted" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Session_evalNextAt_idx" ON "Session"("evalNextAt");
