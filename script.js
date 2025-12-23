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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let TASKS = [];
let HIDEOUT_DATA = {};
let userData = { tasks: {}, hideout: {}, favorites: {} };
let itemProgress = {};
let uid = "";
let wikiLang = "jp";
let hideCompleted = true;
let hideoutFirOnly = false;
const TRADERS = ["Prapor", "Therapist", "Fence", "Skier", "Peacekeeper", "Mechanic", "Ragman", "Jaeger"];
let activeTraders = [...TRADERS];

async function init() {
  try {
    const [resTasks, resHideout] = await Promise.all([
      fetch("./tasks_kappa.json"),
      fetch("./hideout_data.json")
    ]);
    TASKS = await resTasks.json();
    HIDEOUT_DATA = await resHideout.json();

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
          itemProgress = data.itemProgress || {};
          wikiLang = data.wikiLang || "jp";
          updateWikiLangUI();
        } else {
          await setDoc(userRef, { tasks: {}, hideout: {}, itemProgress: {}, createdAt: new Date() });
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

function renderRequiredItems() {
  const container = document.getElementById("requiredItemsList");
  if (!container) return;
  container.innerHTML = "";
  const itemSummary = {};
  TASKS.forEach(task => {
    if (!userData.tasks[task.id] && task.requiredItems) {
      task.requiredItems.forEach(item => {
        itemSummary[item.name] = (itemSummary[item.name] || 0) + item.count;
      });
    }
  });

  // お気に入り(最優先) > 完了状況(次点) でソート
  const sorted = Object.entries(itemSummary).sort(([nA, tA], [nB, tB]) => {
    const favA = userData.favorites[nA] ? 1 : 0;
    const favB = userData.favorites[nB] ? 1 : 0;
    if (favA !== favB) return favB - favA;
    const doneA = (itemProgress[nA] || 0) >= tA;
    const doneB = (itemProgress[nB] || 0) >= tB;
    return doneA === doneB ? 0 : doneA ? 1 : -1;
  });

  sorted.forEach(([name, target]) => {
    const current = itemProgress[name] || 0;
    const isDone = current >= target;
    const isFav = userData.favorites[name];
    const card = document.createElement("div");
    const escapedName = name.replace(/'/g, "\\'");
    card.className = `task-card ${isDone ? 'item-done' : ''}`;
    card.innerHTML = `
      <div style="display:flex; align-items:center;">
        <span class="fav-btn ${isFav ? 'active' : ''}" onclick="window.toggleFavorite('${name}')">${isFav ? '★' : '☆'}</span>
        <div class="item-info"><span>${name}</span><div class="item-target">必要: ${target}</div></div>
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
          reqContent += `<li>・${r.name} x${r.count.toLocaleString()}${r.fir ? ' <span class="fir-badge">(FIR)</span>' : ''}</li>`;
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
    for (let lv = nextLevel; lv <= data.max; lv++) {
      (data.requirements[lv] || []).forEach(r => {
        if (!r.type && (!hideoutFirOnly || r.fir)) {
          if (!totalCounts[r.name]) totalCounts[r.name] = { count: 0, fir: r.fir };
          totalCounts[r.name].count += r.count;
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
    const doneA = (itemProgress[nA] || 0) >= dA.count;
    const doneB = (itemProgress[nB] || 0) >= dB.count;
    return doneA === doneB ? 0 : doneA ? 1 : -1;
  });

  container.innerHTML = sorted.map(([name, data]) => {
    const current = itemProgress[name] || 0;
    const isDone = current >= data.count;
    const isFav = userData.favorites[name];
    const escapedName = name.replace(/'/g, "\\'");
    return `
      <div class="task-card ${isDone ? 'item-done' : ''} ${data.fir ? 'fir-item-highlight' : ''}">
        <div style="display:flex; align-items:center;">
          <span class="fav-btn ${isFav ? 'active' : ''}" onclick="window.toggleFavorite('${name}')">${isFav ? '★' : '☆'}</span>
          <div class="item-info">
            <span>${name} ${data.fir ? '<span class="fir-badge">FIR</span>' : ''}</span>
            <div class="item-target">必要: ${data.count}</div>
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

function renderTasks() {
  const container = document.getElementById("taskList");
  if (!container) return;
  container.innerHTML = "";

  const searchText = document.getElementById("searchBox")?.value.toLowerCase() || "";

  const filtered = TASKS.filter(t =>
    activeTraders.includes(t.trader) &&
    t.name.toLowerCase().includes(searchText) &&
    (!hideCompleted || !userData.tasks[t.id])
  );

  filtered.forEach(task => {
    const isCompleted = userData.tasks[task.id];

    // 前提タスクの取得と「1つだけ表示」のロジック
    const preTaskIds = task.preRequisites || [];
    const preTaskNames = preTaskIds
      .map(preId => TASKS.find(t => t.id === preId)?.name)
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
      ? `<span class="badge pre-badge clickable-badge" onclick="window.showPrerequisites('${task.id}')">${preTasksDisplay}</span>`
      : "";

    const itemHtml = (task.requiredItems && task.requiredItems.length > 0)
      ? `<span class="badge item-badge clickable-badge" onclick="window.showRequiredItems('${task.id}')">納品アイテム</span>`
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
            <div class="req-row">${levelHtml}</div>
            <div class="req-row">${preHtml}</div>
            <div class="req-row">${itemHtml}</div>
          </div>
        </div>
      </div>
      <button class="status-btn ${isCompleted ? 'completed' : ''}" onclick="window.toggleTask('${task.id}')">
        ${isCompleted ? '<span>✓</span> 完了' : '未完了'}
      </button>`;

    container.appendChild(card);
  });

  updateProgress();
}

// 前提タスクをすべて（先祖代々）取得する関数
function getRecursivePreRequisites(taskId, allPreIds = new Set()) {
  const task = TASKS.find(t => t.id === taskId);
  // taskがない、または前提条件が空の場合は現在のSetを返す
  if (!task || !task.preRequisites || task.preRequisites.length === 0) {
    return Array.from(allPreIds);
  }

  for (const preId of task.preRequisites) {
    if (!allPreIds.has(preId)) {
      allPreIds.add(preId);
      // さらに深く掘り下げる
      getRecursivePreRequisites(preId, allPreIds);
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
window.showPrerequisites = (taskId) => {
  const task = TASKS.find(t => t.id === taskId);
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
    const preTask = TASKS.find(t => t.id === preId);
    if (preTask) {
      const isDone = userData.tasks[preId];
      const statusIcon = isDone ? '✓' : '未';
      const statusColor = isDone ? 'var(--done-green)' : 'gray';
      const li = document.createElement('li');
      li.innerHTML = `<span style="color:${statusColor}; font-weight:bold; margin-right:5px;">[${statusIcon}]</span> <span style="color:var(--secondary-yellow)">[${preTask.trader}]</span> ${preTask.name}`;
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
window.showRequiredItems = (taskId) => {
  const task = TASKS.find(t => t.id === taskId);
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
    li.innerHTML = `<span style="color:${statusColor}; font-weight:bold; margin-right:5px;">[${statusIcon}]</span> <b>${item.name}</b> x${item.count}${firBadge} (所持: ${current})`;
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
window.toggleTask = async (taskId) => {
  const task = TASKS.find(t => t.id === taskId);
  if (!task) return;

  const isNowCompleted = !userData.tasks[taskId];

  // 完了にする場合のみ一括チェックロジックを走らせる
  if (isNowCompleted) {
    const preIds = getRecursivePreRequisites(taskId);
    // 未完了の前提タスクのみを抽出
    const incompletePres = preIds.filter(id => !userData.tasks[id]);

    if (incompletePres.length > 0) {
      const targetTaskObjects = incompletePres
        .map(id => TASKS.find(t => t.id === id))
        .filter(Boolean);

      // カスタムモーダルを表示（モダンな確認画面）
      const confirmed = await showConfirmModal(targetTaskObjects);

      if (confirmed) {
        incompletePres.forEach(id => {
          userData.tasks[id] = true;
        });
      } else {
        // ユーザーが「キャンセル」を押した場合は、チェックを入れずに終了
        renderTasks(); // 念のため再描画して状態を維持
        return;
      }
    }
  }

  // 本体の状態を更新
  userData.tasks[taskId] = isNowCompleted;

  // 保存と描画（同じscript.js内にある関数を呼ぶ）
  // もしこれらが別ファイルなら、window.saveData などで公開されている必要があります。
  if (typeof saveData === "function") saveData();
  if (typeof renderTasks === "function") renderTasks();
  if (typeof updateProgress === "function") updateProgress();
};

window.updateStationLevel = async (station, level) => {
  userData.hideout[station] = parseInt(level);
  await setDoc(doc(db, "users", uid), { hideout: { [station]: userData.hideout[station] } }, { merge: true });
  refreshUI();
};

function refreshUI() { renderTasks(); renderRequiredItems(); renderHideout(); }

function updateProgress() {
  const total = TASKS.length;
  const done = Object.values(userData.tasks || {}).filter(v => v).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const circle = document.getElementById("progressCircle");
  if (circle) circle.style.strokeDashoffset = 283 - (283 * percent / 100);
  document.getElementById("progressPercent").textContent = `${percent}%`;
  document.getElementById("progressCount").textContent = `${done} / ${total}`;
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
      renderTasks();
    };
  });
}

function updateWikiLangUI() {
  document.getElementById("wikiLangJP").classList.toggle("active", wikiLang === "jp");
  document.getElementById("wikiLangEN").classList.toggle("active", wikiLang === "en");
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

  // UI系
  document.getElementById("searchBox")?.addEventListener("input", renderTasks);
  document.getElementById("hideoutFirOnly")?.addEventListener("change", (e) => {
    hideoutFirOnly = e.target.checked;
    renderHideout();
  });
  document.getElementById("wikiLangJP").onclick = () => { wikiLang = "jp"; updateWikiLangUI(); renderTasks(); };
  document.getElementById("wikiLangEN").onclick = () => { wikiLang = "en"; updateWikiLangUI(); renderTasks(); };
  document.getElementById("toggleCompletedBtn").onclick = (e) => {
    hideCompleted = !hideCompleted;
    e.target.textContent = hideCompleted ? "完了済を非表示中" : "完了済を表示中";
    renderTasks();
  };
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn, .tab-panel").forEach(el => el.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    };
  });
  document.querySelectorAll(".sub-tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".sub-tab-btn, .sub-tab-panel").forEach(el => el.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.subtab).classList.add("active");
    };
  });
  document.getElementById("resetBtn").onclick = async () => {
    if (confirm("すべてリセットしますか？")) {
      userData.tasks = {}; userData.hideout = {}; itemProgress = {};
      await updateDoc(doc(db, "users", uid), { tasks: {}, hideout: {}, itemProgress: {} });
      refreshUI();
    }
  };
}

init();