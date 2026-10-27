# Escenario de demostración — Venta de páprika DP-2026-001

Datos ficticios: Don Pimentón vende a **Distribuidora Andina Demo** 8 sacos de 25 kg (200 kg) de páprika deshidratada y molida, provenientes de 1,000 kg de pimentón fresco, a S/ 15/kg = **S/ 3,000** (precio con IGV 18 % incluido: base S/ 2,542.37 + IGV S/ 457.63). Los rendimientos son ficticios.

Cada paso llama a los **mismos servicios** que usa la interfaz. Es idempotente: si el registro ya existe se reutiliza. `ERP` = solo base de datos; `BLOCKCHAIN` = transacción real en Hardhat (chainId 31337), mostrada como exitosa solo tras confirmarse en un bloque.

| # | Paso | Capa | Qué ocurre |
|---|---|---|---|
| 1 | Crear campaña | ERP | `CAM-DEMO-2026-001` en PAR-001, variedad Papri King, 5 actividades con costos (egresos COSTO_AGRICOLA) |
| 2 | Registrar cosecha | ERP | `COS-…` de 1,000 kg; ENTRADA en ALM-MP |
| 3 | Lote de materia prima | ERP | Lote único `MP-2026-001` enviado a procesamiento |
| 4 | Procesar | ERP | `OP-DEMO-2026-001`: consumo de MP y 8 etapas (secado 60 °C · 30 h) |
| 5 | Producto terminado | ERP | Final 200 kg → merma 800 kg, rendimiento 20 %; lote `DP-2026-001` (8 sacos) entra **en cuarentena** |
| 6 | Control de calidad | ERP | Inspección con humedad, ASTA y granulometría evaluadas contra las especificaciones del cliente (demo); COA adjunto con SHA-256 |
| 7 | Aprobar | ERP | Lote APROBADO; stock pasa de cuarentena a disponible |
| 8 | Hash en blockchain | BLOCKCHAIN | `registerLot` (hash de datos) + `recordQuality` (hash del COA) en PaprikaTraceability; verificación ÍNTEGRO |
| 9 | 8 sacos en inventario | ERP | Comprobación: 200 kg = 8 sacos en ALM-PT |
| 10 | Pedido | ERP | `PED-DEMO-2026-001`: 8 sacos × S/ 375; reserva de 200 kg |
| 11 | Acuerdo inteligente | BLOCKCHAIN | `createAgreement` (vendedor) + `acceptAgreement` (comprador demo). 3 ETH de prueba ≙ S/ 3,000 de referencia |
| 12 | Depósito + calidad | BLOCKCHAIN | `depositFunds` (3 ETH en custodia) + `recordQuality` (rol QUALITY, cruzado con PaprikaTraceability) |
| 13 | Despacho y entrega | ERP + BLOCKCHAIN | Despacho Preparación → Despachado → En tránsito → Entregado → Conforme (con acta); se emite comprobante interno y CxC; el inventario se descuenta una sola vez; `recordDelivery` con el hash del acta |
| 14 | Confirmar recepción | BLOCKCHAIN | `confirmReceipt` (solo el comprador) |
| 15 | Liberar pago | BLOCKCHAIN | `releasePayment`: el contrato verifica calidad y entrega confirmada y transfiere los fondos de prueba |
| 16 | Actualizar módulos | ERP | Tras la confirmación on-chain: CxC cobrada (cobro marcado como **SIMULADO**), pedido COMPLETADO, stock del lote en 0 |
| 17 | Tx confirmada | BLOCKCHAIN | Consulta del recibo en la red: bloque, estado, gas y eventos |
| 18 | Reporte PDF | ERP | Trazabilidad completa: campo → planta → calidad → kardex → venta → verificación blockchain |

## Escenarios negativos

| Escenario | Verificaciones (todas deben resultar bloqueadas, salvo el reembolso) |
|---|---|
| **Lote rechazado** (`DP-2026-002`) | ERP impide crear el pedido · el contrato rechaza registrar calidad aprobada (`LotNotApprovedOnChain`) · `releasePayment` revierte (`QualityNotApproved`) · el comprador cancela y **recupera** los fondos (regla explícita) |
| **Entrega no confirmada** (`DP-2026-003`) | Liberar sin entrega → `DeliveryNotConfirmed` · el comprador no puede confirmar sin entrega (`DeliveryNotRecorded`) · con entrega pero sin confirmación → `DeliveryNotConfirmed`; los fondos quedan retenidos (estado FONDEADO) |
| **Usuario no autorizado** | ERP: el rol Auditor no tiene `quality.approve`, `blockchain.write` ni `purchases.approve` (la API responde 403, ver pruebas) · contrato: la billetera `intruder` es rechazada en `recordQuality`, `recordDelivery`, `confirmReceipt`, `releasePayment`, `resolveDispute` y `registerLot` |

Las transacciones rechazadas al estimar gas se registran como **FALLIDA sin hash** (nunca se minaron).

## Reinicio

*Reiniciar demostración* restaura los datos demo (conserva usuarios, roles, configuración y auditoría) y despliega contratos nuevos, para que `DP-2026-001` y `SC-DP-2026-001` puedan registrarse otra vez sin chocar con el control de duplicados del contrato.
