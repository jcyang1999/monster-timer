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
5. 免费试用时不用添加 Persistent Disk。
6. 长期正式使用时，建议升级到付费实例并添加 Persistent Disk，Mount Path: `/var/data`，再设置 `MONSTER_TIMER_DATA_DIR=/var/data`。

部署完成后，Render 会给你固定网址，例如：

```text
https://monster-timer.onrender.com
```

更多步骤见 [DEPLOY.md](DEPLOY.md)。
