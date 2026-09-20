# monopoly 服务镜像（单阶段：安装依赖 → 构建全部工作区 → 运行 server 同源托管 client）
# 构建上下文：仓库根目录（见 docker-compose.yml 的 build.context）
FROM node:24-slim

# 启用 corepack，使用 root package.json 中 packageManager 指定的 pnpm 版本
RUN corepack enable

WORKDIR /app

# 先复制依赖清单以最大化利用构建缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

# 复制源码并构建（pnpm -r build 按拓扑序：shared/engine → server/client）
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm -r build

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

EXPOSE 3000

# 容器内自检（配合 docker ps 的 healthy 状态）
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
