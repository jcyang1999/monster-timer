# 公网多人使用部署说明

这个项目已经支持公网部署。固定网址需要一个固定公网入口，二选一：

## 方案 A：部署到云平台

适合长期使用。电脑关机后，别人仍然可以访问。

免费试用流程：

1. 把本目录提交到 GitHub。
2. 在 Render 创建 Web Service，连接这个 GitHub 仓库。
3. Build Command 使用 `npm install --omit=dev`。
4. Start Command 使用 `npm start`。
5. 免费试用时不要添加 Persistent Disk。
6. 部署完成后，Render 会给一个固定网址，例如 `https://xxx.onrender.com`。

仓库里已经放了 `render.yaml`，支持 Render Blueprint 创建。

注意：免费试用版本可以先上线，但账号、怪物和击杀记录保存在云服务的临时文件系统里，重启、重新部署或平台回收实例时可能丢失。

正式长期使用流程：

1. 升级到支持 Persistent Disk 的付费实例。
2. 添加 Persistent Disk，挂载路径 `/var/data`。
3. 设置环境变量 `MONSTER_TIMER_DATA_DIR=/var/data`。
4. 重新部署服务。

## 方案 B：继续跑在自己电脑，用 Cloudflare Tunnel 固定域名

适合先低成本用起来。不需要路由器端口转发，但你的电脑必须开机，Node 服务和 Cloudflare Tunnel 必须运行。

前提：

1. 你有一个域名。
2. 域名 DNS 接入 Cloudflare。
3. 在 Cloudflare Zero Trust 里创建 Tunnel。
4. Public Hostname 指向 `http://localhost:3000`。
5. Cloudflare 会给你一个 Tunnel Token。

运行：

```powershell
.\scripts\start-cloudflare-tunnel.ps1 -TunnelToken "你的TunnelToken"
```

之后别人访问你绑定的域名即可，例如：

```text
https://boss.example.com
```

## 本机启动

```powershell
npm start
```

或者：

```powershell
.\scripts\start-local.ps1
```
