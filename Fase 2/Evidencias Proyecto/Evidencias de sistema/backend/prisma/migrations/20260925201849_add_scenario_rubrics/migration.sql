-- CreateTable
CREATE TABLE "ScenarioRubric" (
    "id" TEXT NOT NULL,
    "expressionWeight" INTEGER NOT NULL,
    "voiceToneWeight" INTEGER NOT NULL,
    "coherenceWeight" INTEGER NOT NULL,
    "empathyWeight" INTEGER NOT NULL,
    "empathyLevel" TEXT NOT NULL,
    "empathyDescription" TEXT NOT NULL,
    "manuallyModified" BOOLEAN NOT NULL DEFAULT false,
    "masterPatternId" TEXT,
    "masterPatternVersion" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignmentId" TEXT NOT NULL,

    CONSTRAINT "ScenarioRubric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioRubric_assignmentId_key" ON "ScenarioRubric"("assignmentId");

-- AddForeignKey
ALTER TABLE "ScenarioRubric" ADD CONSTRAINT "ScenarioRubric_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ScenarioAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioRubric" ADD CONSTRAINT "ScenarioRubric_masterPatternId_fkey" FOREIGN KEY ("masterPatternId") REFERENCES "MasterPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;
