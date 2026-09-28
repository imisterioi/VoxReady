-- CreateTable
CREATE TABLE "MasterPattern" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expressionWeight" INTEGER NOT NULL,
    "voiceToneWeight" INTEGER NOT NULL,
    "coherenceWeight" INTEGER NOT NULL,
    "empathyWeight" INTEGER NOT NULL,
    "empathyLevel" TEXT NOT NULL,
    "empathyDescription" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "MasterPattern_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MasterPattern" ADD CONSTRAINT "MasterPattern_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
