import "dotenv/config";
import path from "path";

const root = path.resolve(__dirname, "..");

export const config = {
  port: Number(process.env.PORT || 4000),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 8),
  cookieName: "dp_session",
  secureCookies: process.env.NODE_ENV === "production",
  chainRpcUrl: process.env.CHAIN_RPC_URL || "http://127.0.0.1:8545",
  deploymentFile: path.resolve(root, process.env.CHAIN_DEPLOYMENT_FILE || "../blockchain/deployments/localhost.json"),
  artifactsDir: path.resolve(root, process.env.CHAIN_ARTIFACTS_DIR || "../blockchain/artifacts/contracts"),
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || "./uploads"),
  // Mnemónico PÚBLICO por defecto de Hardhat. Solo válido para la red local 31337.
  chainMnemonic: process.env.CHAIN_MNEMONIC || "test test test test test test test test test test test junk",
  maxLoginAttempts: 5,
  lockMinutes: 15,
};
