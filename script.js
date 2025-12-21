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
let userData = { tasks: {}, hideout: {} };
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
    const input = document.querySelector(`input[data-item-name="${name}"]`);
    current = Math.max(0, parseInt(input.value) || 0);
  } else {
    current = Math.max(0, current + delta);
  }
  itemProgress[name] = current;
  await updateDoc(doc(db, "users", uid), { itemProgress: itemProgress });
  refreshUI();
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

  const sorted = Object.entries(itemSummary).sort(([nA, tA], [nB, tB]) => {
    const doneA = (itemProgress[nA] || 0) >= tA;
    const doneB = (itemProgress[nB] || 0) >= tB;
    return doneA === doneB ? 0 : doneA ? 1 : -1;
  });

  sorted.forEach(([name, target]) => {
    const current = itemProgress[name] || 0;
    const isDone = current >= target;
    const card = document.createElement("div");
    card.className = `task-card ${isDone ? 'item-done' : ''}`;
    card.innerHTML = `
      <div class="item-info"><span>${name}</span><div class="item-target">必要: ${target}</div></div>
      <div class="counter-group">
        <button class="count-btn minus" onclick="window.updateItemCount('${name}', -1)">-</button>
        <input type="text" class="count-input" data-item-name="${name}" value="${current}" 
          oninput="this.value = this.value.replace(/[^0-9]/g, '')" 
          onchange="window.updateItemCount('${name}', null)">
        <button class="count-btn plus" onclick="window.updateItemCount('${name}', 1)">+</button>
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
          ${Array.from({length: data.max + 1}, (_, i) => `<option value="${i}" ${currentLevel === i ? 'selected' : ''}>Lv.${i}</option>`).join("")}
        </select>
      </div>
      <div class="req-area">${reqContent}</div>`;
    container.appendChild(card);

    // 集計ロジックの修正
    for (let lv = nextLevel; lv <= data.max; lv++) {
      const requirements = data.requirements[lv] || [];
      requirements.forEach(r => {
        // 施設やスキルではなく「アイテム」かつ「FIR設定に合致」する場合
        if (!r.type && (!hideoutFirOnly || r.fir)) {
          if (!totalCounts[r.name]) {
            totalCounts[r.name] = { count: 0, fir: r.fir };
          }
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
    const doneA = (itemProgress[nA] || 0) >= dA.count;
    const doneB = (itemProgress[nB] || 0) >= dB.count;
    return doneA === doneB ? 0 : doneA ? 1 : -1;
  });

  if (sorted.length === 0) {
    container.innerHTML = "<p>必要なアイテムはありません</p>";
    return;
  }

  container.innerHTML = sorted.map(([name, data]) => {
    const current = itemProgress[name] || 0;
    const isDone = current >= data.count; // ここでisDoneを定義
    
    return `
      <div class="task-card ${isDone ? 'item-done' : ''} ${data.fir ? 'fir-item-highlight' : ''}">
        <div class="item-info">
          <span>${name} ${data.fir ? '<span class="fir-badge">★要インレイド</span>' : ''}</span>
          <div class="item-target">必要: ${data.count}</div>
        </div>
        <div class="counter-group">
          <button class="count-btn minus" onclick="window.updateItemCount('${name}', -1)">-</button>
          <input type="text" class="count-input" data-item-name="${name}" value="${current}" 
            oninput="this.value = this.value.replace(/[^0-9]/g, '')" 
            onchange="window.updateItemCount('${name}', null)">
          <button class="count-btn plus" onclick="window.updateItemCount('${name}', 1)">+</button>
        </div>
      </div>`;
  }).join("");
}

function renderTasks() {
  const container = document.getElementById("taskList");
  if (!container) return;
  container.innerHTML = "";
  const searchText = document.getElementById("searchBox")?.value.toLowerCase() || "";
  const filtered = TASKS.filter(t => activeTraders.includes(t.trader) && t.name.toLowerCase().includes(searchText) && (!hideCompleted || !userData.tasks[t.id]));

  filtered.forEach(task => {
    const isCompleted = userData.tasks[task.id];
    const card = document.createElement("div");
    card.className = `task-card ${isCompleted ? 'completed' : ''}`;
    
    // トレーダー名の小文字変換（ファイル名用）
    const traderLower = task.trader.toLowerCase();
    // 画像パス（環境に合わせて変更してください）
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
          <div>
            <div class="trader-name-label">${task.trader.toUpperCase()}</div>
            <div class="task-name"><a href="${wikiUrl}" target="_blank" class="wiki-link">${task.name}</a></div>
          </div>
        </div>
        <div class="task-items">${(task.requiredItems || []).map(i => `<div>・${i.name} x${i.count}${i.fir ? ' <span class="fir-badge">(FIR)</span>' : ''}</div>`).join("")}</div>
      </div>
      <button class="status-btn ${isCompleted ? 'completed' : ''}" onclick="window.toggleTask('${task.id}')">
        ${isCompleted ? '<span>✓</span> 完了' : '未完了'}
      </button>`;
    container.appendChild(card);
});
  updateProgress();
}

window.toggleTask = async (taskId) => {
  userData.tasks[taskId] = !userData.tasks[taskId];
  await updateDoc(doc(db, "users", uid), { [`tasks.${taskId}`]: userData.tasks[taskId] });
  refreshUI();
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
    if(confirm("すべてリセットしますか？")) {
      userData.tasks = {}; userData.hideout = {}; itemProgress = {};
      await updateDoc(doc(db, "users", uid), { tasks: {}, hideout: {}, itemProgress: {} });
      refreshUI();
    }
  };
}

init();