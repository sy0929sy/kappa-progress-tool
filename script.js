import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  linkWithCredential,
  EmailAuthProvider,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAjJNXRafptuRTtZfhhE_Py34FkJX4KAys",
  authDomain: "tarkovmanagementtool-b9b53.firebaseapp.com",
  projectId: "tarkovmanagementtool-b9b53",
};

// Helper to generate Wiki URL for items
function getItemWikiUrl(itemName) {
  const mapEntry = ITEM_MAP[itemName];

  if (wikiLang === "en") {
    // English: Direct link to Fandom Wiki
    const baseName = mapEntry?.uri ?? itemName;

    const slug = decodeURIComponent(baseName)
      .replace(/\s+/g, "_");

    return `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(slug)}`;

  } else {
    // Japanese: Map entry direct link or search on Wikiwiki
    if (mapEntry?.uri) {
      return `https://wikiwiki.jp/eft/${mapEntry.uri}`;
    }
    return `https://wikiwiki.jp/eft/?cmd=search&word=${encodeURIComponent(itemName)}`;
  }
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let TASKS = [];
let LK_TASKS = [];
let ITEM_MAP = {};
let HIDEOUT_DATA = {};
let userData = { tasks: {}, hideout: {}, favorites: {}, traders: {} };
let itemProgress = {};
let uid = "";
let wikiLang = "jp";
let currentTheme = "light";
let hideCompleted = true;
let hideoutFirOnly = false;
let hideoutNextOnly = false; // 次レベルのみ表示するかどうか
const TRADERS = ["Prapor", "Therapist", "Fence", "Skier", "Peacekeeper", "Mechanic", "Ragman", "Jaeger"];
let activeTraders = [...TRADERS];

async function init() {
  try {
    const [resTasks, resLKTasks, resHideout, resItemMap] = await Promise.all([
      fetch("./tasks_kappa.json"),
      fetch("./tasks_lightkeeper.json"),
      fetch("./hideout_data.json"),
      fetch("./item_map.json")
    ]);
    TASKS = await resTasks.json();
    LK_TASKS = await resLKTasks.json();
    HIDEOUT_DATA = await resHideout.json();
    ITEM_MAP = await resItemMap.json();

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        uid = user.uid;
        updateAuthUI(user);

        const userRef = doc(db, "users", uid);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
          const data = userDoc.data();
          userData.tasks = data.tasks || {};
          userData.hideout = data.hideout || {};
          userData.traders = data.traders || {};
          itemProgress = data.itemProgress || {};
          wikiLang = data.wikiLang || "jp";
          currentTheme = data.theme || "light";
          updateWikiLangUI();
          applyTheme(currentTheme);
        } else {
          // New user or no data
          applyTheme(currentTheme);
          await setDoc(userRef, { tasks: {}, hideout: {}, traders: {}, itemProgress: {}, createdAt: new Date(), theme: currentTheme });
        }
        setupTraderFilters();
        refreshUI();
      } else {
        await signInAnonymously(auth);
      }
    });

    setupEventListeners();
  } catch (e) {
    console.error("Init Error:", e);
  }
}

function updateAuthUI(user) {
  const statusBadge = document.querySelector(".status-badge");
  const authMsg = document.querySelector(".auth-msg");
  const unauthFields = document.getElementById("unauthFields");
  const authFields = document.getElementById("authFields");
  const userDisplay = document.getElementById("userEmailDisplay");

  if (user.isAnonymous) {
    statusBadge.textContent = "一時保存中";
    statusBadge.className = "status-badge anon";
    authMsg.style.display = "block";
    unauthFields.style.display = "block";
    authFields.style.display = "none";
  } else {
    statusBadge.textContent = "同期済み";
    statusBadge.className = "status-badge linked";
    authMsg.style.display = "none";
    unauthFields.style.display = "none";
    authFields.style.display = "block";
    userDisplay.textContent = user.email;
  }
}

// アイテム更新 (連動・ソート対応)
window.updateItemCount = async (name, delta) => {
  let current = itemProgress[name] || 0;
  if (delta === null) {
    // セレクタにシングルクォートが含まれても動くように修正
    const input = document.querySelector(`input[data-item-name="${name.replace(/"/g, '\\"')}"]`);
    current = Math.max(0, parseInt(input.value) || 0);
  } else {
    current = Math.max(0, current + delta);
  }

  itemProgress[name] = current;

  // updateDoc でオブジェクト全体を渡す（ドット記法エラーを回避）
  try {
    const userRef = doc(db, "users", uid);
    await updateDoc(userRef, {
      itemProgress: { ...itemProgress }
    });
    refreshUI();
  } catch (error) {
    console.error("Save error:", error);
  }
};

function renderRequiredItems(tasks, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  const itemSummary = {};
  tasks.forEach(task => {
    // コンテナに応じて表示対象（Kappa/灯台）をフィルタリング
    const isKappaReq = containerId === 'requiredItemsList' && task.kappaRequired;
    const isLKReq = containerId === 'lkRequiredItemsList' && task.LightkeeperRequired;

    if ((isKappaReq || isLKReq) && !userData.tasks[task.id] && task.requiredItems) {
      task.requiredItems.forEach(item => {
        if (!itemSummary[item.name]) {
          itemSummary[item.name] = { total: 0, tasks: [] };
        }
        itemSummary[item.name].total += item.count;
        itemSummary[item.name].tasks.push({
          taskName: task.name,
          trader: task.trader,
          count: item.count
        });
      });
    }
  });

  // お気に入り(最優先) > 完了状況(次点) でソート
  const sorted = Object.entries(itemSummary).sort(([nA, dA], [nB, dB]) => {
    const favA = userData.favorites[nA] ? 1 : 0;
    const favB = userData.favorites[nB] ? 1 : 0;
    if (favA !== favB) return favB - favA;
    const doneA = (itemProgress[nA] || 0) >= dA.total;
    const doneB = (itemProgress[nB] || 0) >= dB.total;
    return doneA === doneB ? 0 : doneA ? 1 : -1;
  });

  sorted.forEach(([name, data]) => {
    const current = itemProgress[name] || 0;
    const isDone = current >= data.total;
    const isFav = userData.favorites[name];
    const card = document.createElement("div");
    const escapedName = name.replace(/'/g, "\\'");
    card.className = `task-card ${isDone ? 'item-done' : ''}`;

    // タスク詳細リストを生成
    const taskDetailsHtml = data.tasks.map(t =>
      `<div class="task-detail-item"><span class="trader-label">[${t.trader}]</span> ${t.taskName}: ${t.count}個</div>`
    ).join('');

    card.innerHTML = `
      <div style="display:flex; align-items:flex-start; gap: 10px;">
        <span class="fav-btn ${isFav ? 'active' : ''}" onclick="window.toggleFavorite('${name}')">${isFav ? '★' : '☆'}</span>
        <div class="item-info" style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;">
            <span><a href="${getItemWikiUrl(name)}" target="_blank" class="wiki-link">${name}</a></span>
            <div class="item-target">必要: ${data.total}</div>
          </div>
          <div class="task-details-list">
            ${taskDetailsHtml}
          </div>
        </div>
      </div>
      <div class="counter-group">
        <button class="count-btn minus" onclick="window.updateItemCount('${escapedName}', -1)">-</button>
        <input type="text" class="count-input" data-item-name="${name}" value="${current}" 
          oninput="this.value = this.value.replace(/[^0-9]/g, '')" 
          onchange="window.updateItemCount('${name}', null)">
        <button class="count-btn plus" onclick="window.updateItemCount('${escapedName}', 1)">+</button>
      </div>`;
    container.appendChild(card);
  });
}

function arePrerequisitesMet(requirements) {
  if (!requirements) return true;
  for (const r of requirements) {
    if (r.type === "pre_facility") {
      const currentLevel = userData.hideout[r.name] || 0;
      if (currentLevel < r.level) return false;
    } else if (r.type === "pre_trader") {
      const currentLevel = userData.traders[r.name] || 1;
      if (currentLevel < r.level) return false;
    }
    // pre_skill は現状追跡していないためスキップ
  }
  return true;
}

function renderHideout() {
  const container = document.getElementById("hideoutList");
  if (!container) return;
  container.innerHTML = "";
  let totalCounts = {};
  Object.entries(HIDEOUT_DATA).forEach(([station, data]) => {
    const currentLevel = userData.hideout[station] || 0;
    const nextLevel = currentLevel + 1;
    const hasNext = nextLevel <= data.max;
    let reqContent = hasNext ? `<span class="req-title">Lv.${nextLevel}への必要条件:</span><ul class="req-item-list">` : `<div class="max-level-text">最大レベルです</div>`;
    if (hasNext) {
      (data.requirements[nextLevel] || []).forEach(r => {
        if (r.type) {
          const lbl = r.type === "pre_facility" ? "前提" : r.type === "pre_trader" ? "信頼" : "スキル";
          reqContent += `<li>・【${lbl}】${r.name} Lv.${r.level}</li>`;
        } else {
          // Item requirement
          reqContent += `<li>・<a href="${getItemWikiUrl(r.name)}" target="_blank" class="wiki-link">${r.name}</a> x${r.count.toLocaleString()}${r.fir ? ' <span class="fir-badge">(FIR)</span>' : ''}</li>`;
        }
      });
      reqContent += `</ul>`;
    }
    const card = document.createElement("div");
    card.className = "task-card hideout-card";
    card.innerHTML = `
      <div class="hideout-info-main"><h4>${station}</h4>
        <select class="level-select" onchange="window.updateStationLevel('${station}', this.value)">
          ${Array.from({ length: data.max + 1 }, (_, i) => `<option value="${i}" ${currentLevel === i ? 'selected' : ''}>Lv.${i}</option>`).join("")}
        </select>
      </div>
      <div class="req-area">${reqContent}</div>`;
    container.appendChild(card);

    // hideoutNextOnlyがtrueの場合は次レベルのみ、falseの場合は全レベル
    const startLevel = nextLevel;
    const endLevel = hideoutNextOnly ? nextLevel : data.max;

    for (let lv = startLevel; lv <= endLevel; lv++) {
      // 次レベルのみ表示かつ前提条件が未達成の場合はスキップ
      if (hideoutNextOnly && lv === nextLevel && !arePrerequisitesMet(data.requirements[lv])) {
        continue;
      }

      (data.requirements[lv] || []).forEach(r => {
        if (!r.type && (!hideoutFirOnly || r.fir)) {
          if (!totalCounts[r.name]) {
            totalCounts[r.name] = { total: 0, fir: r.fir, facilities: [] };
          }
          totalCounts[r.name].total += r.count;
          totalCounts[r.name].facilities.push({
            station: station,
            level: lv,
            count: r.count
          });
        }
      });
    }
  });
  renderHideoutTotal(totalCounts);
}

function renderHideoutTotal(totalCounts) {
  const container = document.getElementById("hideoutTotalItems");
  if (!container) return;

  const sorted = Object.entries(totalCounts).sort(([nA, dA], [nB, dB]) => {
    const favA = userData.favorites[nA] ? 1 : 0;
    const favB = userData.favorites[nB] ? 1 : 0;
    if (favA !== favB) return favB - favA;
    const doneA = (itemProgress[nA] || 0) >= dA.total;
    const doneB = (itemProgress[nB] || 0) >= dB.total;
    return doneA === doneB ? 0 : doneA ? 1 : -1;
  });

  container.innerHTML = sorted.map(([name, data]) => {
    const current = itemProgress[name] || 0;
    const isDone = current >= data.total;
    const isFav = userData.favorites[name];
    const escapedName = name.replace(/'/g, "\\'");

    // 施設詳細リストを生成
    const facilityDetailsHtml = data.facilities.map(f =>
      `<div class="task-detail-item"><span class="trader-label">[${f.station}]</span> Lv.${f.level}: ${f.count}個</div>`
    ).join('');

    return `
      <div class="task-card ${isDone ? 'item-done' : ''} ${data.fir ? 'fir-item-highlight' : ''}">
        <div style="display:flex; align-items:flex-start; gap: 10px;">
          <span class="fav-btn ${isFav ? 'active' : ''}" onclick="window.toggleFavorite('${name}')">${isFav ? '★' : '☆'}</span>
          <div class="item-info" style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;">
              <span><a href="${getItemWikiUrl(name)}" target="_blank" class="wiki-link">${name}</a> ${data.fir ? '<span class="fir-badge">FIR</span>' : ''}</span>
              <div class="item-target">必要: ${data.total}</div>
            </div>
            <div class="task-details-list">
              ${facilityDetailsHtml}
            </div>
          </div>
        </div>
        <div class="counter-group">
          <button class="count-btn minus" onclick="window.updateItemCount('${escapedName}', -1)">-</button>
          <input type="text" class="count-input" data-item-name="${name}" value="${current}" 
            oninput="this.value = this.value.replace(/[^0-9]/g, '')" 
            onchange="window.updateItemCount('${name}', null)">
          <button class="count-btn" onclick="window.updateItemCount('${escapedName}', 1)">+</button>
        </div>
      </div>`;
  }).join("");
}

window.toggleFavorite = async (itemId) => {
  userData.favorites[itemId] = !userData.favorites[itemId];
  await updateDoc(doc(db, "users", uid), { favorites: userData.favorites });
  refreshUI();
};

function renderTasks(tasks, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  const searchText = document.getElementById("searchBox")?.value.toLowerCase() || "";

  const filtered = tasks.filter(t => {
    // コンテナに応じて表示対象（Kappa/灯台）をフィルタリング
    const isKappaReq = containerId === 'taskList' && t.kappaRequired;
    const isLKReq = containerId === 'lkTaskList' && t.LightkeeperRequired;

    return (isKappaReq || isLKReq) &&
      activeTraders.includes(t.trader) &&
      t.name.toLowerCase().includes(searchText) &&
      (!hideCompleted || !userData.tasks[t.id]);
  });

  filtered.forEach(task => {
    const isCompleted = userData.tasks[task.id];

    // 前提タスクの取得と「1つだけ表示」のロジック
    const preTaskIds = task.preRequisites || [];
    const preTaskNames = preTaskIds
      .map(preId => tasks.find(t => t.id === preId)?.name || TASKS.find(t => t.id === preId)?.name || LK_TASKS.find(t => t.id === preId)?.name)
      .filter(Boolean);

    let preTasksDisplay = "";
    if (preTaskNames.length > 0) {
      if (preTaskNames.length > 1) {
        preTasksDisplay = `関連: ${preTaskNames[0]}...他${preTaskNames.length - 1}件`;
      } else {
        preTasksDisplay = `関連: ${preTaskNames[0]}`;
      }
    }

    const levelHtml = (task.requiredLevel && task.requiredLevel > 0)
      ? `<span class="badge level-badge">Lv.${task.requiredLevel}</span>`
      : "";

    const preHtml = preTasksDisplay
      ? `<span class="badge pre-badge clickable-badge" onclick="window.showPrerequisites('${task.id}', '${containerId === 'taskList' ? 'kappa' : 'lk'}')">${preTasksDisplay}</span>`
      : "";

    const itemHtml = (task.requiredItems && task.requiredItems.length > 0)
      ? `<span class="badge item-badge clickable-badge" onclick="window.showRequiredItems('${task.id}', '${containerId === 'taskList' ? 'kappa' : 'lk'}')">納品アイテム</span>`
      : "";

    const keyHtml = (task.requiredKeys && task.requiredKeys.length > 0)
      ? `<span class="badge key-badge clickable-badge" onclick="window.showRequiredKeys('${task.id}', '${containerId === 'taskList' ? 'kappa' : 'lk'}')">鍵必要</span>`
      : "";

    const card = document.createElement("div");
    card.className = `task-card ${isCompleted ? 'completed' : ''}`;

    const traderLower = task.trader.toLowerCase();
    const imagePath = `assets/traders/${traderLower}.png`;

    let wikiUrl = wikiLang === "en"
      ? `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(task.name.replace(/\s+/g, '_'))}`
      : `https://wikiwiki.jp/eft/${task.trader}/${encodeURIComponent(task.name)}`;

    card.innerHTML = `
      <div class="task-info">
        <div class="task-header-flex">
          <div class="trader-icon-badge">
            <img src="${imagePath}" alt="${task.trader}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
            <span style="display:none;">${task.trader.charAt(0)}</span>
          </div>
          
          <div class="task-title-group">
            <div class="trader-name-label">${task.trader.toUpperCase()}</div>
            <div class="task-name">
              <a href="${wikiUrl}" target="_blank" class="wiki-link">${task.name}</a>
            </div>
          </div>
  
          <div class="task-requirements-aside">
            ${levelHtml ? `<div class="req-row">${levelHtml}</div>` : ''}
            ${preHtml ? `<div class="req-row">${preHtml}</div>` : ''}
            ${itemHtml ? `<div class="req-row">${itemHtml}</div>` : ''}
            ${keyHtml ? `<div class="req-row">${keyHtml}</div>` : ''}
          </div>
        </div>
      </div>
      <button class="status-btn ${isCompleted ? 'completed' : ''}" onclick="window.toggleTask('${task.id}', '${containerId === 'taskList' ? 'kappa' : 'lk'}')">
        ${isCompleted ? '<span>✓</span> 完了' : '未完了'}
      </button>`;

    container.appendChild(card);
  });

  updateProgress();
}

// 鍵一覧表示用のモーダル
window.showRequiredKeys = (taskId, type = 'kappa') => {
  const tasks = type === 'kappa' ? TASKS : LK_TASKS;
  const task = tasks.find(t => t.id === taskId);
  if (!task || !task.requiredKeys || task.requiredKeys.length === 0) return;

  const modal = document.getElementById('customModal');
  const title = document.getElementById('modalTitle');
  const message = document.getElementById('modalMessage');
  const taskList = document.getElementById('modalTaskList');
  const confirmBtn = document.getElementById('modalConfirm');
  const cancelBtn = document.getElementById('modalCancel');

  title.textContent = "必要な鍵";
  message.textContent = "タスク完了に必要な鍵：";
  taskList.innerHTML = '';

  task.requiredKeys.forEach(keyName => {
    const li = document.createElement('li');
    li.innerHTML = `<b><a href="${getItemWikiUrl(keyName)}" target="_blank" class="wiki-link">${keyName}</a></b>`;
    taskList.appendChild(li);
  });

  confirmBtn.style.display = 'none';
  cancelBtn.textContent = '閉じる';
  modal.style.display = 'flex';

  const cleanup = () => {
    cancelBtn.removeEventListener('click', handleClose);
    confirmBtn.style.display = '';
    cancelBtn.textContent = 'キャンセル';
    title.textContent = '確認';
    message.textContent = '以下のタスクも一括で完了になります：';
  };

  const handleClose = () => {
    modal.style.display = 'none';
    cleanup();
  };

  cancelBtn.addEventListener('click', handleClose);
};

// 前提タスクをすべて（先祖代々）取得する関数
function getRecursivePreRequisites(taskId, taskList, allPreIds = new Set()) {
  const task = taskList.find(t => t.id === taskId);
  // taskがない、または前提条件が空の場合は現在のSetを返す
  if (!task || !task.preRequisites || task.preRequisites.length === 0) {
    return Array.from(allPreIds);
  }

  for (const preId of task.preRequisites) {
    if (!allPreIds.has(preId)) {
      allPreIds.add(preId);
      // さらに深く掘り下げる
      getRecursivePreRequisites(preId, taskList, allPreIds);
    }
  }
  return Array.from(allPreIds);
}

function showConfirmModal(targetTasks) {
  return new Promise((resolve) => {
    const modal = document.getElementById('customModal');
    const taskList = document.getElementById('modalTaskList');
    const confirmBtn = document.getElementById('modalConfirm');
    const cancelBtn = document.getElementById('modalCancel');

    // リストを生成
    taskList.innerHTML = '';
    targetTasks.forEach(task => {
      const li = document.createElement('li');
      li.innerHTML = `<span style="color:var(--secondary-yellow)">[${task.trader}]</span> ${task.name}`;
      taskList.appendChild(li);
    });

    modal.style.display = 'flex';

    const handleConfirm = () => {
      modal.style.display = 'none';
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      modal.style.display = 'none';
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
  });
}

// 前提タスク一覧表示用のモーダル
window.showPrerequisites = (taskId, type = 'kappa') => {
  const tasks = type === 'kappa' ? TASKS : LK_TASKS;
  const task = tasks.find(t => t.id === taskId);
  if (!task || !task.preRequisites || task.preRequisites.length === 0) return;

  const modal = document.getElementById('customModal');
  const title = document.getElementById('modalTitle');
  const message = document.getElementById('modalMessage');
  const taskList = document.getElementById('modalTaskList');
  const confirmBtn = document.getElementById('modalConfirm');
  const cancelBtn = document.getElementById('modalCancel');

  // モーダルの内容設定
  title.textContent = "関連タスク";
  message.textContent = "このタスクに関連するタスク：";

  taskList.innerHTML = '';
  // 直近の前提タスクを表示
  task.preRequisites.forEach(preId => {
    const preTask = tasks.find(t => t.id === preId) || TASKS.find(t => t.id === preId) || LK_TASKS.find(t => t.id === preId);
    if (preTask) {
      const isDone = userData.tasks[preId];
      const statusIcon = isDone ? '✓' : '未';
      const statusColor = isDone ? 'var(--done-green)' : 'gray';
      const li = document.createElement('li');

      // Network Provider - Part 1 の場合のみステータスアイコンを表示しない
      if (task.id === 'network_provider_part_1') {
        li.innerHTML = `<span style="color:var(--secondary-yellow)">[${preTask.trader}]</span> ${preTask.name}`;
      } else {
        li.innerHTML = `<span style="color:${statusColor}; font-weight:bold; margin-right:5px;">[${statusIcon}]</span> <span style="color:var(--secondary-yellow)">[${preTask.trader}]</span> ${preTask.name}`;
      }
      taskList.appendChild(li);
    }
  });

  // ボタン設定 (確認ボタンを隠し、キャンセルボタンを「閉じる」にする)
  confirmBtn.style.display = 'none';
  cancelBtn.textContent = '閉じる';

  modal.style.display = 'flex';

  const cleanup = () => {
    cancelBtn.removeEventListener('click', handleClose);
    // 状態を戻す
    confirmBtn.style.display = '';
    cancelBtn.textContent = 'キャンセル';
    title.textContent = '確認';
    message.textContent = '以下のタスクも一括で完了になります：';
  };

  const handleClose = () => {
    modal.style.display = 'none';
    cleanup();
  };

  cancelBtn.addEventListener('click', handleClose);
};

// 必要アイテム一覧表示用のモーダル
window.showRequiredItems = (taskId, type = 'kappa') => {
  const tasks = type === 'kappa' ? TASKS : LK_TASKS;
  const task = tasks.find(t => t.id === taskId);
  if (!task || !task.requiredItems || task.requiredItems.length === 0) return;

  const modal = document.getElementById('customModal');
  const title = document.getElementById('modalTitle');
  const message = document.getElementById('modalMessage');
  const taskList = document.getElementById('modalTaskList');
  const confirmBtn = document.getElementById('modalConfirm');
  const cancelBtn = document.getElementById('modalCancel');

  title.textContent = "納品アイテム";
  message.textContent = "タスク完了に必要な納品アイテム：";
  taskList.innerHTML = '';

  task.requiredItems.forEach(item => {
    const current = itemProgress[item.name] || 0;
    const isDone = current >= item.count;
    const statusIcon = isDone ? '✓' : '未';
    const statusColor = isDone ? 'var(--done-green)' : 'gray';
    const firBadge = item.fir ? '<span class="fir-badge">FIR</span>' : '';

    const li = document.createElement('li');
    li.innerHTML = `<span style="color:${statusColor}; font-weight:bold; margin-right:5px;">[${statusIcon}]</span> <b><a href="${getItemWikiUrl(item.name)}" target="_blank" class="wiki-link">${item.name}</a></b> x${item.count}${firBadge} (所持: ${current})`;
    taskList.appendChild(li);
  });

  confirmBtn.style.display = 'none';
  cancelBtn.textContent = '閉じる';
  modal.style.display = 'flex';

  const cleanup = () => {
    cancelBtn.removeEventListener('click', handleClose);
    confirmBtn.style.display = '';
    cancelBtn.textContent = 'キャンセル';
    title.textContent = '確認';
    message.textContent = '以下のタスクも一括で完了になります：';
  };

  const handleClose = () => {
    modal.style.display = 'none';
    cleanup();
  };

  cancelBtn.addEventListener('click', handleClose);
};

// 既存の toggleTask を更新
window.toggleTask = async (taskId, type = 'kappa') => {
  const tasks = type === 'kappa' ? TASKS : LK_TASKS;
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const isNowCompleted = !userData.tasks[taskId];

  // 完了にする場合のみ一括チェックロジックを走らせる
  if (isNowCompleted && taskId !== 'network_provider_part_1') {
    const preIds = getRecursivePreRequisites(taskId, tasks);
    // 未完了の前提タスクのみを抽出
    const incompletePres = preIds.filter(id => !userData.tasks[id]);

    if (incompletePres.length > 0) {
      const targetTaskObjects = incompletePres
        .map(id => tasks.find(t => t.id === id))
        .filter(Boolean);

      // カスタムモーダルを表示（モダンな確認画面）
      const confirmed = await showConfirmModal(targetTaskObjects);

      if (confirmed) {
        incompletePres.forEach(id => {
          userData.tasks[id] = true;
        });
      } else {
        // ユーザーが「キャンセル」を押した場合は、チェックを入れずに終了
        refreshUI(); // 念のため再描画して状態を維持
        return;
      }
    }
  }

  // 本体の状態を更新
  userData.tasks[taskId] = isNowCompleted;

  // アイテムの減算ロジック (完了にした場合のみ)
  if (isNowCompleted && task.requiredItems) {
    task.requiredItems.forEach(item => {
      if (itemProgress[item.name]) {
        itemProgress[item.name] = Math.max(0, itemProgress[item.name] - item.count);
      }
    });
  }

  // Firestoreに保存
  try {
    await updateDoc(doc(db, "users", uid), {
      tasks: { ...userData.tasks },
      itemProgress: { ...itemProgress }
    });
  } catch (error) {
    console.error("Save error:", error);
  }

  // UI更新
  refreshUI();
  updateProgress();
};

window.updateStationLevel = async (station, level) => {
  const oldLevel = userData.hideout[station] || 0;
  const newLevel = parseInt(level);
  userData.hideout[station] = newLevel;

  // レベルが上がった場合のみアイテムを減算
  if (newLevel > oldLevel) {
    const data = HIDEOUT_DATA[station];
    if (data) {
      for (let lv = oldLevel + 1; lv <= newLevel; lv++) {
        const requirements = data.requirements[lv] || [];
        requirements.forEach(r => {
          if (!r.type) { // アイテムのみ
            if (itemProgress[r.name]) {
              itemProgress[r.name] = Math.max(0, itemProgress[r.name] - r.count);
            }
          }
        });
      }
    }
  }

  try {
    const userRef = doc(db, "users", uid);
    await updateDoc(userRef, {
      hideout: { ...userData.hideout },
      itemProgress: { ...itemProgress }
    });
    refreshUI();
    updateProgress();
  } catch (error) {
    console.error("Save error:", error);
  }
};

window.updateTraderLevel = async (trader, level) => {
  userData.traders[trader] = parseInt(level);
  await setDoc(doc(db, "users", uid), { traders: { [trader]: userData.traders[trader] } }, { merge: true });
  refreshUI();
};

function renderTraderLevels() {
  const container = document.getElementById("traderLevelList");
  if (!container) return;
  container.innerHTML = "";

  const targetTraders = TRADERS.filter(t => t !== "Fence");

  targetTraders.forEach(trader => {
    const currentLevel = userData.traders[trader] || 1;
    const card = document.createElement("div");
    card.className = "task-card hideout-card";

    const traderLower = trader.toLowerCase();
    const imagePath = `assets/traders/${traderLower}.png`;

    card.innerHTML = `
      <div class="hideout-info-main" style="flex-direction: row; align-items: center; gap: 15px;">
        <div class="trader-icon-badge" style="width: 40px; height: 40px;">
          <img src="${imagePath}" alt="${trader}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" style="width: 100%; height: 100%; object-fit: contain;">
          <span style="display:none;">${trader.charAt(0)}</span>
        </div>
        <h4 style="margin:0;">${trader}</h4>
      </div>
      <div class="req-area" style="border-left: none; padding-left: 0; display: flex; justify-content: flex-end;">
        <select class="level-select" onchange="window.updateTraderLevel('${trader}', this.value)">
          ${Array.from({ length: 4 }, (_, i) => `<option value="${i + 1}" ${currentLevel === i + 1 ? 'selected' : ''}>Lv.${i + 1}</option>`).join("")}
        </select>
      </div>`;
    container.appendChild(card);
  });
}

function refreshUI() {
  renderTasks(TASKS, "taskList");
  renderRequiredItems(TASKS, "requiredItemsList");
  renderTasks(LK_TASKS, "lkTaskList");
  renderRequiredItems(LK_TASKS, "lkRequiredItemsList");
  renderHideout();
  renderTraderLevels();
}

function updateProgress() {
  const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab;
  let targetTasks = [];
  let title = "Kappa進捗";
  let isHideout = false;

  if (activeTab === "lighthouse-tab") {
    targetTasks = LK_TASKS.filter(t => t.LightkeeperRequired);
    title = "灯台進捗";
  } else if (activeTab === "hideout-tab") {
    isHideout = true;
    title = "Hideout進捗";
  } else {
    // デフォルト（Kappaタブ時はKappaを表示）
    targetTasks = TASKS.filter(t => t.kappaRequired);
    title = "Kappa進捗";
  }

  let done, total, percent;

  if (isHideout) {
    total = Object.values(HIDEOUT_DATA).reduce((sum, d) => sum + d.max, 0);
    done = Object.entries(HIDEOUT_DATA).reduce((sum, [station, d]) => sum + (userData.hideout[station] || 0), 0);
  } else {
    total = targetTasks.length;
    done = targetTasks.filter(task => userData.tasks[task.id]).length;
  }

  percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const titleEl = document.getElementById("progressTitle");
  if (titleEl) titleEl.textContent = title;

  const circle = document.getElementById("progressCircle");
  if (circle) circle.style.strokeDashoffset = 283 - (283 * percent / 100);

  const percentEl = document.getElementById("progressPercent");
  if (percentEl) percentEl.textContent = `${percent}%`;

  const countEl = document.getElementById("progressCount");
  if (countEl) countEl.textContent = isHideout ? `${done} / ${total} Lv` : `${done} / ${total}`;
}

function setupTraderFilters() {
  const container = document.getElementById("traderButtons");
  if (!container) return;
  container.innerHTML = TRADERS.map(t => `<button class="trader-btn ${activeTraders.includes(t) ? 'active' : ''}" data-trader="${t}">${t}</button>`).join("");
  container.querySelectorAll(".trader-btn").forEach(btn => {
    btn.onclick = () => {
      const t = btn.dataset.trader;
      activeTraders = activeTraders.includes(t) ? activeTraders.filter(a => a !== t) : [...activeTraders, t];
      btn.classList.toggle("active");
      refreshUI();
    };
  });
}

function updateWikiLangUI() {
  document.getElementById("wikiLangJP").classList.toggle("active", wikiLang === "jp");
  document.getElementById("wikiLangEN").classList.toggle("active", wikiLang === "en");
}

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggleBtn");
  if (btn) {
    if (theme === "light") {
      btn.innerHTML = '<span>🌙</span> ダークモード';
      btn.title = "ダークモードに切り替え";
    } else {
      btn.innerHTML = '<span>☀️</span> ライトモード';
      btn.title = "ライトモードに切り替え";
    }
  }
}

function setupEventListeners() {
  // アカウント系
  document.getElementById("linkAccountBtn").onclick = async () => {
    const email = document.getElementById("authEmail").value;
    const password = document.getElementById("authPassword").value;
    if (!email || !password) return alert("入力してください");
    try {
      await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password));
      alert("登録完了！");
    } catch (e) { alert("エラー: " + e.message); }
  };

  document.getElementById("loginBtn").onclick = async () => {
    const email = document.getElementById("authEmail").value;
    const password = document.getElementById("authPassword").value;
    try {
      await signInWithEmailAndPassword(auth, email, password);
      alert("ログインしました");
    } catch (e) { alert("ログイン失敗"); }
  };

  document.getElementById("logoutBtn").onclick = () => signOut(auth);

  // Theme Toggle
  document.getElementById("themeToggleBtn").addEventListener("click", async () => {
    currentTheme = currentTheme === "light" ? "dark" : "light";
    applyTheme(currentTheme);
    if (uid) {
      await updateDoc(doc(db, "users", uid), { theme: currentTheme });
    }
  });

  // UI系
  document.getElementById("searchBox")?.addEventListener("input", refreshUI);
  document.getElementById("hideoutFirOnly")?.addEventListener("change", (e) => {
    hideoutFirOnly = e.target.checked;
    renderHideout();
  });
  document.getElementById("hideoutNextOnly")?.addEventListener("change", (e) => {
    hideoutNextOnly = e.target.checked;
    renderHideout();
  });
  document.getElementById("wikiLangJP").onclick = () => { wikiLang = "jp"; updateWikiLangUI(); refreshUI(); };
  document.getElementById("wikiLangEN").onclick = () => { wikiLang = "en"; updateWikiLangUI(); refreshUI(); };
  document.getElementById("toggleCompletedBtn").onclick = (e) => {
    hideCompleted = !hideCompleted;
    e.target.textContent = hideCompleted ? "完了済を非表示中" : "完了済を表示中";
    refreshUI();
  };
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn, .tab-panel").forEach(el => el.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
      updateProgress();
    };
  });
  document.querySelectorAll(".sub-tab-btn").forEach(btn => {
    btn.onclick = () => {
      const parentPanel = btn.closest(".tab-panel");
      if (parentPanel) {
        parentPanel.querySelectorAll(".sub-tab-btn").forEach(el => el.classList.remove("active"));
        parentPanel.querySelectorAll(".sub-tab-panel").forEach(el => el.classList.remove("active"));
        btn.classList.add("active");
        const subPanel = parentPanel.querySelector(`#${btn.dataset.subtab}`);
        if (subPanel) subPanel.classList.add("active");
      }
    };
  });
  document.getElementById("resetBtn").onclick = async () => {
    if (confirm("すべてリセットしますか？")) {
      userData.tasks = {}; userData.hideout = {}; userData.traders = {}; itemProgress = {};
      await updateDoc(doc(db, "users", uid), { tasks: {}, hideout: {}, traders: {}, itemProgress: {} });
      refreshUI();
    }
  };
}

init();