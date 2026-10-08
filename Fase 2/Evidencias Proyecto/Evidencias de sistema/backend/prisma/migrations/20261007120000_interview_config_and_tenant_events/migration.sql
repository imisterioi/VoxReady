-- AlterTable
ALTER TABLE "Theme" ADD COLUMN     "interviewConfig" JSONB;

-- CreateTable
CREATE TABLE "TenantEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantCreatedAt" TIMESTAMP(3),

    CONSTRAINT "TenantEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantEvent_type_at_idx" ON "TenantEvent"("type", "at");
