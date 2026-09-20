/**
 * 启动入口：组装 config + buildServer，处理优雅退出
 */
import { HEALTH_PATH } from "@monopoly/shared";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { buildServer } from "./server.js";

const server = buildServer({ dataDir: config.dataDir });

server
  .start(config.port)
  .then((port) => {
    logger.info(`服务已启动: http://0.0.0.0:${port}${HEALTH_PATH}`);
  })
  .catch((err: unknown) => {
    logger.error(err, "服务启动失败");
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info({ signal }, "收到退出信号，正在关闭");
    void server.stop().then(() => {
      logger.info("已安全退出");
      process.exit(0);
    });
    // 兜底：keep-alive 连接可能拖住 close，3 秒后强制退出
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
