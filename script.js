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
let userData = {};
let userHideout = {};
let userInventory = {};
let uid = "";
let hideCompleted = true;
let hideoutFirOnly = false;
const TRADERS = ["Prapor", "Therapist", "Fence", "Skier", "Peacekeeper", "Mechanic", "Ragman", "Jaeger"];
let activeTraders = [...TRADERS];

async function init() {
  const [resTasks, resHideout] = await Promise.all([
    fetch("./tasks_kappa.json"),
    fetch("./hideout_data.json")
  ]);
  TASKS = await resTasks.json();
  HIDEOUT_DATA = await resHideout.json();

  const userCredential = await signInAnonymously(auth);
  uid = userCredential.user.uid;

  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  
  if (snap.exists()) {
    userData = snap.data().tasks || {};
    userHideout = snap.data().hideout || {};
    userInventory = snap.data().inventory || {}; // 追加
  } else {
    // ★ 初めてのユーザーの場合、Stash: 1 で初期化して作成
    userHideout = { "スタッシュ": 1 };
    await setDoc(userRef, { hideout: userHideout, tasks: {} });
  }

  // ★ 既存ユーザーでも Stash が未設定なら 1 にする
  if (userHideout["スタッシュ"] === undefined) {
    userHideout["スタッシュ"] = 1;
  }

  createTraderButtons();
  setupEventListeners();
  refreshUI();
}

function createTraderButtons() {
  const container = document.getElementById("traderButtons");
  TRADERS.forEach(name => {
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.className = `trader-btn active`;
    btn.onclick = () => {
      if (activeTraders.includes(name)) activeTraders = activeTraders.filter(t => t !== name);
      else activeTraders.push(name);
      btn.classList.toggle("active");
      refreshUI();
    };
    container.appendChild(btn);
  });
}

function refreshUI() {
  renderTasks();
  renderRequiredItems();
  renderHideout();
  updateProgress();
}

function updateProgress() {
  const total = TASKS.length;
  const done = TASKS.filter(t => userData[t.id]).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const circle = document.getElementById("progressCircle");
  // 283は円周 (2 * Math.PI * 45)
  circle.style.strokeDashoffset = 283 - (283 * percent) / 100;
  document.getElementById("progressPercent").textContent = `${percent}%`;
  document.getElementById("progressCount").textContent = `${done} / ${total}`;
}

function renderTasks() {
  const list = document.getElementById("taskList");
  list.innerHTML = "";
  const keyword = document.getElementById("searchBox").value.toLowerCase();

  TASKS.forEach(task => {
    if (!activeTraders.includes(task.trader)) return;
    if (keyword && !task.name.toLowerCase().includes(keyword)) return;
    if (hideCompleted && userData[task.id]) return;

    // Wiki URL生成
    const fandomName = task.name.replace(/\s+/g, '_');
    const jpWiki = `https://wikiwiki.jp/eft/${task.trader}/${encodeURIComponent(task.name)}`;
    const enWiki = `https://escapefromtarkov.fandom.com/wiki/${fandomName}`;

    const card = document.createElement("div");
    card.className = "task-card";
    card.innerHTML = `
      <div>
        <h4 style="margin:0">${task.name}</h4>
        <div style="margin-top:5px;">
          <a href="${jpWiki}" target="_blank" class="wiki-link" style="color:var(--primary-pink); margin-right:12px;">JP Wiki 🔗</a>
          <a href="${enWiki}" target="_blank" class="wiki-link" style="color:var(--bg-blue);">EN Wiki 🔗</a>
        </div>
      </div>
      <button class="done-btn" style="${userData[task.id] ? 'opacity:0.5' : ''}">
        ${userData[task.id] ? 'COMPLETED!' : 'DONE?'}
      </button>
    `;

	card.querySelector(".done-btn").onclick = async (e) => {
      // 1. ボタンを即座に無効化して連打を防ぐ
      const btn = e.currentTarget;
      btn.disabled = true;

      const taskId = task.id;
      // 2. ローカルの状態を反転
      const isCurrentlyDone = !!userData[taskId];
      const newState = !isCurrentlyDone;
      userData[taskId] = newState;

      try {
        // 3. UIを先行して更新（ユーザー体験を向上）
        btn.textContent = newState ? 'COMPLETED!' : 'DONE?';
        btn.style.opacity = newState ? '0.5' : '1';

        // 4. Firestoreを更新（ドキュメントが存在しない場合を考慮してsetDocのmergeを使うのが安全）
        const userRef = doc(db, "users", uid);
        await setDoc(userRef, { tasks: { [taskId]: newState } }, { merge: true });

        // 5. データの整合性を保つため、全体のUIを更新
        refreshUI();
      } catch (error) {
        console.error("Update Error:", error);
        // エラー時は状態を戻す
        userData[taskId] = isCurrentlyDone;
        alert("保存に失敗しました。ページを再読み込みしてください。");
      } finally {
        btn.disabled = false;
      }
    };
    list.appendChild(card);
  });
}

function renderRequiredItems() {
  const counts = {};
  // 完了していないタスクから必要アイテムを抽出
  TASKS.filter(t => !userData[t.id]).forEach(task => {
    task.requiredItems?.forEach(item => {
      counts[item.name] = (counts[item.name] || 0) + item.count;
    });
  });

  const list = document.getElementById("requiredItemsList");
  const entries = Object.entries(counts).sort();

  if (!entries.length) {
    list.innerHTML = "<p>必要なアイテムはありません！</p>";
    return;
  }

  list.innerHTML = entries.map(([name, totalNeeded]) => {
    const currentStock = userInventory[name] || 0;
    const remaining = Math.max(0, totalNeeded - currentStock);
    const isDone = remaining === 0;

    return `
      <div class="task-card ${isDone ? 'item-done' : ''}" style="flex-direction: column; align-items: stretch;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: bold; ${isDone ? 'text-decoration: line-through; opacity: 0.6;' : ''}">
            ${name}
          </span>
          <div class="counter-group">
            <button class="count-btn minus" data-name="${name}">-</button>
            <span class="count-display">${currentStock} / ${totalNeeded}</span>
            <button class="count-btn plus" data-name="${name}">+</button>
          </div>
        </div>
        ${!isDone ? `
          <div style="font-size: 0.8em; color: var(--bg-blue); margin-top: 5px;">
            残りあと <strong>${remaining}</strong> 個
          </div>
        ` : '<div style="font-size: 0.8em; color: green; margin-top: 5px;">収集完了！</div>'}
      </div>
    `;
  }).join("");

  // ボタンイベントの紐付け
  list.querySelectorAll(".count-btn").forEach(btn => {
    btn.onclick = async (e) => {
      const name = e.target.dataset.name;
      const isPlus = e.target.classList.contains("plus");
      
      let current = userInventory[name] || 0;
      userInventory[name] = isPlus ? current + 1 : Math.max(0, current - 1);

      // UIの即時更新
      renderRequiredItems();

      // Firestoreへ保存
      try {
        await setDoc(doc(db, "users", uid), {
          inventory: { [name]: userInventory[name] }
        }, { merge: true });
      } catch (err) { console.error("Inventory Save Error:", err); }
    };
  });
}

function renderHideout() {
  const container = document.getElementById("hideoutList");
  const totalItemsContainer = document.getElementById("hideoutTotalItems");
  
  if (!container || !totalItemsContainer) return;

  container.innerHTML = "";
  let totalCounts = {};

  Object.entries(HIDEOUT_DATA).forEach(([station, data]) => {
    // Stashの初期化
    if (station === "スタッシュ" && (userHideout[station] === undefined || userHideout[station] === 0)) {
      userHideout[station] = 1;
    }
    const currentLevel = userHideout[station] || 0;
    const nextLevel = currentLevel + 1;

    // --- 「次へ必要」の表示生成 ---
    let nextReqHtml = "";
    if (nextLevel <= data.max) {
      nextReqHtml = `<strong>Lv.${nextLevel}への必要条件:</strong><br>`;
      const reqs = data.requirements[nextLevel] || [];
      
      reqs.forEach(r => {
        if (r.type === "pre_facility") {
          nextReqHtml += `・【前提】${r.name} Lv.${r.level}<br>`;
        } 
        else if (r.type === "pre_trader") {
          nextReqHtml += `・【信頼】${r.name} LL${r.level}<br>`;
        }
        else if (r.type === "pre_skill") {
          nextReqHtml += `・【スキル】${r.name} Lv${r.level}<br>`;
        }
        else {
          const firTag = r.fir ? '<span class="fir-badge" style="color:var(--primary-pink); font-weight:bold;"> (FIR)</span>' : '';
          nextReqHtml += `・${r.name} x${r.count.toLocaleString()}${firTag}<br>`;
        }
      });
    } else {
      nextReqHtml = `<span style="color:#888;">最大レベルです</span>`;
    }

    // ドロップダウン生成
    let options = "";
    for (let i = 0; i <= data.max; i++) {
      options += `<option value="${i}" ${currentLevel == i ? 'selected' : ''}>Lv.${i}</option>`;
    }

    const card = document.createElement("div");
    card.className = "task-card";
    card.style.flexDirection = "column";
    card.style.alignItems = "flex-start"; 
    card.style.textAlign = "left";

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:10px;">
        <h4 style="margin:0">${station}</h4>
        <select class="level-select" data-station="${station}">
          ${options}
        </select>
      </div>
      <div class="req-area" style="width:100%; font-size:0.85em; line-height:1.6; color:#444;">
        ${nextReqHtml}
      </div>
    `;

    // イベントリスナー
    card.querySelector(".level-select").addEventListener('change', async (e) => {
      const newLevel = parseInt(e.target.value);
      const targetStation = e.target.dataset.station;
      userHideout[targetStation] = newLevel;
      try {
        const userRef = doc(db, "users", uid);
        await setDoc(userRef, { hideout: { [targetStation]: newLevel } }, { merge: true });
      } catch (err) { console.error(err); }
      refreshUI();
    });

    container.appendChild(card);

    // --- 集計計算ロジック（買い物リスト用） ---
    for (let lv = nextLevel; lv <= data.max; lv++) {
      if (data.requirements[lv]) {
        data.requirements[lv].forEach(r => {
          // 施設やトレーダーの条件は買い物リストには含めない
          if (r.type === "pre_facility" || r.type === "pre_trader") return;

          const key = r.fir ? `${r.name} (FIR)` : r.name;
          totalCounts[key] = (totalCounts[key] || 0) + r.count;
        });
      }
    }
  });

  renderHideoutTotal(totalCounts);
}

function renderHideoutTotal(totalCounts) {
  const container = document.getElementById("hideoutTotalItems");
  let entries = Object.entries(totalCounts);

  if (hideoutFirOnly) {
    entries = entries.filter(([name, count]) => name.includes("(FIR)"));
  }

  entries.sort();

  if (entries.length === 0) {
    container.innerHTML = "<p>必要なアイテムはありません！</p>";
    return;
  }

  container.innerHTML = entries.map(([name, totalNeeded]) => {
    const currentStock = userInventory[name] || 0;
    const remaining = Math.max(0, totalNeeded - currentStock);
    const isDone = remaining === 0;

    return `
      <div class="task-card ${isDone ? 'item-done' : ''}" style="flex-direction: column; align-items: stretch;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: bold; ${isDone ? 'text-decoration: line-through; opacity: 0.6;' : ''}">
            ${name}
          </span>
          <div class="counter-group">
            <button class="count-btn minus" data-name="${name}">-</button>
            <span class="count-display">${currentStock} / ${totalNeeded}</span>
            <button class="count-btn plus" data-name="${name}">+</button>
          </div>
        </div>
        ${!isDone ? `
          <div style="font-size: 0.8em; color: var(--bg-blue); margin-top: 5px;">
            残りあと <strong>${remaining.toLocaleString()}</strong> 個
          </div>
        ` : '<div style="font-size: 0.8em; color: green; margin-top: 5px;">収集完了！</div>'}
      </div>
    `;
  }).join("");

  // ボタンイベントの紐付け
  container.querySelectorAll(".count-btn").forEach(btn => {
    btn.onclick = async (e) => {
      const name = e.target.dataset.name;
      const isPlus = e.target.classList.contains("plus");
      
      // 在庫数の更新
      let current = userInventory[name] || 0;
      userInventory[name] = isPlus ? current + 1 : Math.max(0, current - 1);

      // UIを先行反映（再描画）
      renderHideoutTotal(totalCounts);

      // Firestoreへ保存
      try {
        await setDoc(doc(db, "users", uid), {
          inventory: { [name]: userInventory[name] }
        }, { merge: true });
      } catch (err) { console.error(err); }
    };
  });
}

function checkPrerequisite(req) {
  if (req.type === "pre_facility") {
    // 現在の施設レベル(userHideout[名前])が要求レベル以上か
    const currentLevel = userHideout[req.name] || 0;
    return currentLevel >= req.level;
  }
  if (req.type === "pre_trader") {
    // トレーダーLLが要求レベル以上か (traderLevels[名前] がある前提)
    // 無い場合は、ひとまず一律LL1として判定するか、トレーダーレベル保持用の変数を参照
    const currentLL = (userData.traderLevels && userData.traderLevels[req.name]) || 1;
    return currentLL >= req.level;
  }
  return null; // 通常アイテムの場合はnullを返す
}

function setupEventListeners() {
  document.getElementById("searchBox").oninput = () => renderTasks();
  
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

  document.getElementById("resetBtn").onclick = async () => {
    if(confirm("進捗をすべてリセットしますか？")) {
      userData = {};
      await updateDoc(doc(db, "users", uid), { tasks: {} });
      refreshUI();
    }
  };
  
  // Hideout内サブタブの切り替えロジック
  const subTabButtons = document.querySelectorAll(".sub-tab-btn");
  const subTabPanels = document.querySelectorAll(".sub-tab-panel");

  subTabButtons.forEach(btn => {
    btn.onclick = () => {
      // 1. 全ボタン/パネルからactiveを消す
      subTabButtons.forEach(b => b.classList.remove("active"));
      subTabPanels.forEach(p => p.classList.remove("active"));

      // 2. クリックされたものにactiveを付与
      btn.classList.add("active");
      const target = btn.getAttribute("data-subtab");
      document.getElementById(target).classList.add("active");
    };
  });
 
  const firToggle = document.getElementById("hideoutFirOnly");
  if (firToggle) {
    firToggle.onchange = (e) => {
      hideoutFirOnly = e.target.checked;
      refreshUI(); // 再描画してフィルターを適用
    };
  }
}

init();