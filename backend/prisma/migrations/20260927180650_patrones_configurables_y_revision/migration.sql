-- AlterTable
ALTER TABLE "MasterPattern" ADD COLUMN     "config" JSONB,
ADD COLUMN     "name" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "review" JSONB;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "retentionDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "retentionMode" TEXT NOT NULL DEFAULT 'FULL';

-- CreateTable
CREATE TABLE "PatternOverride" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "patternId" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,

    CONSTRAINT "PatternOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatternOverride_themeId_key" ON "PatternOverride"("themeId");

-- AddForeignKey
ALTER TABLE "PatternOverride" ADD CONSTRAINT "PatternOverride_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "MasterPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternOverride" ADD CONSTRAINT "PatternOverride_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
