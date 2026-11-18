-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('COTIZACION', 'PEDIDO', 'CALIDAD_VALIDADA', 'RESERVADO', 'CONFIRMADO', 'DOCUMENTACION', 'DESPACHADO', 'EN_TRANSITO', 'ARRIBADO', 'ENTREGADO', 'CERRADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('CUMPLIDO', 'PENDIENTE', 'POR_VENCER', 'VENCIDO', 'NO_APLICABLE', 'REQUIERE_VALIDACION');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('PENDIENTE', 'EN_VERIFICACION', 'APROBADO', 'RECHAZADO', 'REEMBOLSADO', 'EXPIRADO');


-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "fsvpContact" TEXT,
ADD COLUMN     "importerNumber" TEXT;

-- AlterTable
ALTER TABLE "SmartAgreement" ADD COLUMN     "shipmentId" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customerId" INTEGER,
ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "ExportShipment" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'ERP',
    "phase" TEXT NOT NULL DEFAULT 'FASE_3',
    "projected" BOOLEAN NOT NULL DEFAULT true,
    "importer" TEXT NOT NULL,
    "broker" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Estados Unidos',
    "productCode" TEXT NOT NULL DEFAULT 'PT-PAP-FRASCO-113',
    "pallets" INTEGER NOT NULL,
    "cases" INTEGER NOT NULL,
    "jars" INTEGER NOT NULL,
    "netKg" DECIMAL(14,3) NOT NULL,
    "grossKg" DECIMAL(14,3) NOT NULL,
    "unitPriceUsd" DECIMAL(14,4) NOT NULL,
    "amountUsd" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(10,4) NOT NULL,
    "incoterm" TEXT NOT NULL DEFAULT 'FCA',
    "incotermVersion" TEXT NOT NULL DEFAULT 'Incoterms® 2020',
    "incotermPlace" TEXT NOT NULL DEFAULT 'Callao, Perú',
    "deliveryDate" DATE NOT NULL,
    "paymentTerms" TEXT NOT NULL DEFAULT 'Smart contract escrow (red local) + pago real por pasarela',
    "status" "ShipmentStatus" NOT NULL DEFAULT 'COTIZACION',
    "marginPct" DECIMAL(8,3),
    "marginApproved" BOOLEAN NOT NULL DEFAULT false,
    "marginApprovedBy" TEXT,
    "docsStatus" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "docsErrors" JSONB,
    "docsApprovedAt" TIMESTAMP(3),
    "declaredNetKg" DECIMAL(14,3),
    "declaredGrossKg" DECIMAL(14,3),
    "hsCode" TEXT NOT NULL DEFAULT '0904.22.10.00',
    "htsCode" TEXT NOT NULL DEFAULT '0904.22.20',
    "description" TEXT NOT NULL DEFAULT 'Pimentón (páprika) molido en frascos de vidrio de 4 oz (113 g)',
    "damNumber" TEXT,
    "damDate" TIMESTAMP(3),
    "channel" TEXT,
    "levanteDate" TIMESTAMP(3),
    "blNumber" TEXT,
    "manifest" TEXT,
    "container" TEXT,
    "vessel" TEXT,
    "shippingLine" TEXT,
    "shipDate" TIMESTAMP(3),
    "regularizedAt" TIMESTAMP(3),
    "cargoCutoff" TIMESTAMP(3),
    "isfSentAt" TIMESTAMP(3),
    "priorNoticeNo" TEXT,
    "originPort" TEXT NOT NULL DEFAULT 'Callao (PECLL)',
    "destinationPort" TEXT NOT NULL DEFAULT 'Port of Philadelphia (USPHL)',
    "voyageStartedAt" TIMESTAMP(3),
    "voyageDays" INTEGER NOT NULL DEFAULT 18,
    "voyageProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "arrivedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "paidUsd" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "autopilot" BOOLEAN NOT NULL DEFAULT true,
    "otif" BOOLEAN,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pallet" (
    "id" SERIAL NOT NULL,
    "sscc" TEXT NOT NULL,
    "lotId" INTEGER NOT NULL,
    "shipmentId" INTEGER,
    "cases" INTEGER NOT NULL DEFAULT 96,
    "jars" INTEGER NOT NULL DEFAULT 2304,
    "netKg" DECIMAL(14,3) NOT NULL,
    "grossKg" DECIMAL(14,3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISPONIBLE',
    "location" TEXT NOT NULL DEFAULT 'ALM-PT · Rack A-01',
    "bestBy" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentCost" (
    "id" SERIAL NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "concept" TEXT NOT NULL,
    "amountPen" DECIMAL(14,2) NOT NULL,
    "budgetPen" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dataKind" TEXT NOT NULL DEFAULT 'DEMO',

    CONSTRAINT "ShipmentCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceItem" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'EMPRESA',
    "shipmentId" INTEGER,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "status" "ComplianceStatus" NOT NULL DEFAULT 'PENDIENTE',
    "validUntil" DATE,
    "evidence" TEXT,
    "evidenceHash" TEXT,
    "responsible" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "PaymentState" NOT NULL DEFAULT 'PENDIENTE',
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "checkoutUrl" TEXT,
    "operationNumber" TEXT,
    "payerName" TEXT,
    "payerEmail" TEXT,
    "voucherName" TEXT,
    "voucherHash" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "shipmentId" INTEGER,
    "customerId" INTEGER NOT NULL,
    "lotCode" TEXT,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "jars" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ABIERTO',
    "disposition" TEXT,
    "creditUsd" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'ERP',
    "resolution" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircularRecord" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "partner" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircularRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallDrill" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "lotCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "affected" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "minutes" DOUBLE PRECISION,
    "simulated" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RecallDrill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RsProject" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "budgetPen" DECIMAL(14,2) NOT NULL,
    "year1Pen" DECIMAL(14,2) NOT NULL,
    "year2Pen" DECIMAL(14,2) NOT NULL,
    "executedPen" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "expenseClass" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 1,
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANIFICADO',
    "gri" TEXT,

    CONSTRAINT "RsProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RsIndicator" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "baseline" DOUBLE PRECISION,
    "target12" DOUBLE PRECISION NOT NULL,
    "target24" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION,
    "lowerIsBetter" BOOLEAN NOT NULL DEFAULT false,
    "responsible" TEXT NOT NULL,
    "source" TEXT,

    CONSTRAINT "RsIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiQuery" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "channel" TEXT NOT NULL DEFAULT 'ERP',
    "tool" TEXT NOT NULL DEFAULT 'CHAT',
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sources" JSONB,
    "mode" TEXT NOT NULL,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationEvent" (
    "id" SERIAL NOT NULL,
    "shipmentId" INTEGER,
    "rule" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "chain" BOOLEAN NOT NULL DEFAULT false,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExportShipment_code_key" ON "ExportShipment"("code");

-- CreateIndex
CREATE INDEX "ExportShipment_status_idx" ON "ExportShipment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Pallet_sscc_key" ON "Pallet"("sscc");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentCost_shipmentId_concept_key" ON "ShipmentCost"("shipmentId", "concept");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceItem_code_shipmentId_key" ON "ComplianceItem"("code", "shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_code_key" ON "Payment"("code");

-- CreateIndex
CREATE INDEX "Payment_provider_externalId_idx" ON "Payment"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_code_key" ON "Claim"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RecallDrill_code_key" ON "RecallDrill"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RsProject_code_key" ON "RsProject"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RsIndicator_code_key" ON "RsIndicator"("code");

-- CreateIndex
CREATE INDEX "AutomationEvent_shipmentId_idx" ON "AutomationEvent"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SmartAgreement_shipmentId_key" ON "SmartAgreement"("shipmentId");

-- AddForeignKey

-- AddForeignKey
ALTER TABLE "SmartAgreement" ADD CONSTRAINT "SmartAgreement_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ExportShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportShipment" ADD CONSTRAINT "ExportShipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportShipment" ADD CONSTRAINT "ExportShipment_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pallet" ADD CONSTRAINT "Pallet_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pallet" ADD CONSTRAINT "Pallet_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ExportShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCost" ADD CONSTRAINT "ShipmentCost_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ExportShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceItem" ADD CONSTRAINT "ComplianceItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ExportShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ExportShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ExportShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "ExportShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

