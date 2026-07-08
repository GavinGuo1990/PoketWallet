const DB_NAME = "PocketLedgerDB";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const CATEGORY_TREE = {
  expense: {
    "食": ["早餐", "中餐", "晚餐", "點心", "聚餐"],
    "衣": [],
    "住": ["水費", "電費", "瓦斯費"],
    "行": ["交通費", "油錢", "停車費"],
    "育": [],
    "樂": ["門票", "菸"]
  },
  income: {
    "食": [],
    "衣": [],
    "住": [],
    "行": [],
    "育": [],
    "樂": []
  }
};
const PAYMENT_OPTIONS = {
  expense: ["現金", "信用卡", "轉帳", "電子支付"],
  income: ["薪水", "獎金"]
};

let db;
let currentType = "expense";
let currentFilter = "all";
let pendingDeleteId = null;
let selectedMainCategory = "";
let selectedSubCategory = "";

function today() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCurrency(amount) {
  return `NT$${Math.round(amount).toLocaleString("zh-TW")}`;
}

function formatMonth(dateString) {
  const date = new Date(dateString);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function formatDisplayDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" });
}

function pageKey() {
  return document.body.dataset.page || "home";
}

function getEntryCategoryLabel(entry) {
  const main = String(entry.mainCategory || "").trim();
  const category = String(entry.category || "").trim();
  if (main && category && main !== category) return `${main}・${category}`;
  return category || main || "未分類";
}

function showMessage(message, type = "success") {
  const box = document.getElementById("message-box");
  if (!box) return;

  box.textContent = message;
  box.className = "mb-4 rounded-2xl border px-4 py-3 text-sm shadow-sm";
  if (type === "error") {
    box.classList.add("border-rose-200", "bg-rose-50", "text-rose-700");
  } else {
    box.classList.add("border-emerald-200", "bg-emerald-50", "text-emerald-700");
  }

  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => {
    box.className = "mb-4 hidden rounded-2xl border px-4 py-3 text-sm shadow-sm";
  }, 2500);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("category", "category", { unique: false });
      }
    };
  });
}

function withStore(mode, handler) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = handler(store);
    transaction.onerror = () => reject(transaction.error);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllEntries() {
  return withStore("readonly", (store) => store.getAll());
}

function addEntry(entry) {
  return withStore("readwrite", (store) => store.add(entry));
}

function deleteEntry(id) {
  return withStore("readwrite", (store) => store.delete(id));
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sanitizeImportedEntry(item) {
  if (!item || typeof item !== "object") return null;

  const date = String(item.date || "").trim();
  const type = item.type === "income" ? "income" : "expense";
  const category = String(item.category || "").trim();
  const mainCategory = String(item.mainCategory || "").trim();
  const payment = String(item.payment || "現金").trim();
  const note = String(item.note || "").trim();
  const amount = Number(item.amount);

  if (!date || !category || !Number.isFinite(amount) || amount <= 0) return null;

  return { date, type, category, mainCategory, payment, note, amount };
}

function getEntryKey(entry) {
  return [entry.date, entry.type, entry.mainCategory || "", entry.category, entry.payment, entry.note, entry.amount].join("|");
}

function renderTopSummary(entries) {
  const monthEntries = entries.filter((entry) => entry.date.startsWith(today().slice(0, 7)));
  const income = monthEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const expense = monthEntries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount, 0);
  const balance = income - expense;

  const monthLabel = document.getElementById("current-month-label");
  const incomeEl = document.getElementById("summary-income");
  const expenseEl = document.getElementById("summary-expense");
  const balanceEl = document.getElementById("summary-balance");

  if (monthLabel) monthLabel.textContent = formatMonth(today());
  if (incomeEl) incomeEl.textContent = formatCurrency(income);
  if (expenseEl) expenseEl.textContent = formatCurrency(expense);
  if (balanceEl) {
    balanceEl.textContent = `${balance >= 0 ? "+" : "-"}${formatCurrency(Math.abs(balance))}`;
    balanceEl.className = balance >= 0
      ? "mt-2 text-xl font-bold text-emerald-200"
      : "mt-2 text-xl font-bold text-orange-200";
  }
}

function renderRecordCount(entries) {
  const countEl = document.getElementById("record-count");
  if (countEl) countEl.textContent = `${entries.length} 筆`;
}

function setType(type) {
  currentType = type;
  selectedMainCategory = "";
  selectedSubCategory = "";

  document.querySelectorAll(".type-toggle").forEach((button) => {
    const active = button.dataset.type === type;
    button.className = active
      ? "type-toggle rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-coral"
      : "type-toggle rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-semibold text-stone-500";
  });

  const amount = document.getElementById("amount");
  const note = document.getElementById("note");
  const payment = document.getElementById("payment");
  const paymentLabel = document.getElementById("payment-label");
  if (amount) amount.placeholder = type === "expense" ? "例如 120" : "例如 32000";
  if (note) note.placeholder = type === "expense" ? "例如 午餐、加油、咖啡" : "例如 薪資備註";
  if (payment) {
    payment.innerHTML = PAYMENT_OPTIONS[type].map((option) => `<option>${option}</option>`).join("");
  }
  if (paymentLabel) {
    paymentLabel.textContent = type === "expense" ? "付款方式" : "收入類型";
  }

  syncCategorySelection();
  renderMainCategoryChips();
  renderSubCategoryChips();
}

function syncCategorySelection() {
  const mainCategoryInput = document.getElementById("main-category");
  const categoryInput = document.getElementById("category");
  if (mainCategoryInput) mainCategoryInput.value = selectedMainCategory;

  if (categoryInput) {
    const options = selectedMainCategory ? (CATEGORY_TREE[currentType][selectedMainCategory] || []) : [];
    categoryInput.value = options.length === 0 ? selectedMainCategory : selectedSubCategory;
  }

  const selectedLabel = document.getElementById("selected-category-value");
  if (!selectedLabel) return;

  if (!selectedMainCategory) {
    selectedLabel.textContent = "請先選主分類";
    return;
  }

  const options = CATEGORY_TREE[currentType][selectedMainCategory] || [];
  selectedLabel.textContent = options.length === 0
    ? selectedMainCategory
    : (selectedSubCategory ? `${selectedMainCategory}・${selectedSubCategory}` : `${selectedMainCategory}・請選細項`);
}

function renderMainCategoryChips() {
  const container = document.getElementById("main-category-chips");
  if (!container) return;

  const categories = Object.keys(CATEGORY_TREE[currentType]);
  container.innerHTML = categories.map((category) => `
    <button
      type="button"
      class="main-category-chip rounded-full border px-4 py-2 text-sm font-semibold transition ${
        selectedMainCategory === category
          ? "border-teal bg-teal text-white"
          : "border-stone-200 bg-stone-50 text-stone-600 hover:border-teal hover:text-teal"
      }"
      data-category="${category}"
    >
      ${category}
    </button>
  `).join("");

  document.querySelectorAll(".main-category-chip").forEach((button) => {
    button.addEventListener("click", () => {
      selectedMainCategory = button.dataset.category;
      selectedSubCategory = "";
      syncCategorySelection();
      renderMainCategoryChips();
      renderSubCategoryChips();
    });
  });
}

function renderSubCategoryChips() {
  const section = document.getElementById("sub-category-section");
  const container = document.getElementById("sub-category-chips");
  if (!section || !container) return;

  if (!selectedMainCategory) {
    section.classList.add("hidden");
    container.innerHTML = "";
    syncCategorySelection();
    return;
  }

  const options = CATEGORY_TREE[currentType][selectedMainCategory] || [];
  section.classList.remove("hidden");

  if (options.length === 0) {
    container.innerHTML = '<p class="text-sm text-stone-400">這個主分類沒有細項，直接使用主分類。</p>';
    syncCategorySelection();
    return;
  }

  container.innerHTML = options.map((category) => `
    <button
      type="button"
      class="sub-category-chip rounded-full border px-4 py-2 text-sm font-semibold transition ${
        selectedSubCategory === category
          ? "border-coral bg-coral text-white"
          : "border-stone-200 bg-white text-stone-600 hover:border-coral hover:text-coral"
      }"
      data-category="${category}"
    >
      ${category}
    </button>
  `).join("");

  document.querySelectorAll(".sub-category-chip").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSubCategory = button.dataset.category;
      syncCategorySelection();
      renderSubCategoryChips();
    });
  });

  syncCategorySelection();
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll(".filter-btn").forEach((button) => {
    const active = button.dataset.filter === filter;
    button.className = active
      ? "filter-btn rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white"
      : "filter-btn rounded-full px-4 py-2 text-sm font-semibold text-stone-500";
  });
  if (db) refreshData();
}

function renderCategorySummary(entries) {
  const container = document.getElementById("category-summary");
  if (!container) return;

  const monthKey = today().slice(0, 7);
  const filtered = entries
    .filter((entry) => entry.date.startsWith(monthKey))
    .filter((entry) => currentFilter === "all" ? true : entry.type === currentFilter);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="rounded-[1.5rem] border border-dashed border-stone-200 bg-white/70 px-4 py-8 text-center text-sm text-stone-400">這個篩選條件目前沒有資料。</div>';
    return;
  }

  const grouped = Object.values(filtered.reduce((acc, entry) => {
    const label = getEntryCategoryLabel(entry);
    const key = `${entry.type}-${label}`;
    if (!acc[key]) acc[key] = { type: entry.type, category: label, amount: 0, count: 0 };
    acc[key].amount += entry.amount;
    acc[key].count += 1;
    return acc;
  }, {})).sort((a, b) => b.amount - a.amount);

  const maxAmount = grouped[0]?.amount || 1;
  container.innerHTML = grouped.map((item) => `
    <article class="rounded-[1.5rem] bg-white/80 p-4">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${item.type === "expense" ? "bg-orange-100 text-coral" : "bg-emerald-100 text-emerald-700"}">
            ${item.type === "expense" ? "支出" : "收入"}
          </span>
          <h3 class="font-semibold text-ink">${item.category}</h3>
        </div>
        <div class="text-right">
          <p class="font-bold text-ink">${formatCurrency(item.amount)}</p>
          <p class="text-xs text-stone-400">${item.count} 筆</p>
        </div>
      </div>
      <div class="mt-3 h-2 rounded-full bg-stone-100">
        <div class="h-2 rounded-full ${item.type === "expense" ? "bg-coral" : "bg-teal"}" style="width:${Math.max(14, (item.amount / maxAmount) * 100)}%"></div>
      </div>
    </article>
  `).join("");
}

function renderRecentList(entries) {
  const container = document.getElementById("recent-list");
  if (!container) return;

  const recentEntries = [...entries].sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`)).slice(0, 20);
  if (recentEntries.length === 0) {
    container.innerHTML = '<div class="rounded-[1.25rem] bg-white px-4 py-8 text-center text-sm text-stone-400">先新增第一筆收支，這裡會顯示最新紀錄。</div>';
    return;
  }

  container.innerHTML = recentEntries.map((entry) => `
    <article class="rounded-[1.4rem] bg-white px-4 py-4 shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${entry.type === "expense" ? "bg-orange-100 text-coral" : "bg-emerald-100 text-emerald-700"}">
              ${entry.type === "expense" ? "支出" : "收入"}
            </span>
            <p class="truncate font-semibold text-ink">${getEntryCategoryLabel(entry)}</p>
          </div>
          <p class="mt-2 text-sm text-stone-500">${formatDisplayDate(entry.date)} ・ ${entry.payment}${entry.note ? ` ・ ${entry.note}` : ""}</p>
        </div>
        <div class="text-right">
          <p class="font-bold ${entry.type === "expense" ? "text-coral" : "text-emerald-700"}">${entry.type === "expense" ? "-" : "+"}${formatCurrency(entry.amount)}</p>
          <button type="button" class="delete-btn mt-2 text-xs font-semibold text-stone-400 transition hover:text-rose-600" data-id="${entry.id}" data-label="${getEntryCategoryLabel(entry)} ${formatCurrency(entry.amount)}">刪除</button>
        </div>
      </div>
    </article>
  `).join("");

  document.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", () => openDeleteDialog(Number(button.dataset.id), button.dataset.label));
  });
}

function renderDailyList(entries) {
  const container = document.getElementById("daily-list");
  if (!container) return;

  const sorted = [...entries].sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`));
  if (sorted.length === 0) {
    container.innerHTML = '<div class="rounded-[1.5rem] border border-dashed border-stone-200 bg-white/70 px-4 py-8 text-center text-sm text-stone-400">還沒有可彙整的資料。</div>';
    return;
  }

  const grouped = sorted.reduce((acc, entry) => {
    if (!acc[entry.date]) acc[entry.date] = [];
    acc[entry.date].push(entry);
    return acc;
  }, {});

  container.innerHTML = Object.entries(grouped).map(([date, dayEntries]) => {
    const income = dayEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount, 0);
    const expense = dayEntries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount, 0);

    return `
      <article class="rounded-[1.5rem] bg-white/80 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="font-bold text-ink">${formatDisplayDate(date)}</h3>
            <p class="mt-1 text-sm text-stone-500">${dayEntries.length} 筆紀錄</p>
          </div>
          <div class="text-right text-sm">
            <p class="text-emerald-700">+ ${formatCurrency(income)}</p>
            <p class="text-coral">- ${formatCurrency(expense)}</p>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          ${dayEntries.map((entry) => `
            <span class="rounded-full bg-paper px-3 py-1 text-xs text-stone-600">
              ${getEntryCategoryLabel(entry)} ${entry.type === "expense" ? "-" : "+"}${entry.amount}
            </span>
          `).join("")}
        </div>
      </article>
    `;
  }).join("");
}

function renderMonthlyStats(entries) {
  const monthIncomeEl = document.getElementById("month-income");
  const monthExpenseEl = document.getElementById("month-expense");
  const monthBalanceEl = document.getElementById("month-balance");
  if (!monthIncomeEl || !monthExpenseEl || !monthBalanceEl) return;

  const monthKey = today().slice(0, 7);
  const monthEntries = entries.filter((entry) => entry.date.startsWith(monthKey));
  const income = monthEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const expense = monthEntries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount, 0);
  const balance = income - expense;

  monthIncomeEl.textContent = formatCurrency(income);
  monthExpenseEl.textContent = formatCurrency(expense);
  monthBalanceEl.textContent = `${balance >= 0 ? "+" : "-"}${formatCurrency(Math.abs(balance))}`;
}

function renderMonthlyTrend(entries) {
  const container = document.getElementById("monthly-trend");
  if (!container) return;

  if (entries.length === 0) {
    container.innerHTML = '<div class="rounded-[1.5rem] border border-dashed border-stone-200 bg-white/70 px-4 py-8 text-center text-sm text-stone-400">還沒有資料可以統計。</div>';
    return;
  }

  const grouped = entries.reduce((acc, entry) => {
    if (!acc[entry.date]) acc[entry.date] = { date: entry.date, income: 0, expense: 0 };
    acc[entry.date][entry.type] += entry.amount;
    return acc;
  }, {});

  const rows = Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  container.innerHTML = rows.map((row) => `
    <article class="rounded-[1.5rem] bg-white/80 p-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="font-bold text-ink">${formatDisplayDate(row.date)}</h3>
          <p class="mt-1 text-sm text-stone-500">單日收支</p>
        </div>
        <div class="text-right text-sm">
          <p class="text-emerald-700">+ ${formatCurrency(row.income)}</p>
          <p class="text-coral">- ${formatCurrency(row.expense)}</p>
        </div>
      </div>
    </article>
  `).join("");
}

function openDeleteDialog(id, label) {
  const dialog = document.getElementById("delete-dialog");
  const message = document.getElementById("delete-message");
  if (!dialog || !message) return;

  pendingDeleteId = id;
  message.textContent = `將刪除「${label}」這筆資料。`;
  dialog.showModal();
}

async function importEntries(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const rawEntries = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(rawEntries)) {
    throw new Error("格式不正確");
  }

  const existing = await getAllEntries();
  const existingKeys = new Set(existing.map(getEntryKey));
  let imported = 0;

  for (const rawEntry of rawEntries) {
    const entry = sanitizeImportedEntry(rawEntry);
    if (!entry) continue;
    const key = getEntryKey(entry);
    if (existingKeys.has(key)) continue;
    await addEntry(entry);
    existingKeys.add(key);
    imported += 1;
  }

  return imported;
}

function initHomePage() {
  const form = document.getElementById("entry-form");
  const date = document.getElementById("date");
  if (date) date.value = today();

  document.querySelectorAll(".type-toggle").forEach((button) => {
    button.addEventListener("click", () => setType(button.dataset.type));
  });

  setType("expense");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const amount = Number(document.getElementById("amount").value);
    const mainCategory = document.getElementById("main-category").value;
    const category = document.getElementById("category").value;
    const subOptions = mainCategory ? (CATEGORY_TREE[currentType][mainCategory] || []) : [];

    const entry = {
      type: currentType,
      amount,
      date: document.getElementById("date").value,
      payment: document.getElementById("payment").value,
      mainCategory,
      category,
      note: document.getElementById("note").value.trim()
    };

    if (!Number.isFinite(amount) || amount <= 0) {
      showMessage("金額需大於 0", "error");
      return;
    }
    if (!entry.date || !entry.category) {
      showMessage("日期和分類不可空白", "error");
      return;
    }
    if (subOptions.length > 0 && !selectedSubCategory) {
      showMessage("請選擇細項分類", "error");
      return;
    }

    await addEntry(entry);
    document.getElementById("amount").value = "";
    document.getElementById("main-category").value = "";
    document.getElementById("category").value = "";
    document.getElementById("note").value = "";
    selectedMainCategory = "";
    selectedSubCategory = "";
    renderMainCategoryChips();
    renderSubCategoryChips();
    await refreshData();
    showMessage("已新增一筆紀錄");
    document.getElementById("amount").focus();
  });
}

function initRecordsPage() {
  const cancel = document.getElementById("cancel-delete");
  const confirm = document.getElementById("confirm-delete");
  const dialog = document.getElementById("delete-dialog");

  if (cancel && dialog) {
    cancel.addEventListener("click", () => {
      pendingDeleteId = null;
      dialog.close();
    });
  }

  if (confirm && dialog) {
    confirm.addEventListener("click", async () => {
      if (pendingDeleteId === null) return;
      await deleteEntry(pendingDeleteId);
      pendingDeleteId = null;
      dialog.close();
      await refreshData();
      showMessage("紀錄已刪除");
    });
  }
}

function initReportsPage() {
  document.querySelectorAll(".filter-btn").forEach((button) => {
    button.addEventListener("click", () => setFilter(button.dataset.filter));
  });
  setFilter("all");

  const exportButton = document.getElementById("export-btn");
  const importInput = document.getElementById("import-input");

  if (exportButton) {
    exportButton.addEventListener("click", async () => {
      const entries = await getAllEntries();
      downloadJson(`ledger-backup-${today()}.json`, {
        app: "PocketLedger",
        exportedAt: new Date().toISOString(),
        records: entries.map(({ id, ...entry }) => entry)
      });
      showMessage(`已匯出 ${entries.length} 筆資料`);
    });
  }

  if (importInput) {
    importInput.addEventListener("change", async (event) => {
      const [file] = event.target.files;
      if (!file) return;

      try {
        const imported = await importEntries(file);
        await refreshData();
        showMessage(`已匯入 ${imported} 筆資料`);
      } catch (error) {
        showMessage("匯入失敗，請確認 JSON 格式", "error");
      } finally {
        event.target.value = "";
      }
    });
  }
}

async function refreshData() {
  const entries = await getAllEntries();
  const sortedEntries = [...entries].sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`));

  renderTopSummary(sortedEntries);
  renderRecordCount(sortedEntries);
  renderRecentList(sortedEntries);
  renderDailyList(sortedEntries);
  renderCategorySummary(sortedEntries);
  renderMonthlyStats(sortedEntries);
  renderMonthlyTrend(sortedEntries);
}

window.addEventListener("load", async () => {
  try {
    await openDatabase();
    if (pageKey() === "home") initHomePage();
    if (pageKey() === "records") initRecordsPage();
    if (pageKey() === "reports") initReportsPage();
    await refreshData();
  } catch (error) {
    showMessage("資料庫初始化失敗", "error");
  }
});
