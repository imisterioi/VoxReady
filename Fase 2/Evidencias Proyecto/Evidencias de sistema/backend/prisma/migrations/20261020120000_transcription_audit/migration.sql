-- Auditoría de transcripción ASR por respuesta.
-- Una fila por sesión y turno (clave única) para que reintentar no duplique registros.

CREATE TABLE "TranscriptionAudit" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "engine" TEXT,
    "transcript" TEXT,
    "totalMs" INTEGER,
    "reason" TEXT,
    "attempts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptionAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TranscriptionAudit_sessionId_turnIndex_key"
    ON "TranscriptionAudit"("sessionId", "turnIndex");

CREATE INDEX "TranscriptionAudit_sessionId_idx" ON "TranscriptionAudit"("sessionId");

ALTER TABLE "TranscriptionAudit"
    ADD CONSTRAINT "TranscriptionAudit_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
