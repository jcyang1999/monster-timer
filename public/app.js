const state = {
  user: null,
  monsters: [],
  serverOffsetMs: 0,
  eventSource: null,
  tickTimer: null,
};

const authView = document.querySelector("#authView");
const mainView = document.querySelector("#mainView");
const authForm = document.querySelector("#authForm");
const authError = document.querySelector("#authError");
const registerButton = document.querySelector("#registerButton");
const logoutButton = document.querySelector("#logoutButton");
const userAdminButton = document.querySelector("#userAdminButton");
const currentUser = document.querySelector("#currentUser");
const syncStatus = document.querySelector("#syncStatus");
const addMonsterForm = document.querySelector("#addMonsterForm");
const monsterRows = document.querySelector("#monsterRows");
const emptyState = document.querySelector("#emptyState");
const editDialog = document.querySelector("#editDialog");
const editForm = document.querySelector("#editForm");
const cancelEditButton = document.querySelector("#cancelEditButton");
const userAdminDialog = document.querySelector("#userAdminDialog");
const userAdminRows = document.querySelector("#userAdminRows");
const closeUserAdminButton = document.querySelector("#closeUserAdminButton");

function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  return fetch(path, { ...options, headers }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "请求失败");
    return payload;
  });
}

function formatClock(value) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseDatetimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatInterval(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours}.0h`;
  if (hours === 0) return `${rest}m`;
  return `${hours}h${rest}m`;
}

function formatCountdown(ms) {
  if (ms <= 0) return "已刷新";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
  return `${minutes}m${seconds}s`;
}

function getNow() {
  return new Date(Date.now() + state.serverOffsetMs);
}

function calculateTimes(monster) {
  if (!monster.latestKill) {
    return { killedAt: null, nextAt: null, countdownMs: null, previousAt: null };
  }
  const killedAt = new Date(monster.latestKill.killedAt);
  const nextAt = new Date(killedAt.getTime() + monster.respawnMinutes * 60_000);
  const previousAt = new Date(killedAt.getTime() - monster.respawnMinutes * 60_000);
  return {
    killedAt,
    nextAt,
    previousAt,
    countdownMs: nextAt.getTime() - getNow().getTime(),
  };
}

function renderRows() {
  monsterRows.innerHTML = "";
  emptyState.hidden = state.monsters.length !== 0;
  for (const monster of state.monsters) {
    const times = calculateTimes(monster);
    const tr = document.createElement("tr");
    const statusClass = times.countdownMs === null ? "" : times.countdownMs <= 0 ? "ready" : times.countdownMs <= 10 * 60_000 ? "soon" : "";
    const deleteButton = state.user?.isAdmin
      ? '<button type="button" class="danger" data-action="delete">删除</button>'
      : "";
    tr.innerHTML = `
      <td class="monster-name"></td>
      <td class="time-cell">
        <span class="time-label">上次</span>
        <span class="time-value">${formatClock(times.previousAt)}</span>
      </td>
      <td class="time-cell">
        <span class="time-label">击杀</span>
        <span class="time-value">${formatClock(times.killedAt)}</span>
      </td>
      <td class="time-cell next-col ${statusClass}">
        <span class="time-label">下次</span>
        <span class="time-value">${formatClock(times.nextAt)}</span>
        <span class="countdown">${times.countdownMs === null ? "未记录" : formatCountdown(times.countdownMs)}</span>
      </td>
      <td class="interval">${formatInterval(monster.respawnMinutes)}</td>
      <td class="killer">${monster.latestKill ? monster.latestKill.killerName : "-"}</td>
      <td class="actions">
        <button type="button" class="primary" data-action="kill">击杀</button>
        <button type="button" data-action="edit">编辑</button>
        ${deleteButton}
      </td>
    `;
    tr.querySelector(".monster-name").textContent = monster.name;
    tr.querySelector(".actions").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      handleMonsterAction(button.dataset.action, monster);
    });
    monsterRows.appendChild(tr);
  }
}

function updateCountdowns() {
  for (const row of monsterRows.querySelectorAll("tr")) {
    const monster = state.monsters[[...monsterRows.children].indexOf(row)];
    if (!monster) continue;
    const times = calculateTimes(monster);
    const nextCell = row.querySelector(".next-col");
    const countdown = row.querySelector(".countdown");
    nextCell.classList.toggle("ready", times.countdownMs !== null && times.countdownMs <= 0);
    nextCell.classList.toggle("soon", times.countdownMs !== null && times.countdownMs > 0 && times.countdownMs <= 10 * 60_000);
    countdown.textContent = times.countdownMs === null ? "未记录" : formatCountdown(times.countdownMs);
  }
}

async function handleMonsterAction(action, monster) {
  try {
    if (action === "kill") {
      await api(`/api/monsters/${monster.id}/kill`, { method: "POST" });
      return;
    }
    if (action === "edit") {
      document.querySelector("#editId").value = monster.id;
      document.querySelector("#editName").value = monster.name;
      document.querySelector("#editRespawn").value = monster.respawnMinutes;
      document.querySelector("#editKilledAt").value = formatDatetimeLocal(monster.latestKill?.killedAt);
      editDialog.showModal();
      return;
    }
    if (action === "delete") {
      if (!confirm(`删除「${monster.name}」？`)) return;
      await api(`/api/monsters/${monster.id}`, { method: "DELETE" });
    }
  } catch (error) {
    alert(error.message);
  }
}

function showMain() {
  authView.hidden = true;
  mainView.hidden = false;
  currentUser.textContent = state.user ? `当前：${state.user.username}${state.user.isAdmin ? "（管理员）" : ""}` : "";
  userAdminButton.hidden = !state.user?.isAdmin;
  startRealtime();
}

function showAuth() {
  authView.hidden = false;
  mainView.hidden = true;
  currentUser.textContent = "";
  userAdminButton.hidden = true;
  stopRealtime();
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

async function openUserAdmin() {
  try {
    userAdminRows.textContent = "正在加载...";
    userAdminDialog.showModal();
    const payload = await api("/api/admin/users");
    userAdminRows.innerHTML = "";
    for (const user of payload.users) {
      const row = document.createElement("div");
      row.className = "user-admin-row";
      row.innerHTML = `
        <div class="user-admin-name">
          <strong></strong>
          <span></span>
        </div>
        <input type="password" minlength="6" placeholder="新密码" />
        <button type="button">重置</button>
      `;
      row.querySelector("strong").textContent = `${user.username}${user.isAdmin ? "（管理员）" : ""}`;
      row.querySelector("span").textContent = `注册：${formatDate(user.createdAt)}`;
      const input = row.querySelector("input");
      row.querySelector("button").addEventListener("click", async () => {
        if (input.value.length < 6) {
          alert("新密码至少 6 位。");
          return;
        }
        await api(`/api/admin/users/${user.id}/password`, {
          method: "POST",
          body: JSON.stringify({ password: input.value }),
        });
        input.value = "";
        alert("密码已重置。");
      });
      userAdminRows.appendChild(row);
    }
    if (payload.users.length === 0) {
      userAdminRows.textContent = "暂无用户。";
    }
  } catch (error) {
    alert(error.message);
    userAdminDialog.close();
  }
}

function startRealtime() {
  stopRealtime();
  syncStatus.textContent = "正在同步...";
  state.eventSource = new EventSource("/api/events");
  state.eventSource.addEventListener("state", (event) => {
    const payload = JSON.parse(event.data);
    state.serverOffsetMs = new Date(payload.serverTime).getTime() - Date.now();
    state.monsters = payload.monsters;
    syncStatus.textContent = `已同步 ${formatClock(payload.serverTime)}`;
    renderRows();
  });
  state.eventSource.onerror = () => {
    syncStatus.textContent = "连接断开，正在重连...";
  };
  state.tickTimer = setInterval(updateCountdowns, 1000);
}

function stopRealtime() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = null;
  if (state.tickTimer) clearInterval(state.tickTimer);
  state.tickTimer = null;
}

async function init() {
  try {
    const payload = await api("/api/me");
    state.user = payload.user;
    if (state.user) showMain();
    else showAuth();
  } catch {
    showAuth();
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  const form = new FormData(authForm);
  try {
    const payload = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    state.user = payload.user;
    showMain();
  } catch (error) {
    authError.textContent = error.message;
  }
});

registerButton.addEventListener("click", async () => {
  authError.textContent = "";
  const form = new FormData(authForm);
  try {
    const payload = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    state.user = payload.user;
    showMain();
  } catch (error) {
    authError.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  state.user = null;
  showAuth();
});

userAdminButton.addEventListener("click", openUserAdmin);
closeUserAdminButton.addEventListener("click", () => userAdminDialog.close());

addMonsterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(addMonsterForm);
  const hours = Number(form.get("hours") || 0);
  const minutes = Number(form.get("minutes") || 0);
  const respawnMinutes = hours * 60 + minutes;
  try {
    await api("/api/monsters", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        respawnMinutes,
      }),
    });
    document.querySelector("#monsterName").value = "";
  } catch (error) {
    alert(error.message);
  }
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.querySelector("#editId").value;
  try {
    await api(`/api/monsters/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: document.querySelector("#editName").value,
        respawnMinutes: Number(document.querySelector("#editRespawn").value),
        killedAt: parseDatetimeLocal(document.querySelector("#editKilledAt").value),
      }),
    });
    editDialog.close();
  } catch (error) {
    alert(error.message);
  }
});

cancelEditButton.addEventListener("click", () => editDialog.close());

init();
