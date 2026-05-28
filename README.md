# Monster Timer

多人共享怪物击杀时间、刷新倒计时和击杀者记录的网页应用。

## 本地运行

```powershell
npm start
```

打开：

```text
http://localhost:3000
```

## 云部署

推荐使用 Render：

1. 把本项目上传到 GitHub。
2. 在 Render 创建 Web Service 或 Blueprint。
3. Build Command: `npm install --omit=dev`
4. Start Command: `npm start`
5. 免费长期使用时，建议创建 Supabase 免费数据库，并在 Render 设置 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。
6. 不配置 Supabase 时，会退回本地 JSON 文件存储；Render 免费实例重启或重新部署后数据可能丢失。

部署完成后，Render 会给你固定网址，例如：

```text
https://monster-timer.onrender.com
```

更多步骤见 [DEPLOY.md](DEPLOY.md)。
