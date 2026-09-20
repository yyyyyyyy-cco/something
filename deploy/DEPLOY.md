# monopoly 部署手册（M0-5 上线链路）

> 遵循《新项目服务上线规范》（服务器 124.221.172.89）。本文所有命令在服务器 `ubuntu` 用户下执行。
> 变量约定：`<域名>` = 本项目实际域名；`<service-name>` = 服务器服务目录名（默认 `monopoly`）。
> 完整验收标准见 [monopoly-development-plan.md](../../.agent/plans/monopoly-development-plan.md) §3。

## 0. 前置条件

- [ ] 域名 `<域名>` 的 DNS 已解析到 124.221.172.89（腾讯云 DNS）
- [ ] 服务器已存在 `proxy-net` 网络与 `nginx-proxy` 容器（服务器现状满足）
- [ ] 代码已同步到服务器 `~/<service-name>/`（git clone 或 rsync；服务目录 = 仓库根）

## 1. 环境变量

```bash
cd ~/<service-name>
cp .env.example .env        # 默认值可直接使用；后续敏感项统一放这里
```

## 2. 构建并启动容器

```bash
docker compose config --quiet          # 语法校验（应无输出）
docker compose up -d --build
docker ps --filter name=monopoly       # 期望：状态 healthy、无宿主端口映射
curl -s http://127.0.0.1:3000/healthz  # 容器内自检接口（仅服务器本机可执行）
```

> 若构建阶段 better-sqlite3 无预编译包而编译失败，在 `deploy/Dockerfile` 的 `pnpm install` 前临时加入：
> `RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*`

## 3. nginx 反代接入

```bash
# 3.1 复制配置并替换域名（sed 或手动编辑均可）
sed 's/<域名>/实际域名/g' deploy/nginx/monopoly.conf > ~/nginx-proxy/conf.d/实际域名.conf

# 3.2 申请证书（webroot 模式，验证目录 /var/www/certbot；与现有证书流程一致）
sudo certbot certonly --webroot -w /var/www/certbot -d 实际域名
# 证书需就位于 ~/nginx-proxy/ssl/实际域名/{fullchain.pem,privkey.pem}
# （参照现有 certbot-deploy-hook.sh 的部署方式执行）

# 3.3 校验并热加载
docker exec nginx-proxy nginx -t
docker exec nginx-proxy nginx -s reload
```

## 4. 备份登记

在 `~/backup-databases.sh` 的 `# >>> 新服务在此登记 <<<` 注释行前追加一行：

```bash
backup_file_db "$HOME/<service-name>/data/monopoly.db" "monopoly"
```

试跑并核对：

```bash
env -i HOME=/home/ubuntu PATH=/usr/bin:/bin /bin/bash ~/backup-databases.sh
tail -8 ~/backup.log        # 期望：monopoly -> monopoly-<日期>.db (…) 且完整性校验通过
```

## 5. 上线验证清单（规范 §5.2 定制版）

- [ ] `curl -skI https://<域名> | head -1` → 期望 `HTTP/2 200`（或 HTTP/1.1 200）
- [ ] `curl -skI http://<域名> | head -1` → 期望 301 跳转 HTTPS
- [ ] `curl -sk https://<域名>/healthz` → 期望 `{"ok":true,...}`
- [ ] `docker ps` → monopoly 容器无宿主端口、状态 healthy
- [ ] `docker stats --no-stream | grep monopoly` → 限额 512MiB
- [ ] `docker inspect monopoly --format '{{json .HostConfig.LogConfig}}'` → max-size/max-file 正确
- [ ] `docker inspect monopoly --format '{{json .HostConfig.SecurityOpt}}'` → no-new-privileges
- [ ] 备份日志含 monopoly OK（步骤 4）
- [ ] IP 直访被拒（default_server 444）：`curl -sk -o /dev/null -w '%{http_code}\n' --max-time 5 http://124.221.172.89 -H 'Host: unknown'` → 期望 000
- [ ] 动态限流抽查（可选）：高频请求 `/healthz` 以外的动态路径应出现 429 JSON
- [ ] WSS 通道验证留待 M2 联调专项（M0 骨架无业务 socket 事件，静态页 + /healthz 通过即达标）

## 6. 注意事项（规范踩坑记录要点）

- 容器重建（`docker compose up -d --build`）后必须执行 `docker exec nginx-proxy nginx -s reload`（反代 IP 缓存）
- **永远不要 `docker compose down -v`**
- SQLite 为 WAL 模式：备份必须走脚本（`.backup` 一致性快照），禁止直接 `cp` 数据库文件
- `.env` 不入库（已 gitignore）；如后续出现敏感项（密钥等），仅维护在服务器 `.env`
