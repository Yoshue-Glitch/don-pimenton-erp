import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 300000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL || "postgresql://donpimenton:donpimenton@localhost:5432/donpimenton_test?schema=public",
      UPLOAD_DIR: "./uploads-test",
    },
  },
});
