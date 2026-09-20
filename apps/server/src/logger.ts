import pino from "pino";
import { APP_NAME } from "@monopoly/shared";
import { config } from "./config.js";

/** 结构化日志（pino；规范要求见 requirements §5 可观测性） */
export const logger = pino({
  name: `${APP_NAME}-server`,
  level: config.logLevel,
});
