-- La cuenta del portal referencia al cliente sin FK (evita que el TRUNCATE ... CASCADE del reinicio de la demo borre usuarios)
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_customerId_fkey";

-- Agente de aduana autorizado por embarque
ALTER TABLE "ExportShipment" ADD COLUMN IF NOT EXISTS "agentEmail" TEXT;
