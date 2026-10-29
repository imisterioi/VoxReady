-- Cambio de plan de retención PROGRAMADO (persistente) + solicitudes de extensión del plazo.
-- Todo es ADITIVO: columnas nuevas opcionales en "Tenant" y una tabla nueva. No se modifica ni
-- se elimina ningún dato existente.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "retentionModePending" TEXT,
ADD COLUMN     "retentionDaysPending" INTEGER,
ADD COLUMN     "retentionEffectiveAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RetentionExtensionRequest" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "currentDays" INTEGER NOT NULL,
    "requestedDays" INTEGER NOT NULL,
    "appliedDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "tenantId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "resolvedById" TEXT,

    CONSTRAINT "RetentionExtensionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetentionExtensionRequest_tenantId_status_idx" ON "RetentionExtensionRequest"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "RetentionExtensionRequest" ADD CONSTRAINT "RetentionExtensionRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionExtensionRequest" ADD CONSTRAINT "RetentionExtensionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionExtensionRequest" ADD CONSTRAINT "RetentionExtensionRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
