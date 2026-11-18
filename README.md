# DON PIMENTÓN ERP | Agroindustrial Management & Blockchain

> *"Del campo al mercado, con calidad y trazabilidad"*

Prototipo **funcional** de ERP para Don Pimentón (empresa agroindustrial familiar de Arequipa, Perú; producción en Caravelí): cultivo, deshidratado, molienda y venta de páprika. Cubre la **operación real actual** (sacos de 25 kg en La Feria Los Incas) y la **exportación proyectada** de páprika molida en **frascos de 4 oz (113 g) a Estados Unidos** (Fases 1–4 del Plan de Negocios 2026), con:

- **Hub de exportación** (tablas TI-9 a TI-15 y OP-1 a OP-9): envasado 24 frascos/caja · 96 cajas/paleta · 2,304 frascos ≈ 260.4 kg; GTIN, GTIN-14, SSCC y QR; reglas **R1–R8** automatizadas; COA de exportación (OP-8); documentos (factura, packing list, ISF, Prior Notice, origen APC…); DAM con semáforo; cumplimiento FDA/SUNAT; costos por frasco y margen; KPI TI-14.
- **Smart Contracts automatizados** (Solidity + Hardhat + ethers.js): un motor ejecuta solo cada tarea del acuerdo (crear, aceptar, depositar, calidad, despacho, entrega, confirmación, liberación) y **un mapa animado con geografía real** muestra el barco Callao → Canal de Panamá → Port Everglades.
- **Portal del comprador** vinculado al ERP y al contrato: catálogo, cotizador, pedido, **pagos con tarjeta (Stripe / Mercado Pago), Yape y transferencia**, seguimiento en vivo, documentos, confirmación de recepción, reclamos y disputas, muestras, registro de compradores.
- **Chatbot “Pimentín”** (ERP y portal) con Claude y búsqueda web limitada a fuentes oficiales, o con base de conocimiento local verificable si no hay clave.
- **Responsabilidad Social** (31 proyectos, tablero GRI con semáforo) y **Logística inversa** (RMA, recall < 4 h, economía circular).

Moneda principal: **PEN (S/)**; operaciones internacionales en **USD** con tipo de cambio registrado. Interfaz en español.

> ⚠️ **Entorno de demostración.** Todos los datos son ficticios. La blockchain es local y sin valor económico. Los comprobantes son documentos internos sin validez tributaria. Rendimientos, costos y especificaciones de calidad precargados son valores de demostración, **no** resultados productivos validados ni límites regulatorios.

---

## Contenido

| Carpeta | Qué contiene |
|---|---|
| `blockchain/` | Contratos `PaprikaTraceability.sol` y `PaprikaTradeAgreement.sol`, pruebas Hardhat, script de despliegue local |
| `backend/` | API Node.js + TypeScript (Express modular), Prisma ORM, PostgreSQL, migraciones, datos demo, integración ethers.js, PDF/Excel, pruebas (Vitest + Supertest) |
| `frontend/` | Next.js 14 + React + TypeScript + Tailwind + Recharts; componentes estilo shadcn/ui; prueba E2E (Playwright) |
| `docs/` | [Arquitectura](docs/ARQUITECTURA.md) · [Reporte de pruebas](docs/REPORTE_PRUEBAS.md) · [Escenario de demostración](docs/ESCENARIO_DEMO.md) |
| `docker-compose.yml` | PostgreSQL + Hardhat + API + Web |

---

## Instalación y ejecución

### Publicar en internet (Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Yoshue-Glitch/don-pimenton-erp)

El archivo `render.yaml` crea un servicio web con el `Dockerfile` de la raíz (Hardhat + API + Web en un solo contenedor) y una base PostgreSQL gestionada. Pasos:

1. Cree una cuenta en https://render.com con su cuenta de GitHub.
2. Pulse el botón de arriba (o en Render: *New → Blueprint* y elija este repositorio) y confirme con *Apply*.
3. Espere a que termine la construcción (≈ 10 min la primera vez). La URL pública aparece en el servicio `don-pimenton-erp` (p. ej. `https://don-pimenton-erp.onrender.com`).
4. La contraseña de los usuarios demo **no** es la documentada: Render genera una aleatoria. Véala en *don-pimenton-erp → Environment → DEMO_PASSWORD*.

Comportamiento en el plan gratuito (verificado simulando el contenedor):
- El servicio se suspende tras un rato sin visitas; la siguiente visita tarda ~1 min en despertar.
- La red Hardhat vive en memoria: al reiniciarse el contenedor, la API detecta la red nueva, **archiva** el historial blockchain anterior (marcado "red reiniciada"), marca los lotes como no registrados y redespliega los contratos. Los datos del ERP se conservan en PostgreSQL. Para volver a tener el escenario completo en cadena use *Demostración → Reiniciar demostración*.
- El contenedor usa ≈ 300 MB de RAM (límite gratuito: 512 MB). Si Render informa falta de memoria, cambie el plan del servicio a *Starter*.
- Las condiciones del plan gratuito (p. ej. caducidad de la base de datos gratuita) las fija Render y pueden cambiar; revíselas en su panel.

### Opción A — Docker Compose

```bash
docker compose up --build
```

Abra http://localhost:3000. La API corre en :4000 y la red Hardhat en :8545. Al iniciar, la API aplica migraciones, carga los datos de demostración (solo si la base está vacía) y despliega los contratos.

> Los archivos Docker se incluyen pero **no pudieron probarse** en el entorno donde se desarrolló el prototipo (sin daemon Docker). La opción B sí fue verificada de punta a punta.

### Opción B — Local (verificada)

Requisitos: Node.js 20+ (probado con 22), PostgreSQL 14+ (probado con 16; el índice `NULLS NOT DISTINCT` requiere ≥ 15).

```bash
npm run install:all
```

Cree la base de datos (ajuste `backend/.env` si usa otras credenciales):

```bash
psql -U postgres -c "CREATE USER donpimenton WITH PASSWORD 'donpimenton' CREATEDB;" -c "CREATE DATABASE donpimenton OWNER donpimenton;"
```

En una terminal, levante la blockchain local (déjela abierta):

```bash
npm run chain
```

En otra terminal, migre, cargue datos demo y despliegue contratos (el seed despliega automáticamente si Hardhat está activo):

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Inicie la API:

```bash
npm run api
```

En otra terminal, inicie la web:

```bash
npm run web
```

Abra **http://localhost:3000**.

Comandos opcionales:

```bash
npm run contracts:compile
```

```bash
npm run contracts:deploy
```

(`contracts:deploy` escribe `blockchain/deployments/localhost.json`; la API también puede desplegar desde el panel *Blockchain → Desplegar contratos* o al *Reiniciar demostración*.)

> **Compilador Solidity:** `hardhat.config.js` usa el compilador `solcjs 0.8.24` del paquete npm `solc`, porque el entorno de desarrollo no tenía acceso a `binaries.soliditylang.org`. Para usar el compilador nativo descargado por Hardhat, ejecute con `USE_NATIVE_SOLC=1`.

> **Si reinicia Hardhat**, la red local se borra. El panel Blockchain lo detecta ("sin código en la dirección") y permite redesplegar; o use *Demostración → Reiniciar demostración*.

---

## Usuarios de demostración

Contraseña común: **`DonPimenton#2026`**

Solo la Gerencia General tiene nombre de persona; el resto de cuentas se identifica por su área.

| Se muestra como | Rol | Usuario |
|---|---|---|
| **Martha Torres** · Gerencia General | Acceso total | admin@donpimenton.pe |
| Departamento de Exportaciones · Logística y documentación | Documentos, DAM | logistica@donpimenton.pe |
| Agencia de Aduanas (externo) | Solo sus embarques, sin costos (P7) | agente@aduanas-demo.pe |
| Importador Demo USA · Compras | **Portal del comprador** | compras@importadordemo-usa.com |
| Food Broker (externo) | Portal, solo consulta | broker@foodbroker-demo.com |
| Administración del sistema | Aprobaciones y arbitraje | gerencia@donpimenton.pe |
| Área Agrícola y Mantenimiento | Agrícola | agricola@donpimenton.pe |
| Procesamiento y Calidad · Producción | Producción | produccion@donpimenton.pe |
| Procesamiento y Calidad · Calidad | Calidad | calidad@donpimenton.pe |
| Comercial y Logística · Almacén | Almacén | almacen@donpimenton.pe |
| Comercial y Logística · Ventas | Comercial | comercial@donpimenton.pe |
| Administración y Finanzas | Finanzas | finanzas@donpimenton.pe |
| Departamento de Exportaciones | Exportaciones y marketing | exportaciones@donpimenton.pe |
| Auditoría interna | Solo lectura | auditor@donpimenton.pe |

Doble factor (TOTP) disponible para roles críticos en *Usuarios y seguridad*. Cada rol ve solo sus módulos y acciones; la Gerencia General edita la matriz de permisos en *Configuración → Roles y permisos*. Tras 5 intentos fallidos la cuenta se bloquea 15 minutos.

---

## Exportación de punta a punta (nuevo)

| Ruta | Qué hace |
|---|---|
| `/simulacion` | **INICIAR SIMULACIÓN DE EXPORTACIÓN**: 20 pasos (parcela → cosecha → lote → proceso → balance de masa → análisis → COA → 2,304 frascos → 96 cajas → paleta → pedido FCA → reserva → documentos → cumplimiento → smart contract → depósito → DAM y despacho → entrega → pago liberado → dashboard) y **PDF final**. Reiniciable: cada corrida usa códigos nuevos. |
| `/comex`, `/comex/[id]` | Pedidos y paletas: cotización automática (margen R8), envasado, reserva R1, piloto automático, pipeline del contrato, mapa, bitácora, documentos R2/R3, DAM, cumplimiento, costos y pagos |
| `/calidad-exportacion` | Panel OP-8 (ASTA, humedad, aw, Salmonella, E. coli, mohos, aflatoxinas, OTA, colorantes, materia extraña, metales, peso neto), límites configurables, retención automática y COA de demostración |
| `/documentos`, `/aduanas`, `/cumplimiento` | Paquete documental en PDF + comparación de documentos, semáforo DAM R4/R5 y tarea ISF R6, registros FDA/SUNAT con bloqueo R7 |
| `/smart-contract` | Pestaña **Contratos automatizados · mapa en vivo**: pipeline de 9 pasos, condiciones verificadas por el contrato, hitos on-chain y eventos (se distingue tx confirmada de actualización del ERP) |
| `/pagos`, `/logistica-inversa`, `/responsabilidad-social`, `/kpi`, `/asistente`, `/pruebas` | Cobranza y verificación, RMA/recall/economía circular, plan de RS, KPI TI-14 exportables, IA con historial y validación humana, **pruebas P1–P12 en vivo** |
| `/portal` | Vista del comprador (ES/EN): catálogo, cotizador, pedido, pago, seguimiento con mapa, documentos, confirmación, reclamos, muestras, registro |
| `/trazabilidad/[lote]` | Consulta pública del QR: historia de origen y verificación de hashes contra la blockchain |

### Pagos reales

El ERP **nunca recibe datos de tarjeta**: el comprador paga en la página certificada PCI de la pasarela. Para cobrar de verdad, configure en el servidor (o en Render → *Environment*), nunca en el repositorio:

| Medio | Variables | Notas |
|---|---|---|
| Tarjeta en USD | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Webhook: `POST /api/payments/webhooks/stripe`. Con `sk_test_…` los cobros son de prueba |
| Tarjeta / Yape en PEN | `MP_ACCESS_TOKEN` | Mercado Pago Checkout Pro; webhook `/api/payments/webhooks/mercadopago` (se verifica consultando la API) |
| Yape directo | `YAPE_NUMBER`, `YAPE_HOLDER`, `YAPE_QR_URL` | El comprador registra el n.° de operación y la constancia; Finanzas verifica en `/pagos` |
| Transferencia | `BANK_NAME`, `BANK_HOLDER`, `BANK_ACCOUNT`, `BANK_CCI`, `BANK_SWIFT` | Igual que Yape; se rechazan n.° de operación duplicados |

También pueden cargarse desde *Pagos y cobranza → Configurar Yape y cuenta bancaria*. Sin configuración, el portal ofrece un **pago de prueba** marcado como no real (`PAYMENTS_ALLOW_TEST=false` lo oculta). Al aprobarse un pago, el ERP registra la cobranza y el motor fondea el escrow del contrato (fondos de prueba de la red local: espejo del pago real).

### Asistente de IA

Con `ANTHROPIC_API_KEY` el chatbot usa Claude (`claude-opus-5-5`) con búsqueda web restringida a dominios oficiales (FDA, CBP, eCFR, USITC, SUNAT, SENASA, DIGESA, PROMPERÚ, MINCETUR, GS1, ICC…), cita sus fuentes y registra cada consulta. Sin clave responde solo desde la base de conocimiento curada del plan y los datos vivos del ERP, en modo demostración y sin inventar resultados.

### Motor de automatización

Corre cada 4 s en la API (`AUTOMATION=off` lo desactiva). En la demo el viaje dura 150 s y la confirmación del comprador puede hacerse con la billetera demo; ambos se ajustan en *Smart Contract → Automatización* (en producción: confirmación solo desde el portal y depósito solo con pago aprobado).

---

## Ejecutar el escenario integral (venta nacional en sacos)

1. Ingrese como `admin@donpimenton.pe` (o `gerencia@`).
2. Menú **Demostración guiada** → *Reiniciar demostración* (escriba `REINICIAR`) para partir de cero.
3. Pulse **Ejecutar demostración completa** (o paso a paso). Los 18 pasos van de la campaña agrícola hasta el pago liberado por el smart contract y el PDF de trazabilidad.
4. Ejecute los tres **escenarios negativos** (lote rechazado, entrega no confirmada, usuario no autorizado).
5. Revise el resultado en **Blockchain & Smart Contracts** (transacciones con hash y bloque, eventos, verificación del lote), **Inventarios → lote DP-2026-001**, **Ventas** y **Finanzas**.

El detalle de cada paso está en [docs/ESCENARIO_DEMO.md](docs/ESCENARIO_DEMO.md).

---

## Pruebas automatizadas

Con PostgreSQL y Hardhat activos:

```bash
npm run contracts:test
```

```bash
npm run test:api
```

`test:api` crea y usa una base aparte (`donpimenton_test`), que debe existir:

```bash
psql -U postgres -c "CREATE DATABASE donpimenton_test OWNER donpimenton;"
```

Prueba E2E de la interfaz (con API, web y Hardhat activos; **reinicia la demostración**):

```bash
npm run test:e2e
```

Resultados de la última ejecución: [docs/REPORTE_PRUEBAS.md](docs/REPORTE_PRUEBAS.md) — **15/15 contratos** (incluye hitos de trazabilidad), **56/56 API** (38 previas + 18 de exportación: P1–P12, simulación de 20 pasos, permisos del agente y del comprador, pagos y QR). Las pruebas P1–P12 también se ejecutan en vivo desde `/pruebas`.

---

## Alcance de esta versión

**Diseño:** identidad del panel de Gerencia (DM Sans + Fraunces, sidebar verde por áreas del organigrama, KPIs con tendencia vs. mes anterior, cadena productiva, exportaciones por destino, estado por área), páginas **Organigrama**, **Marketing y marca** y **Smart Contract**: hero conectado al panel blockchain real, **ruta de exportación de 6 fases / 18 pasos** (guía oficial) con el estado de cada paso según la evidencia del ERP, **9 modelos bilingües** en Word (carta de presentación, cotización internacional, ficha técnica, tarjeta comercial, factura comercial, packing list, solicitud de certificado de origen, instrucciones de embarque y contrato de compraventa con pago condicionado al Smart Contract) que pueden adjuntarse como evidencia con su SHA-256, y guía de DUA, errores comunes y recursos oficiales.

**Datos de demostración (v2):** empresa rentable — una cosecha mensual (~12 t de fresco → ~2.3 t de páprika), ~37 pedidos al año a S/ 15–16 por kg, planilla alineada con RR.HH.; todos los meses operativos en ganancia y margen neto ≈ 15 % (≈ 18 % en los últimos 12 meses). Al desplegar sobre una base con datos v1 (p. ej. Render), se recargan automáticamente una sola vez.

**Implementado y verificado:** autenticación y permisos por rol, auditoría, dashboard calculado desde la BD, gestión agrícola, producción por etapas con rendimiento y merma, calidad con especificaciones configurables por producto/cliente y COA con hash, inventarios (disponible/reservado/cuarentena, kardex, transferencias, ajustes autorizados, alertas, trazabilidad por lote, sacos de 25 kg), compras (solicitud → aprobación de Gerencia → OC → recepción → conformidad → pago), ventas (por kg o saco, impuestos configurables, reservas FEFO, comprobante interno, cobros), logística (5 estados, política de descuento configurable, evidencia de conformidad, devoluciones), exportaciones (directa/indirecta, Incoterms con versión, requisitos documentales que solo se verifican con evidencia), RR.HH. (datos sensibles enmascarados por rol), finanzas (PEN/USD con tipo de cambio, CxC/CxP, flujo de caja vs. presupuesto, costos por campaña, rentabilidad por lote), smart contracts reales, reportes PDF y Excel, modo claro/oscuro, diseño responsive.

**Limitaciones honestas:**
- No hay facturación electrónica SUNAT: solo comprobantes internos y el campo `einvoiceStatus` preparado para una integración futura con un OSE/PSE.
- Contabilidad de gestión, no contabilidad legal (sin plan contable, asientos ni libros electrónicos).
- Las billeteras blockchain son las cuentas públicas deterministas de Hardhat custodiadas por la API: válido solo para la red local. Una red real exigiría billeteras de cada actor (p. ej. firma en el navegador) y auditoría de seguridad de los contratos.
- Un acuerdo inteligente cubre un lote completo de un pedido (simplificación de la demo).
- El ERP no transmite a SUNAT, VUCE, FDA ni CBP: prepara los datos (DAM, ISF, Prior Notice) que transmiten el agente de aduana, el importador o su broker. Los números DAM/B/L de la automatización son de demostración.
- El COA y los documentos de exportación son de demostración (no oficiales). Límites de calidad y plazos aduaneros son referencias del plan, configurables y sujetos a validación normativa.
- La distribución del presupuesto de RS por proyecto es estimada; los totales por plan coinciden con el documento.
- No se incluyen pruebas de carga ni pentesting.
- El costo laboral de RR.HH. es la remuneración bruta registrada, sin cargas sociales.

## Capturas

![Dashboard de exportación](docs/capturas/dashboard-exportacion.png)
![Smart contract automatizado con mapa en vivo](docs/capturas/smart-contract-mapa.png)
![Portal del comprador](docs/capturas/portal-inicio.png)
![Pedido en el portal](docs/capturas/portal-pedido.png)
![Pruebas P1–P12](docs/capturas/pruebas-p1-p12.png)
![Responsabilidad social](docs/capturas/responsabilidad-social.png)

Más capturas y un PDF de trazabilidad de ejemplo en [`docs/capturas`](docs/capturas).
