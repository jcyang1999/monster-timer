const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.MONSTER_TIMER_DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

let db = {
  users: [],
  sessions: {},
  monsters: [],
  killEvents: [],
};

const sseClients = new Set();

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    db = JSON.parse(raw);
    db.users ||= [];
    db.sessions ||= {};
    db.monsters ||= [];
    db.killEvents ||= [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveDb();
  }

  if (db.users.length > 0 && !db.users.some((user) => user.isAdmin)) {
    db.users[0].isAdmin = true;
    db.users[0].adminSince = nowIso();
    await saveDb();
  }
}

async function saveDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(value.join("="));
  }
  return cookies;
}

function getSession(req) {
  const token = parseCookies(req).mt_session;
  if (!token) return null;
  const session = db.sessions[token];
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId);
  if (!user) return null;
  return { token, user };
}

function isAdmin(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const configuredAdmins = String(process.env.ADMIN_USERNAMES || "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return configuredAdmins.includes(user.username.toLowerCase());
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    isAdmin: isAdmin(user),
  };
}

function latestKillEvent(monsterId) {
  return db.killEvents
    .filter((event) => event.monsterId === monsterId)
    .sort((a, b) => new Date(b.killedAt) - new Date(a.killedAt))[0];
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function publicState() {
  const usersById = new Map(db.users.map((user) => [user.id, user.username]));
  const eventsByMonster = new Map();
  for (const event of db.killEvents) {
    if (!eventsByMonster.has(event.monsterId)) eventsByMonster.set(event.monsterId, []);
    eventsByMonster.get(event.monsterId).push(event);
  }

  return {
    serverTime: nowIso(),
    monsters: db.monsters
      .filter((monster) => !monster.deletedAt)
      .map((monster) => {
        const events = (eventsByMonster.get(monster.id) || [])
          .slice()
          .sort((a, b) => new Date(b.killedAt) - new Date(a.killedAt));
        const latest = events[0] || null;
        return {
          ...monster,
          latestKill: latest
            ? {
                id: latest.id,
                killedAt: latest.killedAt,
                killerId: latest.killerId,
                killerName: usersById.get(latest.killerId) || "未知",
              }
            : null,
          eventCount: events.length,
        };
      })
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN")),
  };
}

function broadcastState() {
  const message = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

function requireUser(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: "请先登录。" });
    return null;
  }
  return session.user;
}

function cleanUsername(username) {
  return String(username || "").trim().replace(/\s+/g, " ");
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true, serverTime: nowIso() });
    return;
  }

  if (req.method === "GET" && req.url === "/api/me") {
    const session = getSession(req);
    sendJson(res, 200, {
      user: session ? publicUser(session.user) : null,
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/register") {
    const body = await readBody(req);
    const username = cleanUsername(body.username);
    const password = String(body.password || "");
    if (username.length < 2 || username.length > 20) {
      sendJson(res, 400, { error: "用户名需要 2 到 20 个字符。" });
      return;
    }
    if (password.length < 6) {
      sendJson(res, 400, { error: "密码至少 6 位。" });
      return;
    }
    if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      sendJson(res, 409, { error: "这个用户名已经被注册。" });
      return;
    }
    const { salt, hash } = hashPassword(password);
    const user = {
      id: newId("usr"),
      username,
      salt,
      passwordHash: hash,
      isAdmin: db.users.length === 0,
      createdAt: nowIso(),
    };
    db.users.push(user);
    const token = newId("ses");
    db.sessions[token] = { userId: user.id, createdAt: nowIso() };
    await saveDb();
    res.setHeader("set-cookie", `mt_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    sendJson(res, 201, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && req.url === "/api/login") {
    const body = await readBody(req);
    const username = cleanUsername(body.username);
    const password = String(body.password || "");
    const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
    if (!user || !verifyPassword(password, user)) {
      sendJson(res, 401, { error: "用户名或密码不正确。" });
      return;
    }
    const token = newId("ses");
    db.sessions[token] = { userId: user.id, createdAt: nowIso() };
    await saveDb();
    res.setHeader("set-cookie", `mt_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && req.url === "/api/logout") {
    const session = getSession(req);
    if (session) {
      delete db.sessions[session.token];
      await saveDb();
    }
    res.setHeader("set-cookie", "mt_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/api/state") {
    if (!requireUser(req, res)) return;
    sendJson(res, 200, publicState());
    return;
  }

  if (req.method === "GET" && req.url === "/api/events") {
    if (!requireUser(req, res)) return;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "POST" && req.url === "/api/monsters") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const respawnMinutes = Number(body.respawnMinutes);
    if (name.length < 1 || name.length > 30) {
      sendJson(res, 400, { error: "怪物名需要 1 到 30 个字符。" });
      return;
    }
    if (!Number.isFinite(respawnMinutes) || respawnMinutes < 1 || respawnMinutes > 1440 * 30) {
      sendJson(res, 400, { error: "刷新间隔需要在 1 分钟到 30 天之间。" });
      return;
    }
    db.monsters.push({
      id: newId("mon"),
      name,
      respawnMinutes: Math.round(respawnMinutes),
      order: Date.now(),
      createdAt: nowIso(),
      createdBy: user.id,
    });
    await saveDb();
    broadcastState();
    sendJson(res, 201, { ok: true });
    return;
  }

  const monsterMatch = req.url.match(/^\/api\/monsters\/([^/]+)(?:\/([^/]+))?$/);
  if (monsterMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const [, monsterId, action] = monsterMatch;
    const monster = db.monsters.find((item) => item.id === monsterId && !item.deletedAt);
    if (!monster) {
      sendJson(res, 404, { error: "找不到这个怪物。" });
      return;
    }

    if (req.method === "PUT" && !action) {
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      const respawnMinutes = Number(body.respawnMinutes);
      const killedAt = body.killedAt === null || body.killedAt === undefined || body.killedAt === ""
        ? null
        : new Date(body.killedAt);
      if (name.length < 1 || name.length > 30) {
        sendJson(res, 400, { error: "怪物名需要 1 到 30 个字符。" });
        return;
      }
      if (!Number.isFinite(respawnMinutes) || respawnMinutes < 1 || respawnMinutes > 1440 * 30) {
        sendJson(res, 400, { error: "刷新间隔需要在 1 分钟到 30 天之间。" });
        return;
      }
      if (killedAt && Number.isNaN(killedAt.getTime())) {
        sendJson(res, 400, { error: "击杀时间不正确。" });
        return;
      }
      monster.name = name;
      monster.respawnMinutes = Math.round(respawnMinutes);
      monster.updatedAt = nowIso();
      monster.updatedBy = user.id;
      if (killedAt) {
        const latest = latestKillEvent(monster.id);
        if (latest) {
          latest.killedAt = killedAt.toISOString();
          latest.killerId = user.id;
          latest.updatedAt = nowIso();
          latest.updatedBy = user.id;
          latest.note = "manual-edit";
        } else {
          db.killEvents.push({
            id: newId("evt"),
            monsterId: monster.id,
            killerId: user.id,
            killedAt: killedAt.toISOString(),
            createdAt: nowIso(),
            note: "manual-edit",
          });
        }
      }
      await saveDb();
      broadcastState();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "DELETE" && !action) {
      if (!isAdmin(user)) {
        sendJson(res, 403, { error: "只有管理员可以删除怪物。" });
        return;
      }
      monster.deletedAt = nowIso();
      monster.deletedBy = user.id;
      await saveDb();
      broadcastState();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && action === "kill") {
      db.killEvents.push({
        id: newId("evt"),
        monsterId: monster.id,
        killerId: user.id,
        killedAt: nowIso(),
        createdAt: nowIso(),
      });
      await saveDb();
      broadcastState();
      sendJson(res, 201, { ok: true });
      return;
    }

    if (req.method === "POST" && action === "shift") {
      const body = await readBody(req);
      const direction = body.direction === "next" ? 1 : body.direction === "previous" ? -1 : 0;
      if (!direction) {
        sendJson(res, 400, { error: "调整方向不正确。" });
        return;
      }
      const latest = latestKillEvent(monster.id);
      const baseTime = latest ? new Date(latest.killedAt) : new Date();
      const shifted = new Date(baseTime.getTime() + direction * monster.respawnMinutes * 60_000);
      db.killEvents.push({
        id: newId("evt"),
        monsterId: monster.id,
        killerId: user.id,
        killedAt: shifted.toISOString(),
        createdAt: nowIso(),
        note: direction === 1 ? "shift-next" : "shift-previous",
      });
      await saveDb();
      broadcastState();
      sendJson(res, 201, { ok: true });
      return;
    }
  }

  sendJson(res, 404, { error: "接口不存在。" });
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path
    .normalize(decodeURIComponent(requestUrl.pathname))
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath === "/" ? "index.html" : safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const stat = await fs.stat(filePath);
    const finalPath = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const ext = path.extname(finalPath).toLowerCase();
    const content = await fs.readFile(finalPath);
    res.writeHead(200, { "content-type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "服务器错误。" });
  }
});

ensureDb().then(() => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Monster Timer running at http://localhost:${PORT}`);
  });
});
