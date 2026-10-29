import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { Prisma } from "@prisma/client";
import { authenticate, authRouter, requireAuth, csrfGuard, requireModule } from "./auth/auth";
import { AppError } from "./lib/errors";
import { idempotency } from "./lib/idempotency";
import { dashboardRouter } from "./modules/dashboard";
import { agricultureRouter } from "./modules/agriculture";
import { productionRouter } from "./modules/production";
import { qualityRouter } from "./modules/quality";
import { inventoryRouter } from "./modules/inventory";
import { purchasingRouter } from "./modules/purchasing";
import { salesRouter } from "./modules/sales";
import { logisticsRouter } from "./modules/logistics";
import { exportsRouter } from "./modules/exports";
import { hrRouter } from "./modules/hr";
import { financeRouter } from "./modules/finance";
import { blockchainRouter } from "./modules/blockchain";
import { documentsRouter } from "./modules/documents";
import { reportsRouter } from "./modules/reports";
import { adminRouter } from "./modules/admin";
import { demoRouter } from "./modules/demo";
import { marketingRouter } from "./modules/marketing";

export function createApp() {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "don-pimenton-erp-api", time: new Date().toISOString() }));

  const api = express.Router();
  api.use(authenticate, csrfGuard);
  api.use("/auth", authRouter);
  api.use(requireAuth, idempotency);
  api.use("/dashboard", dashboardRouter);
  api.use("/agriculture", requireModule("agricultura"), agricultureRouter);
  api.use("/production", requireModule("produccion"), productionRouter);
  api.use("/quality", requireModule("calidad"), qualityRouter);
  api.use("/inventory", requireModule("inventario"), inventoryRouter);
  api.use("/purchasing", requireModule("compras"), purchasingRouter);
  api.use("/sales", requireModule("ventas"), salesRouter);
  api.use("/logistics", requireModule("logistica"), logisticsRouter);
  api.use("/exports", requireModule("exportaciones"), exportsRouter);
  api.use("/hr", requireModule("rrhh"), hrRouter);
  api.use("/marketing", requireModule("marketing"), marketingRouter);
  api.use("/finance", requireModule("finanzas"), financeRouter);
  api.use("/blockchain", requireModule("blockchain"), blockchainRouter);
  api.use("/documents", documentsRouter);
  api.use("/reports", reportsRouter);
  api.use("/admin", adminRouter);
  api.use("/demo", demoRouter);
  app.use("/api", api);

  app.use((_req, res) => res.status(404).json({ error: "Ruta no encontrada", code: "NOT_FOUND" }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido", code: "BAD_JSON" });
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Archivo demasiado grande (máx. 10 MB)", code: "FILE_TOO_LARGE" });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") return res.status(409).json({ error: "Registro duplicado", code: "DUPLICATE" });
      if (err.code === "P2025") return res.status(404).json({ error: "Registro no encontrado", code: "NOT_FOUND" });
      if (err.code === "P2003") return res.status(409).json({ error: "Referencia inválida o registro en uso", code: "FK" });
      if (err.code === "P2034") return res.status(409).json({ error: "Conflicto de concurrencia, reintente", code: "CONCURRENCY" });
    }
    if (/violates check constraint/.test(String(err?.message))) return res.status(422).json({ error: "Operación rechazada por una restricción de integridad (p. ej. stock negativo)", code: "CHECK" });
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor", code: "INTERNAL" });
  });
  return app;
}
