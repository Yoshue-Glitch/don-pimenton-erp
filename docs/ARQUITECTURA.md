# Arquitectura — Don Pimentón ERP

```
 Navegador ──HTTPS──▶ Next.js (frontend :3000) ──/api/* (rewrite, same-origin)──▶ API Node.js (:4000)
                                                                                  │        │
                                                                         Prisma ORM│        │ethers.js v6
                                                                                  ▼        ▼
                                                                        PostgreSQL 16   Hardhat node (chainId 31337)
                                                                       (datos ERP)     PaprikaTraceability / PaprikaTradeAgreement
```

- **Frontend** (`frontend/`): Next.js 14 App Router, React 18, TypeScript, Tailwind, Recharts, lucide-react. Componentes propios al estilo shadcn/ui (`src/components/ui`), tabla paginada genérica, formularios declarativos con validación y clave de idempotencia. Las rutas `/api/*` se reenvían a la API, así la cookie de sesión es del mismo origen.
- **API** (`backend/src`): Express + TypeScript, organizada por módulo (`modules/*.ts`, cada uno con su router y servicios). Se eligió Express modular en lugar de NestJS (el requisito admitía "API modular equivalente") para reducir boilerplate. Validación con Zod. Cada operación crítica corre en una **transacción serializable** (`inTx`) con reintentos.
- **Blockchain** (`blockchain/`): Solidity 0.8.24 + OpenZeppelin 5 (AccessControl, ReentrancyGuard), Hardhat 2.22, pruebas con chai matchers.

## Módulos de la API

| Ruta | Módulo | Notas |
|---|---|---|
| `/api/auth` | Autenticación | login, logout, me (módulos visibles) |
| `/api/dashboard` | KPI, series, alertas, búsqueda global | todo calculado en vivo |
| `/api/agriculture` | Parcelas, campañas, actividades, cosechas | la cosecha genera el lote MP |
| `/api/production` | Órdenes, etapas, cierre | rendimiento y merma; varios lotes PT por MP |
| `/api/quality` | Especificaciones, inspecciones, decisiones | aprobar = liberar stock; rechazo = bloqueo |
| `/api/inventory` | Productos, almacenes, saldos, kardex, lotes, trazabilidad, transferencias, ajustes, alertas | |
| `/api/purchasing` | Proveedores, solicitudes, cotizaciones, comparación, OC, recepción, conformidad, CxP | |
| `/api/sales` | Clientes, cotizaciones, pedidos, reservas, comprobante interno, CxC, cobros | |
| `/api/logistics` | Transportistas, vehículos, despachos, devoluciones | |
| `/api/exports` | Socios, órdenes internacionales, requisitos documentales | |
| `/api/hr` | Trabajadores, asistencia, vacaciones, capacitaciones, evaluaciones, costos | enmascarado sin `hr.sensitive` |
| `/api/finance` | Transacciones, presupuestos, tipo de cambio, flujo de caja, costos, rentabilidad | |
| `/api/blockchain` | Estado de red, despliegue, transacciones, eventos, verificación de lotes, acuerdos | |
| `/api/documents` | Carga/descarga con SHA-256 y verificación de integridad | |
| `/api/reports` | PDF de trazabilidad, PDF de comprobante interno, Excel | |
| `/api/admin` | Configuración, usuarios, roles/permisos, áreas, auditoría | |
| `/api/demo` | Escenario integral, escenarios negativos, reinicio | |

## Seguridad

- Contraseñas con **bcrypt (coste 12)**; política de contraseña fuerte al crear usuarios.
- Sesión: token aleatorio de 256 bits en cookie `httpOnly`, `SameSite=Lax` (`Secure` en producción); en BD solo se guarda su SHA-256. Expira a las 8 h y se revoca al cerrar sesión, desactivar el usuario o cambiar su contraseña.
- Bloqueo tras 5 intentos fallidos (15 min); mensaje genérico ante credenciales inválidas.
- Anti-CSRF: toda petición que modifica datos exige la cabecera `X-Requested-With: DonPimentonERP`.
- Helmet (cabeceras de seguridad), límite de tamaño de JSON y de archivos (10 MB, tipos permitidos).
- **RBAC**: 37 permisos `módulo.acción`, 10 roles. El backend valida cada endpoint (`requirePerm`) y el frontend oculta las acciones (`<Can>`). Segregación de funciones: nadie aprueba su propia solicitud de compra ni su propio ajuste de inventario.
- Módulos desactivables: la API responde 403 en las rutas de un módulo desactivado.
- **Auditoría** (`AuditLog`) de altas, cambios, aprobaciones, accesos denegados, logins y operaciones blockchain.

## Base de datos

PostgreSQL normalizado: 63 tablas (`backend/prisma/schema.prisma`). Migraciones en `backend/prisma/migrations`:

1. `init`: tablas, claves foráneas, índices y restricciones únicas generados por Prisma.
2. `integrity_constraints`: SQL manual con **CHECK** (`stock >= 0`, cantidades > 0, cobrado ≤ importe, peso final ≤ inicial, tipo de cambio > 0…) y un índice único `NULLS NOT DISTINCT` para el saldo por producto/almacén/lote.

Entidades principales: usuarios, roles, permisos, áreas, sesiones, auditoría, configuración, correlativos, claves de idempotencia, trabajadores (+ contratos, asistencia, vacaciones, capacitaciones, evaluaciones), parcelas, campañas, actividades, cosechas, productos, lotes (genealogía MP → PT), órdenes y etapas de producción, especificaciones e inspecciones de calidad, almacenes y ubicaciones, saldos, movimientos, reservas, ajustes, proveedores, solicitudes, cotizaciones, OC, recepciones, CxP, clientes, cotizaciones y pedidos de venta, comprobantes internos, CxC, transportistas, vehículos, despachos, documentos, socios exportadores, órdenes y requisitos de exportación, transacciones financieras, presupuestos, tipos de cambio, despliegues de contratos, acuerdos inteligentes, transacciones y eventos blockchain, ejecuciones de demo.

### Integridad del inventario

`applyMovement` (`modules/inventory.service.ts`) es el único punto que modifica saldos: bloquea la fila con `SELECT … FOR UPDATE`, aplica el efecto del tipo de movimiento sobre *disponible / reservado / cuarentena*, rechaza cualquier saldo negativo y registra el movimiento (usuario, fecha, motivo, documento de referencia, saldo posterior). El `CHECK` de la BD es una segunda barrera.

Ciclo del producto terminado: producción → `INGRESO_CUARENTENA` → aprobación de calidad → `LIBERACION_CUARENTENA` → pedido → `RESERVA` (FEFO, solo lotes APROBADOS) → despacho → `SALIDA` desde reservado. El despacho usa la bandera `inventoryPosted` con actualización condicional para no descontar dos veces, en el momento que indique la política `inventory.dispatchPolicy`.

### Idempotencia

- Cabecera `Idempotency-Key`: la primera respuesta se guarda y una repetición la devuelve (`Idempotent-Replay: true`). Los formularios del frontend la envían.
- Correlativos atómicos (`INSERT … ON CONFLICT … RETURNING`) y códigos únicos.
- Los pasos de la demo comprueban la existencia del registro antes de crearlo.

## Smart Contracts

### PaprikaTraceability
- Roles: `REGISTRAR_ROLE` (producción), `QUALITY_ROLE` (calidad), admin.
- `registerLot(lotId, sha256(datos))` sin duplicados · `updateLotData` versionado · `recordQuality(lotId, estado, sha256(COA))` · `verifyLot` · `isApproved`.
- **On-chain solo hay identificadores y hashes**. El hash de datos se calcula sobre un JSON canónico (claves ordenadas) con código, producto, cantidades, fechas, campaña, cosecha y orden de producción, **sin datos personales ni comerciales sensibles**. El hash del certificado es el SHA-256 del archivo COA adjunto (o del informe de inspección si no se adjuntó archivo).

### PaprikaTradeAgreement
- Roles: `SELLER_ROLE`, `QUALITY_ROLE`, `LOGISTICS_ROLE`, `ARBITER_ROLE`. Comprador = dirección registrada en el acuerdo.
- Estados: Propuesto → Aceptado → Fondeado → Ejecutado | Cancelado | Reembolsado | En disputa.
- Reglas: depósito por el importe exacto; la conformidad de calidad exige que el lote figure APROBADO en PaprikaTraceability; la entrega exige calidad aprobada; solo el comprador confirma la recepción; la liberación exige calidad aprobada y entrega **confirmada**; un pago nunca se libera dos veces; los identificadores de acuerdo no se reutilizan y un lote no se compromete en dos acuerdos; la cancelación con fondos solo procede si la calidad fue rechazada, si venció el plazo sin confirmación (comprador) o si el vendedor desiste; las disputas las resuelve el árbitro, que nunca puede pagar al vendedor sin calidad aprobada.
- `nonReentrant` + checks-effects-interactions en todas las funciones que transfieren fondos (probado con un vendedor malicioso que intenta reentrar).
- Eventos en cada transición; el ERP los guarda en `BlockchainEvent` (por recibo y con *Sincronizar eventos*, que recorre `queryFilter` desde el bloque de despliegue).

### Integración ERP ↔ blockchain (`backend/src/blockchain/chain.ts`)
- Solo acepta chainId **31337**; si la red no responde o el contrato no tiene código, la operación falla con un mensaje claro (**sin simulación silenciosa**).
- `sendTx`: crea el registro PENDIENTE → envía → espera 1 confirmación → CONFIRMADA (bloque, gas, eventos) o FALLIDA (error decodificado a texto en español; distingue "rechazada antes de minar" de "minada y revertida"). Los envíos se serializan para evitar colisiones de nonce.
- El cobro del pedido se registra en finanzas **solo después** de que `releasePayment` se confirma, marcado como `simulated = true` y referenciando el hash.
- Actores: cuentas deterministas de Hardhat (comprador, vendedor, calidad, logística, árbitro, registrador e "intruso"), custodiadas por la API exclusivamente para la red local.

## Decisiones y límites

- Express modular en lugar de NestJS; componentes al estilo shadcn/ui escritos en el repositorio (no se usó el CLI de shadcn).
- `solcjs` (npm) en lugar del compilador nativo por falta de acceso a binaries.soliditylang.org en el entorno de desarrollo.
- Sin facturación electrónica real (preparado el campo `einvoiceStatus`); contabilidad de gestión, no legal.
