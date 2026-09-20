/**
 * 构建辅助：把 JSON 数据复制到 dist（数据是运行期依赖，需随包分发）
 */
import { cpSync, mkdirSync } from "node:fs";

const src = new URL("../src/data/", import.meta.url);
const dest = new URL("../dist/data/", import.meta.url);

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[shared] src/data → dist/data 已同步");
