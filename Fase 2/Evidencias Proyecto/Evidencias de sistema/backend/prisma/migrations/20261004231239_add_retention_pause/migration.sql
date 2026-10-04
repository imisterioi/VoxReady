-- CreateTable
CREATE TABLE "RetentionPause" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "RetentionPause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetentionPause_userId_endedAt_idx" ON "RetentionPause"("userId", "endedAt");

-- AddForeignKey
ALTER TABLE "RetentionPause" ADD CONSTRAINT "RetentionPause_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
