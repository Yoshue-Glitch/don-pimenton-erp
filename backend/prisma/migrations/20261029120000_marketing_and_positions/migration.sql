-- Puestos sin nombre de persona: el nombre del trabajador pasa a ser opcional
ALTER TABLE "Worker" ALTER COLUMN "firstName" DROP NOT NULL;
ALTER TABLE "Worker" ALTER COLUMN "lastName" DROP NOT NULL;

-- Marketing digital y marca
CREATE TYPE "CampaignState" AS ENUM ('PLANIFICADA', 'ACTIVA', 'FINALIZADA');

CREATE TABLE "MarketingCampaign" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "budgetPen" DECIMAL(14,2) NOT NULL,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "status" "CampaignState" NOT NULL DEFAULT 'PLANIFICADA',
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_budget_nonneg" CHECK ("budgetPen" >= 0),
    CONSTRAINT "marketing_leads_nonneg" CHECK ("leads" >= 0)
);
CREATE UNIQUE INDEX "MarketingCampaign_code_key" ON "MarketingCampaign"("code");
CREATE INDEX "MarketingCampaign_channel_idx" ON "MarketingCampaign"("channel");
