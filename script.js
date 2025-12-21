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
let userData = { tasks: {}, hideout: {}, inventory: {} };
let uid = "";
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
          userData = userDoc.data();
          if (!userData.tasks) userData.tasks = {};
          if (!userData.hideout) userData.hideout = {};
        }
        setupTraderFilters();
        refreshUI();
      } else {
        await signInAnonymously(auth);
      }
    });

    setupEventListeners();
  } catch (e) { console.error("Init Error:", e); }
}

// --- 描画関数 ---

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

    // 1. 先に itemsHtml を定義する（エラー防止）
    const itemsHtml = task.requiredItems ? task.requiredItems.map(item => 
      `<div>・${item.name} x${item.count}${item.fir ? ' <span class="fir-badge">(FIR)</span>' : ''}</div>`
    ).join("") : "";

    // 2. Wikiリンクを生成
    const wikiUrl = `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(task.name.replace(/\s+/g, '_'))}`;

    // 3. HTMLを組み立てる
    card.innerHTML = `
      <div class="task-info">
        <div class="trader-name-label">${task.trader.toUpperCase()}</div>
        <div class="task-name">
          <a href="${wikiUrl}" target="_blank" class="wiki-link">${task.name}</a>
        </div>
        ${itemsHtml ? `<div class="task-items">${itemsHtml}</div>` : ""}
      </div>
      <button class="status-btn ${isCompleted ? 'completed' : ''}" onclick="window.toggleTask('${task.id}')">
        ${isCompleted ? "DONE" : "TO DO"}
      </button>
    `;
    container.appendChild(card);
  });

  updateProgress();
}

// --- グローバル関数 (onclick用) ---

window.toggleTask = async (taskId) => {
  userData.tasks[taskId] = !userData.tasks[taskId];
  await updateDoc(doc(db, "users", uid), { [`tasks.${taskId}`]: userData.tasks[taskId] });
  renderTasks();
};

window.updateStationLevel = async (station, level) => {
  const val = parseInt(level);
  userData.hideout[station] = val;
  await setDoc(doc(db, "users", uid), { hideout: { [station]: val } }, { merge: true });
  refreshUI();
};

// --- Hideout 描画 ---

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

    let nextReqHtml = hasNext ? `<strong>Lv.${nextLevel}への必要条件:</strong><br>` : `<span style="color:#888;">最大レベルです</span>`;
    
    if (hasNext) {
      (data.requirements[nextLevel] || []).forEach(r => {
        if (r.type === "pre_facility") nextReqHtml += `・【前提】${r.name} Lv.${r.level}<br>`;
        else if (r.type === "pre_trader") nextReqHtml += `・【信頼】${r.name} LL${r.level}<br>`;
        else {
          const firTag = r.fir ? '<span class="fir-badge">(FIR)</span>' : '';
          nextReqHtml += `・${r.name} x${r.count.toLocaleString()}${firTag}<br>`;
        }
      });
    }

    const card = document.createElement("div");
    card.className = "task-card hideout-card";
    card.innerHTML = `
      <div class="hideout-card-header">
        <h4>${station}</h4>
        <select class="level-select" onchange="window.updateStationLevel('${station}', this.value)">
          ${Array.from({length: data.max + 1}, (_, i) => `<option value="${i}" ${currentLevel === i ? 'selected' : ''}>Lv.${i}</option>`).join("")}
        </select>
      </div>
      <div class="req-area">${nextReqHtml}</div>
    `;
    container.appendChild(card);

    for (let lv = nextLevel; lv <= data.max; lv++) {
      (data.requirements[lv] || []).forEach(r => {
        if (r.type) return;
        if (hideoutFirOnly && !r.fir) return;
        const key = r.fir ? `${r.name} (FIR)` : r.name;
        totalCounts[key] = (totalCounts[key] || 0) + r.count;
      });
    }
  });
  renderHideoutTotal(totalCounts);
}

function renderHideoutTotal(totalCounts) {
  const container = document.getElementById("hideoutTotalItems");
  if (!container) return;
  container.innerHTML = Object.entries(totalCounts).map(([name, count]) => `
    <div class="task-card"><span>${name}</span><strong>x${count.toLocaleString()}</strong></div>
  `).join("") || "<p>必要なアイテムはありません</p>";
}

// --- その他設定 ---

function refreshUI() {
  renderTasks();
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
}

init();