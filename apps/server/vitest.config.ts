import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // 测试环境屏蔽日志噪音（pino silent）
    env: { LOG_LEVEL: "silent" },
    // 集成测试涉及端口与临时数据库，串行执行更稳定
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
