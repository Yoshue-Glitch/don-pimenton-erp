-- CreateTable
CREATE TABLE "LabAnalysis" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "lotId" INTEGER NOT NULL,
    "laboratory" TEXT NOT NULL,
    "analysisDate" TIMESTAMP(3) NOT NULL,
    "asta" DOUBLE PRECISION,
    "moisturePct" DOUBLE PRECISION,
    "aw" DOUBLE PRECISION,
    "salmonella" TEXT NOT NULL DEFAULT 'AUSENTE',
    "ecoli" DOUBLE PRECISION,
    "moldsYeasts" DOUBLE PRECISION,
    "aflatoxinB1" DOUBLE PRECISION,
    "aflatoxinTotal" DOUBLE PRECISION,
    "ochratoxinA" DOUBLE PRECISION,
    "bannedDyes" TEXT NOT NULL DEFAULT 'NO_DETECTADO',
    "foreignMatter" TEXT NOT NULL DEFAULT 'CONFORME',
    "metalDetection" TEXT NOT NULL DEFAULT 'CONFORME',
    "netWeightG" DOUBLE PRECISION,
    "evaluation" JSONB,
    "result" TEXT NOT NULL DEFAULT 'EN_EVALUACION',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "evidence" TEXT,
    "coaHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LabAnalysis_code_key" ON "LabAnalysis"("code");

-- AddForeignKey
ALTER TABLE "LabAnalysis" ADD CONSTRAINT "LabAnalysis_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

