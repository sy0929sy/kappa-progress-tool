import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
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
let userData = { tasks: {}, hideout: {} };
let itemProgress = {}; // 全タブ共通の所持数管理オブジェクト
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

    auth.onAuthStateChanged(async (user) => {
      if (user) {
        uid = user.uid;
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          userData.tasks = data.tasks || {};
          userData.hideout = data.hideout || {};
          itemProgress = data.itemProgress || {}; // 既存の所持数データを読み込み
          if (data.wikiLang) {
            wikiLang = data.wikiLang;
            updateWikiLangUI();
          }
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

// アイテム所持数を更新する共通関数。ここを更新すると全タブに反映されます。
window.updateItemCount = async (name, delta) => {
  let current = itemProgress[name] || 0;
  if (delta === null) {
    const inputEl = document.querySelectorAll(`input[data-item-name="${name}"]`);
    const val = parseInt(inputEl[0]?.value) || 0;
    current = Math.max(0, val);
  } else {
    current = Math.max(0, current + delta);
  }
  
  itemProgress[name] = current;
  // Firebaseの同一フィールドを更新するため、全てのタブで共有される
  await updateDoc(doc(db, "users", uid), { itemProgress: itemProgress });
  refreshUI(); // 全ての描画関数を再実行して数値を同期
};

function renderTasks() {
  const container = document.getElementById("taskList");
  if (!container) return;
  container.innerHTML = "";

  const searchText = document.getElementById("searchBox")?.value.toLowerCase() || "";

  const filtered = TASKS.filter(t => {
    const isTraderMatch = activeTraders.includes(t.trader);
    const isSearchMatch = t.name.toLowerCase().includes(searchText);
    const isHideMatch = hideCompleted ? !userData.tasks[t.id] : true;
    return isTraderMatch && isSearchMatch && isHideMatch;
  });

  filtered.forEach(task => {
    const isCompleted = userData.tasks[task.id];
    const card = document.createElement("div");
    card.className = `task-card ${isCompleted ? 'completed' : ''}`;
  
    const itemsHtml = (task.requiredItems || []).map(item => 
      `<div>・${item.name} x${item.count}${item.fir ? ' <span class="fir-badge">(FIR)</span>' : ''}</div>`
    ).join("");
  
    let wikiUrl = wikiLang === "en" 
      ? `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(task.name.replace(/\s+/g, '_'))}`
      : `https://wikiwiki.jp/eft/${task.trader}/${encodeURIComponent(task.name)}`;
  
    card.innerHTML = `
      <div class="task-info">
        <div class="trader-name-label">${task.trader.toUpperCase()}</div>
        <div class="task-name">
          <a href="${wikiUrl}" target="_blank" class="wiki-link">${task.name}</a>
        </div>
        <div class="task-items">${itemsHtml}</div>
      </div>
      <button class="status-btn ${isCompleted ? 'completed' : ''}" onclick="window.toggleTask('${task.id}')">
        ${isCompleted ? "DONE" : "TO DO"}
      </button>
    `;
    container.appendChild(card);
  });

  updateProgress();
}

function renderRequiredItems() {
  const container = document.getElementById("requiredItemsList");
  if (!container) return;
  container.innerHTML = "";

  const itemSummary = {};
  TASKS.forEach(task => {
    if (!userData.tasks[task.id] && task.requiredItems) {
      task.requiredItems.forEach(item => {
        const key = item.name; 
        itemSummary[key] = (itemSummary[key] || 0) + item.count;
      });
    }
  });

  Object.entries(itemSummary).forEach(([name, target]) => {
    const current = itemProgress[name] || 0;
    const isDone = current >= target;
    const card = document.createElement("div");
    card.className = `task-card ${isDone ? 'item-done' : ''}`;
    card.innerHTML = `
      <div class="item-info">
        <span>${name}</span>
        <div class="item-target">必要: ${target}</div>
      </div>
      <div class="counter-group">
        <button class="count-btn minus" onclick="window.updateItemCount('${name}', -1)">-</button>
        <input type="number" class="count-input" data-item-name="${name}" value="${current}" onchange="window.updateItemCount('${name}', null)">
        <button class="count-btn plus" onclick="window.updateItemCount('${name}', 1)">+</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.toggleTask = async (taskId) => {
  userData.tasks[taskId] = !userData.tasks[taskId];
  await updateDoc(doc(db, "users", uid), { [`tasks.${taskId}`]: userData.tasks[taskId] });
  refreshUI();
};

function switchWikiLang(lang) {
  wikiLang = lang;
  updateWikiLangUI();
  if (uid) updateDoc(doc(db, "users", uid), { wikiLang: lang });
  renderTasks();
}

function updateWikiLangUI() {
  document.getElementById("wikiLangJP").classList.toggle("active", wikiLang === "jp");
  document.getElementById("wikiLangEN").classList.toggle("active", wikiLang === "en");
}

function renderHideout() {
  const container = document.getElementById("hideoutList");
  if (!container) return;
  container.innerHTML = "";
  let totalCounts = {};

  Object.entries(HIDEOUT_DATA).forEach(([station, data]) => {
    if (station === "スタッシュ" && !userData.hideout[station]) userData.hideout[station] = 1;
    const currentLevel = userData.hideout[station] || 0;
    const nextLevel = currentLevel + 1;
    const hasNext = nextLevel <= data.max;

    // 必要条件のHTML生成
    let reqContent = "";
    if (hasNext) {
      reqContent = `<span class="req-title">Lv.${nextLevel}への必要条件:</span><ul class="req-item-list">`;
      (data.requirements[nextLevel] || []).forEach(r => {
        if (r.type) {
          const typeLabel = r.type === "pre_facility" ? "前提" : r.type === "pre_trader" ? "信頼" : "スキル";
          reqContent += `<li>・【${typeLabel}】${r.name} Lv.${r.level}</li>`;
        } else {
          reqContent += `<li>・${r.name} x${(r.count || 0).toLocaleString()}${r.fir ? ' <span class="fir-badge">(FIR)</span>' : ''}</li>`;
        }
      });
      reqContent += `</ul>`;
    } else {
      reqContent = `<div class="max-level-text">最大レベルに達しています</div>`;
    }

    const card = document.createElement("div");
    card.className = "task-card hideout-card";
    card.innerHTML = `
      <div class="hideout-info-main">
        <h4>${station}</h4>
        <select class="level-select" onchange="window.updateStationLevel('${station}', this.value)">
          ${Array.from({length: data.max + 1}, (_, i) => `<option value="${i}" ${currentLevel === i ? 'selected' : ''}>Lv.${i}</option>`).join("")}
        </select>
      </div>
      <div class="req-area">
        ${reqContent}
      </div>
    `;
    container.appendChild(card);

    // 集計ロジック（変更なし）
    for (let lv = nextLevel; lv <= data.max; lv++) {
      (data.requirements[lv] || []).forEach(r => {
        if (r.type) return;
        if (hideoutFirOnly && !r.fir) return;
        const key = r.name;
        if (!totalCounts[key]) totalCounts[key] = { count: 0, fir: r.fir };
        totalCounts[key].count += (r.count || 0);
      });
    }
  });
  renderHideoutTotal(totalCounts);
}

window.updateStationLevel = async (station, level) => {
  userData.hideout[station] = parseInt(level);
  await setDoc(doc(db, "users", uid), { hideout: { [station]: userData.hideout[station] } }, { merge: true });
  refreshUI();
};

function renderHideoutTotal(totalCounts) {
  const container = document.getElementById("hideoutTotalItems");
  if (!container) return;
  
  container.innerHTML = Object.entries(totalCounts).map(([name, data]) => {
    const current = itemProgress[name] || 0;
    const isDone = current >= data.count;
    return `
      <div class="task-card ${isDone ? 'item-done' : ''} ${data.fir ? 'fir-item-highlight' : ''}">
        <div class="item-info">
          <span>${name} ${data.fir ? '<span class="fir-badge">★要インレイド</span>' : ''}</span>
          <div class="item-target">必要: ${data.count}</div>
        </div>
        <div class="counter-group">
          <button class="count-btn minus" onclick="window.updateItemCount('${name}', -1)">-</button>
          <input type="number" class="count-input" data-item-name="${name}" value="${current}" onchange="window.updateItemCount('${name}', null)">
          <button class="count-btn plus" onclick="window.updateItemCount('${name}', 1)">+</button>
        </div>
      </div>
    `;
  }).join("") || "<p>必要なアイテムはありません</p>";
}

function refreshUI() {
  renderTasks();
  renderRequiredItems();
  renderHideout();
}

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

function setupEventListeners() {
  document.getElementById("searchBox")?.addEventListener("input", renderTasks);
  document.getElementById("hideoutFirOnly")?.addEventListener("change", (e) => {
    hideoutFirOnly = e.target.checked;
    renderHideout();
  });
  document.getElementById("wikiLangJP").onclick = () => switchWikiLang("jp");
  document.getElementById("wikiLangEN").onclick = () => switchWikiLang("en");
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
    if(confirm("すべての進捗をリセットしますか？")) {
      userData.tasks = {}; userData.hideout = {}; itemProgress = {};
      await updateDoc(doc(db, "users", uid), { tasks: {}, hideout: {}, itemProgress: {} });
      refreshUI();
    }
  };
}

init();