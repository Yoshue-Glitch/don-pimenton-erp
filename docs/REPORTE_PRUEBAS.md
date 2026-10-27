# Reporte de resultados de pruebas

Ejecución del **27-oct-2026** en el entorno de desarrollo (Linux, Node.js 22.22, PostgreSQL 16.15, Hardhat 2.22.17, solcjs 0.8.24). Salidas copiadas tal cual de las herramientas; no se editaron los resultados.

| Suite | Herramienta | Resultado |
|---|---|---|
| Contratos inteligentes | Hardhat + chai | **14 / 14** aprobadas |
| API, reglas de negocio y escenario integral (PostgreSQL + Hardhat reales) | Vitest + Supertest | **34 / 34** aprobadas |
| Interfaz de punta a punta | Playwright (Chromium) | **17 / 17** verificaciones |
| Compilación de producción del frontend | `next build` | correcta (23 rutas) |
| Verificación de tipos | `tsc --noEmit` (backend y frontend) | sin errores |

Durante las pruebas E2E se detectó y corrigió un defecto real: el correlativo de campañas `CAM-2026` colisionaba con un código sembrado ("Registro duplicado" al crear una campaña desde la interfaz). Se ajustó el seed y se agregó la prueba de regresión *"Correlativos > los códigos nuevos no colisionan con los datos sembrados"*.

**No cubierto:** pruebas de carga y de concurrencia masiva, pentesting, compatibilidad con navegadores distintos de Chromium y ejecución con Docker Compose (sin daemon Docker en el entorno).

## 1. Contratos (`npm run contracts:test`)

```
  PaprikaTraceability
    ✔ registra un lote, evita duplicados y emite eventos (441ms)
    ✔ rechaza registros de actores no autorizados
    ✔ verifica hashes y estado de calidad
    ✔ versiona la actualización de datos del lote
  PaprikaTradeAgreement — flujo feliz
    ✔ completa el acuerdo y libera los fondos de prueba al vendedor
    ✔ evita pagos duplicados
    ✔ impide reutilizar identificadores de acuerdo y comprometer dos veces el mismo lote
    ✔ exige el importe exacto del depósito
  PaprikaTradeAgreement — escenarios negativos
    ✔ Lote rechazado: el contrato bloquea el pago y permite el reembolso
    ✔ Entrega no confirmada: el pago permanece pendiente
    ✔ Usuario no autorizado: el contrato rechaza la transacción
    ✔ Plazo vencido sin confirmación: el comprador recupera sus fondos
    ✔ Disputa: el árbitro no puede liberar al vendedor sin calidad aprobada
    ✔ Protección de reentrada en la liberación de pagos
  14 passing (653ms)
```

## 2. API y escenario integral (`npm run test:api`)

```
 ✓ tests/api.test.ts > Autenticación y seguridad > rechaza credenciales inválidas sin revelar si el usuario existe
 ✓ tests/api.test.ts > Autenticación y seguridad > bloquea la cuenta tras 5 intentos fallidos
 ✓ tests/api.test.ts > Autenticación y seguridad > las contraseñas se almacenan con bcrypt (nunca en texto plano)
 ✓ tests/api.test.ts > Autenticación y seguridad > requiere sesión y cabecera anti-CSRF
 ✓ tests/api.test.ts > Autenticación y seguridad > el cierre de sesión revoca el token
 ✓ tests/api.test.ts > Permisos por rol > cada rol ve solo sus módulos
 ✓ tests/api.test.ts > Permisos por rol > el auditor es de solo lectura
 ✓ tests/api.test.ts > Permisos por rol > una compra no puede ser aprobada sin permiso ni por su propio solicitante
 ✓ tests/api.test.ts > Permisos por rol > los datos personales de RR.HH. se enmascaran sin permiso sensible
 ✓ tests/api.test.ts > Inventario > no permite stock negativo
 ✓ tests/api.test.ts > Inventario > los ajustes requieren autorización de otro usuario con permiso
 ✓ tests/api.test.ts > Inventario > el kardex registra usuario, motivo y documento de referencia
 ✓ tests/api.test.ts > Idempotencia > una operación repetida con la misma clave no crea duplicados
 ✓ tests/api.test.ts > Idempotencia > USD exige tipo de cambio
 ✓ tests/api.test.ts > Exportaciones > no permite marcar requisitos como verificados sin evidencia
 ✓ tests/api.test.ts > Correlativos > los códigos nuevos no colisionan con los datos sembrados
 ✓ tests/api.test.ts > Dashboard > calcula los KPI desde la base de datos
 ✓ tests/scenario.test.ts > Escenario integral: venta de páprika DP-2026-001 > ejecuta los 18 pasos con transacciones confirmadas
 ✓ tests/scenario.test.ts > Escenario integral: venta de páprika DP-2026-001 > los módulos quedaron coherentes
 ✓ tests/scenario.test.ts > Escenario integral: venta de páprika DP-2026-001 > la transacción de liberación existe en la red local
 ✓ tests/scenario.test.ts > Escenario integral: venta de páprika DP-2026-001 > detecta manipulación de datos del lote en el ERP
 ✓ tests/scenario.test.ts > Escenario integral: venta de páprika DP-2026-001 > genera el reporte de trazabilidad en PDF
 ✓ tests/scenario.test.ts > Escenario integral: venta de páprika DP-2026-001 > re-ejecutar un paso no duplica registros
 ✓ tests/scenario.test.ts > Escenarios negativos > lote rechazado: el ERP y el contrato bloquean el pago
 ✓ tests/scenario.test.ts > Escenarios negativos > entrega no confirmada: el pago permanece pendiente
 ✓ tests/scenario.test.ts > Escenarios negativos > usuario no autorizado: el contrato rechaza la transacción
 ✓ tests/scenario.test.ts > Escenarios negativos > el ERP no despacha un lote rechazado
 ✓ tests/scenario.test.ts > Reinicio de la demostración > restaura el estado inicial sin duplicar registros
 ✓ tests/unit.test.ts > Cálculos de producción > rendimiento y merma del ejemplo (1,000 kg → 200 kg)
 ✓ tests/unit.test.ts > Cálculos de producción > rechaza pesos finales mayores al inicial o negativos
 ✓ tests/unit.test.ts > Cálculo de importes de venta > 8 sacos × S/ 375 con IGV incluido = S/ 3,000
 ✓ tests/unit.test.ts > Cálculo de importes de venta > precio sin impuesto y descuento
 ✓ tests/unit.test.ts > Cálculo de importes de venta > la venta por saco exige sacos enteros
 ✓ tests/unit.test.ts > Hash canónico > es independiente del orden de las claves
 Test Files  3 passed (3)
      Tests  34 passed (34)
```

## 3. Interfaz E2E (`npm run test:e2e`)

```
E2E-1 Inicio de sesión
  ✓ credenciales inválidas rechazadas
  ✓ login válido redirige al dashboard
E2E-2 Escenario integral desde la interfaz
  ✓ reinicio de la demostración
  ✓ 18 pasos completados (18)
  ✓ PDF de trazabilidad descargado
  ✓ escenario negativo "Lote rechazado" bloqueado correctamente
  ✓ escenario negativo "Entrega no confirmada" bloqueado correctamente
  ✓ escenario negativo "Usuario no autorizado" bloqueado correctamente
E2E-3 Verificación blockchain
  ✓ lote DP-2026-001 verificado como íntegro
E2E-4 Formularios con validación y persistencia
  ✓ campos obligatorios validados
  ✓ campaña creada y persistida tras recargar
E2E-5 Permisos en la interfaz
  ✓ auditor no ve acciones de calidad
  ✓ auditor no ve 'Nuevo pedido'
  ✓ responsable agrícola solo ve sus módulos
E2E-6 Responsive y modo oscuro
  ✓ modo oscuro aplicado
  ✓ sin desplazamiento horizontal en móvil
  ✓ sin errores JavaScript en página ()

17 verificaciones E2E superadas.
```

## Cómo reproducir

Con PostgreSQL y `npm run chain` activos, ejecute `npm run contracts:test` y `npm run test:api`. Para la E2E, además `npm run api` y `npm run web`, y luego `npm run test:e2e`.
