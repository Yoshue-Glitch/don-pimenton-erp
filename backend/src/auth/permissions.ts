/** Catálogo de permisos (módulo.acción) y su asignación por defecto a los roles demo. */
export const PERMISSIONS: { code: string; module: string; action: string; description: string }[] = [
  ["dashboard.read", "Ver dashboard"],
  ["agri.read", "Ver gestión agrícola"], ["agri.write", "Registrar parcelas, campañas, actividades y cosechas"],
  ["production.read", "Ver producción"], ["production.write", "Gestionar órdenes de producción"],
  ["quality.read", "Ver calidad"], ["quality.write", "Registrar inspecciones"], ["quality.approve", "Aprobar / rechazar lotes"],
  ["quality.specs", "Configurar especificaciones de calidad"],
  ["inventory.read", "Ver inventarios"], ["inventory.write", "Registrar movimientos y transferencias"],
  ["inventory.adjust.approve", "Autorizar ajustes de inventario"],
  ["purchases.read", "Ver compras"], ["purchases.write", "Registrar solicitudes, cotizaciones y órdenes"],
  ["purchases.approve", "Aprobar solicitudes de compra (Gerencia)"], ["purchases.receive", "Recepcionar insumos"],
  ["purchases.pay", "Registrar pagos a proveedores"],
  ["sales.read", "Ver ventas"], ["sales.write", "Registrar cotizaciones, pedidos y cobros"],
  ["logistics.read", "Ver logística"], ["logistics.write", "Gestionar despachos"],
  ["exports.read", "Ver exportaciones"], ["exports.write", "Gestionar exportaciones"],
  ["marketing.read", "Ver marketing digital y marca"], ["marketing.write", "Gestionar campañas de marketing"],
  ["hr.read", "Ver RR.HH. (sin datos sensibles)"], ["hr.write", "Gestionar RR.HH."], ["hr.sensitive", "Ver datos personales y remuneraciones"],
  ["finance.read", "Ver finanzas"], ["finance.write", "Registrar ingresos, egresos y presupuestos"],
  ["blockchain.read", "Ver Smart Contracts"], ["blockchain.write", "Ejecutar operaciones blockchain"], ["blockchain.arbitrate", "Resolver disputas de acuerdos (árbitro)"],
  ["documents.write", "Adjuntar documentos"],
  ["reports.read", "Generar reportes PDF / Excel"],
  ["demo.run", "Ejecutar y reiniciar la demostración"],
  ["settings.manage", "Configurar el sistema y módulos"], ["users.manage", "Gestionar usuarios y permisos"],
  ["audit.read", "Consultar auditoría"],
].map(([code, description]) => {
  const parts = code.split(".");
  return { code, module: parts[0], action: parts.slice(1).join("."), description };
});

const ALL = PERMISSIONS.map((p) => p.code);
const READ = ALL.filter((c) => c.endsWith(".read"));

export const ROLES: { code: string; name: string; description: string; chainActor?: string; permissions: string[] }[] = [
  { code: "ADMIN", name: "Gerencia General (acceso total)", description: "Titular de la Gerencia General: acceso total y configuración", permissions: ALL },
  {
    code: "GERENCIA", name: "Administración del sistema", description: "Aprobaciones, supervisión y arbitraje de disputas", chainActor: "arbiter",
    permissions: [...READ, "purchases.approve", "inventory.adjust.approve", "quality.approve", "hr.sensitive", "blockchain.write", "blockchain.arbitrate", "demo.run", "documents.write"],
  },
  { code: "AGRICOLA", name: "Responsable agrícola", description: "Parcelas, campañas y cosechas",
    permissions: ["dashboard.read", "agri.read", "agri.write", "production.read", "inventory.read", "purchases.read", "purchases.write"] },
  { code: "PRODUCCION", name: "Responsable de producción", description: "Procesamiento de lotes", chainActor: "registrar",
    permissions: ["dashboard.read", "agri.read", "production.read", "production.write", "quality.read", "inventory.read", "blockchain.read", "blockchain.write", "purchases.read", "purchases.write"] },
  { code: "CALIDAD", name: "Responsable de calidad", description: "Inspecciones, COA y liberación de lotes", chainActor: "quality",
    permissions: ["dashboard.read", "production.read", "quality.read", "quality.write", "quality.approve", "quality.specs", "inventory.read", "blockchain.read", "blockchain.write", "documents.write", "reports.read"] },
  { code: "ALMACEN", name: "Responsable de almacén", description: "Inventarios, kardex y recepciones",
    permissions: ["dashboard.read", "inventory.read", "inventory.write", "production.read", "quality.read", "purchases.read", "purchases.receive", "logistics.read"] },
  { code: "COMERCIAL", name: "Responsable comercial", description: "Clientes, pedidos, despachos y acuerdos", chainActor: "seller",
    permissions: ["dashboard.read", "sales.read", "sales.write", "logistics.read", "logistics.write", "inventory.read", "quality.read", "blockchain.read", "blockchain.write", "exports.read", "marketing.read", "marketing.write", "documents.write", "reports.read"] },
  { code: "FINANZAS", name: "Responsable financiero", description: "Ingresos, egresos, cuentas y presupuestos",
    permissions: ["dashboard.read", "finance.read", "finance.write", "sales.read", "purchases.read", "purchases.pay", "hr.read", "hr.sensitive", "reports.read", "blockchain.read"] },
  { code: "EXPORTACIONES", name: "Responsable de exportaciones", description: "Operaciones internacionales y documentación",
    permissions: ["dashboard.read", "exports.read", "exports.write", "marketing.read", "marketing.write", "sales.read", "quality.read", "inventory.read", "documents.write", "reports.read", "blockchain.read"] },
  { code: "AUDITOR", name: "Auditor (solo lectura)", description: "Consulta de todos los módulos y auditoría",
    permissions: [...READ, "audit.read"] },
];
