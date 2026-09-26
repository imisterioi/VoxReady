-- AlterTable
ALTER TABLE "Theme" ADD COLUMN     "availableToAllVoceros" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optic" TEXT,
ADD COLUMN     "publics" TEXT,
ADD COLUMN     "redLines" TEXT;
