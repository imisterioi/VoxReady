-- CreateTable
CREATE TABLE "VoceroPatternOverride" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "patternId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "VoceroPatternOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoceroPatternOverride_userId_key" ON "VoceroPatternOverride"("userId");

-- AddForeignKey
ALTER TABLE "VoceroPatternOverride" ADD CONSTRAINT "VoceroPatternOverride_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "MasterPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoceroPatternOverride" ADD CONSTRAINT "VoceroPatternOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
