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
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    salt: row.salt,
    passwordHash: row.password_hash,
    isAdmin: row.is_admin,
    adminSince: row.admin_since,
    createdAt: row.created_at,
  };
}

function fromUser(user) {
  return {
    id: user.id,
    username: user.username,
    salt: user.salt,
    password_hash: user.passwordHash,
    is_admin: Boolean(user.isAdmin),
    admin_since: user.adminSince || null,
    created_at: user.createdAt,
  };
}

function toSession(row) {
  if (!row) return null;
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

function fromSession(token, session) {
  return {
    token,
    user_id: session.userId,
    created_at: session.createdAt,
  };
}

function toMonster(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    respawnMinutes: row.respawn_minutes,
    order: row.order_value,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
  };
}

function fromMonster(monster) {
  return {
    id: monster.id,
    name: monster.name,
    respawn_minutes: monster.respawnMinutes,
    order_value: monster.order,
    created_at: monster.createdAt,
    created_by: monster.createdBy,
    updated_at: monster.updatedAt || null,
    updated_by: monster.updatedBy || null,
    deleted_at: monster.deletedAt || null,
    deleted_by: monster.deletedBy || null,
  };
}

function toKillEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    monsterId: row.monster_id,
    killerId: row.killer_id,
    killedAt: row.killed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    note: row.note,
  };
}

function fromKillEvent(event) {
  return {
    id: event.id,
    monster_id: event.monsterId,
    killer_id: event.killerId,
    killed_at: event.killedAt,
    created_at: event.createdAt,
    updated_at: event.updatedAt || null,
    updated_by: event.updatedBy || null,
    note: event.note || null,
  };
}

async function supabaseRequest(table, params = {}, options = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${table} ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function ensureDb() {
  if (USE_SUPABASE) {
    const users = await storage.allUsers();
    if (users.length > 0 && !users.some((user) => user.isAdmin)) {
      const firstUser = users.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
      firstUser.isAdmin = true;
      firstUser.adminSince = nowIso();
      await storage.updateUser(firstUser);
    }
    return;
  }

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
  if (USE_SUPABASE) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

const storage = {
  async allUsers() {
    if (USE_SUPABASE) {
      const rows = await supabaseRequest("users", { select: "*" });
      return rows.map(toUser);
    }
    return db.users;
  },

  async findUserById(id) {
    if (USE_SUPABASE) {
      const rows = await supabaseRequest("users", { select: "*", id: `eq.${id}`, limit: "1" });
      return toUser(rows[0]);
    }
    return db.users.find((user) => user.id === id) || null;
  },

  async findUserByUsername(username) {
    if (USE_SUPABASE) {
      const rows = await supabaseRequest("users", { select: "*", username: `ilike.${username}`, limit: "1" });
      return toUser(rows[0]);
    }
    return db.users.find((user) => user.username.toLowerCase() === username.toLowerCase()) || null;
  },

  async createUser(user) {
    if (USE_SUPABASE) {
      await supabaseRequest("users", {}, {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: fromUser(user),
      });
      return;
    }
    db.users.push(user);
    await saveDb();
  },

  async updateUser(user) {
    if (USE_SUPABASE) {
      await supabaseRequest("users", { id: `eq.${user.id}` }, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: fromUser(user),
      });
      return;
    }
    const index = db.users.findIndex((item) => item.id === user.id);
    if (index >= 0) db.users[index] = user;
    await saveDb();
  },

  async userCount() {
    const users = await this.allUsers();
    return users.length;
  },

  async createSession(token, session) {
    if (USE_SUPABASE) {
      await supabaseRequest("sessions", {}, {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: fromSession(token, session),
      });
      return;
    }
    db.sessions[token] = session;
    await saveDb();
  },

  async getSession(token) {
    if (USE_SUPABASE) {
      const rows = await supabaseRequest("sessions", { select: "*", token: `eq.${token}`, limit: "1" });
      return toSession(rows[0]);
    }
    return db.sessions[token] || null;
  },

  async deleteSession(token) {
    if (USE_SUPABASE) {
      await supabaseRequest("sessions", { token: `eq.${token}` }, { method: "DELETE" });
      return;
    }
    delete db.sessions[token];
    await saveDb();
  },

  async allMonsters() {
    if (USE_SUPABASE) {
      const rows = await supabaseRequest("monsters", { select: "*" });
      return rows.map(toMonster);
    }
    return db.monsters;
  },

  async findMonster(id) {
    const monsters = await this.allMonsters();
    return monsters.find((monster) => monster.id === id && !monster.deletedAt) || null;
  },

  async createMonster(monster) {
    if (USE_SUPABASE) {
      await supabaseRequest("monsters", {}, {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: fromMonster(monster),
      });
      return;
    }
    db.monsters.push(monster);
    await saveDb();
  },

  async updateMonster(monster) {
    if (USE_SUPABASE) {
      await supabaseRequest("monsters", { id: `eq.${monster.id}` }, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: fromMonster(monster),
      });
      return;
    }
    const index = db.monsters.findIndex((item) => item.id === monster.id);
    if (index >= 0) db.monsters[index] = monster;
    await saveDb();
  },

  async allKillEvents() {
    if (USE_SUPABASE) {
      const rows = await supabaseRequest("kill_events", { select: "*" });
      return rows.map(toKillEvent);
    }
    return db.killEvents;
  },

  async latestKillEvent(monsterId) {
    if (USE_SUPABASE) {
      const rows = await supabaseRequest("kill_events", {
        select: "*",
        monster_id: `eq.${monsterId}`,
        order: "killed_at.desc",
        limit: "1",
      });
      return toKillEvent(rows[0]);
    }
    return db.killEvents
      .filter((event) => event.monsterId === monsterId)
      .sort((a, b) => new Date(b.killedAt) - new Date(a.killedAt))[0] || null;
  },

  async createKillEvent(event) {
    if (USE_SUPABASE) {
      await supabaseRequest("kill_events", {}, {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: fromKillEvent(event),
      });
      return;
    }
    db.killEvents.push(event);
    await saveDb();
  },

  async updateKillEvent(event) {
    if (USE_SUPABASE) {
      await supabaseRequest("kill_events", { id: `eq.${event.id}` }, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: fromKillEvent(event),
      });
      return;
    }
    const index = db.killEvents.findIndex((item) => item.id === event.id);
    if (index >= 0) db.killEvents[index] = event;
    await saveDb();
  },
};

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

async function getSession(req) {
  const token = parseCookies(req).mt_session;
  if (!token) return null;
  const session = await storage.getSession(token);
  if (!session) return null;
  const user = await storage.findUserById(session.userId);
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

async function latestKillEvent(monsterId) {
  return storage.latestKillEvent(monsterId);
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

async function publicState() {
  const users = await storage.allUsers();
  const monsters = await storage.allMonsters();
  const killEvents = await storage.allKillEvents();
  const usersById = new Map(users.map((user) => [user.id, user.username]));
  const eventsByMonster = new Map();
  for (const event of killEvents) {
    if (!eventsByMonster.has(event.monsterId)) eventsByMonster.set(event.monsterId, []);
    eventsByMonster.get(event.monsterId).push(event);
  }

  return {
    serverTime: nowIso(),
    monsters: monsters
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

async function broadcastState() {
  const message = `event: state\ndata: ${JSON.stringify(await publicState())}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

async function requireUser(req, res) {
  const session = await getSession(req);
  if (!session) {
    sendJson(res, 401, { error: "请先登录。" });
    return null;
  }
  return session.user;
}

async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (!isAdmin(user)) {
    sendJson(res, 403, { error: "只有管理员可以操作。" });
    return null;
  }
  return user;
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
    const session = await getSession(req);
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
    if (await storage.findUserByUsername(username)) {
      sendJson(res, 409, { error: "这个用户名已经被注册。" });
      return;
    }
    const { salt, hash } = hashPassword(password);
    const user = {
      id: newId("usr"),
      username,
      salt,
      passwordHash: hash,
      isAdmin: (await storage.userCount()) === 0,
      createdAt: nowIso(),
    };
    const token = newId("ses");
    await storage.createUser(user);
    await storage.createSession(token, { userId: user.id, createdAt: nowIso() });
    res.setHeader("set-cookie", `mt_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    sendJson(res, 201, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && req.url === "/api/login") {
    const body = await readBody(req);
    const username = cleanUsername(body.username);
    const password = String(body.password || "");
    const user = await storage.findUserByUsername(username);
    if (!user || !verifyPassword(password, user)) {
      sendJson(res, 401, { error: "用户名或密码不正确。" });
      return;
    }
    const token = newId("ses");
    await storage.createSession(token, { userId: user.id, createdAt: nowIso() });
    res.setHeader("set-cookie", `mt_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && req.url === "/api/logout") {
    const session = await getSession(req);
    if (session) {
      await storage.deleteSession(session.token);
    }
    res.setHeader("set-cookie", "mt_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/api/admin/users") {
    if (!(await requireAdmin(req, res))) return;
    const users = await storage.allUsers();
    sendJson(res, 200, {
      users: users
        .map((user) => ({
          id: user.id,
          username: user.username,
          isAdmin: isAdmin(user),
          createdAt: user.createdAt,
        }))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    });
    return;
  }

  const adminPasswordMatch = req.url.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
  if (req.method === "POST" && adminPasswordMatch) {
    if (!(await requireAdmin(req, res))) return;
    const [, userId] = adminPasswordMatch;
    const body = await readBody(req);
    const password = String(body.password || "");
    if (password.length < 6) {
      sendJson(res, 400, { error: "密码至少 6 位。" });
      return;
    }
    const user = await storage.findUserById(userId);
    if (!user) {
      sendJson(res, 404, { error: "找不到这个用户。" });
      return;
    }
    const { salt, hash } = hashPassword(password);
    user.salt = salt;
    user.passwordHash = hash;
    await storage.updateUser(user);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/api/state") {
    if (!(await requireUser(req, res))) return;
    sendJson(res, 200, await publicState());
    return;
  }

  if (req.method === "GET" && req.url === "/api/events") {
    if (!(await requireUser(req, res))) return;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`event: state\ndata: ${JSON.stringify(await publicState())}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "POST" && req.url === "/api/monsters") {
    const user = await requireUser(req, res);
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
    await storage.createMonster({
      id: newId("mon"),
      name,
      respawnMinutes: Math.round(respawnMinutes),
      order: Date.now(),
      createdAt: nowIso(),
      createdBy: user.id,
    });
    await broadcastState();
    sendJson(res, 201, { ok: true });
    return;
  }

  const monsterMatch = req.url.match(/^\/api\/monsters\/([^/]+)(?:\/([^/]+))?$/);
  if (monsterMatch) {
    const user = await requireUser(req, res);
    if (!user) return;
    const [, monsterId, action] = monsterMatch;
    const monster = await storage.findMonster(monsterId);
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
        const latest = await latestKillEvent(monster.id);
        if (latest) {
          latest.killedAt = killedAt.toISOString();
          latest.killerId = user.id;
          latest.updatedAt = nowIso();
          latest.updatedBy = user.id;
          latest.note = "manual-edit";
          await storage.updateKillEvent(latest);
        } else {
          await storage.createKillEvent({
            id: newId("evt"),
            monsterId: monster.id,
            killerId: user.id,
            killedAt: killedAt.toISOString(),
            createdAt: nowIso(),
            note: "manual-edit",
          });
        }
      }
      await storage.updateMonster(monster);
      await broadcastState();
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
      await storage.updateMonster(monster);
      await broadcastState();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && action === "kill") {
      const latest = await latestKillEvent(monster.id);
      const killedAt = nowIso();
      if (latest) {
        latest.killedAt = killedAt;
        latest.killerId = user.id;
        latest.updatedAt = killedAt;
        latest.updatedBy = user.id;
        latest.note = "kill-overwrite";
        await storage.updateKillEvent(latest);
      } else {
        await storage.createKillEvent({
          id: newId("evt"),
          monsterId: monster.id,
          killerId: user.id,
          killedAt,
          createdAt: killedAt,
        });
      }
      await broadcastState();
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
