import { prisma, Tx } from "./prisma";

export async function audit(
  db: Tx | typeof prisma,
  userId: number | null | undefined,
  action: string,
  entity: string,
  entityId?: string | number | null,
  details?: Record<string, unknown>,
  ip?: string,
) {
  await db.auditLog.create({
    data: { userId: userId ?? null, action, entity, entityId: entityId != null ? String(entityId) : null, details: (details as any) ?? undefined, ip },
  });
}
