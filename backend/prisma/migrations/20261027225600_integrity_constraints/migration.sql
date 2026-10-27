-- Restricciones de integridad que Prisma no expresa en el esquema.

-- Stock nunca negativo (última línea de defensa además de la lógica de negocio)
ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "balance_available_nonneg" CHECK ("availableKg" >= 0),
  ADD CONSTRAINT "balance_reserved_nonneg" CHECK ("reservedKg" >= 0),
  ADD CONSTRAINT "balance_quarantine_nonneg" CHECK ("quarantineKg" >= 0);

-- Un único saldo por producto/almacén/lote (lote NULL tratado como valor)
CREATE UNIQUE INDEX "balance_product_wh_lot_key"
  ON "InventoryBalance" ("productId", "warehouseId", "lotId") NULLS NOT DISTINCT;

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "movement_qty_positive" CHECK ("quantityKg" > 0);
ALTER TABLE "Lot" ADD CONSTRAINT "lot_qty_positive" CHECK ("quantityKg" > 0);
ALTER TABLE "Lot" ADD CONSTRAINT "lot_consumed_le_qty" CHECK ("consumedKg" >= 0 AND "consumedKg" <= "quantityKg");
ALTER TABLE "Harvest" ADD CONSTRAINT "harvest_qty_positive" CHECK ("quantityKg" > 0);
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "po_initial_positive" CHECK ("initialWeightKg" > 0);
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "po_final_le_initial" CHECK ("finalWeightKg" IS NULL OR ("finalWeightKg" >= 0 AND "finalWeightKg" <= "initialWeightKg"));
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "soi_qty_positive" CHECK ("quantity" > 0 AND "quantityKg" > 0);
ALTER TABLE "AccountReceivable" ADD CONSTRAINT "ar_collected_le_amount" CHECK ("collected" >= 0 AND "collected" <= "amount");
ALTER TABLE "AccountPayable" ADD CONSTRAINT "ap_paid_le_amount" CHECK ("paidAmount" >= 0 AND "paidAmount" <= "amount");
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "ft_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "fx_rate_positive" CHECK ("rate" > 0);
