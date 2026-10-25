const today = new Date();
const pad = n => String(n).padStart(2, '0');
let selectedMonth = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
let selectedDate = `${selectedMonth}-${pad(today.getDate())}`;
let state = { totalBalance: 0, remaining: 0, income: 0, expenses: 0, savings: 0, budgetCap: null, activities: [], goals: [], dailyExpenses: {} };
let cashflowChartInstance = null;
let statsChartInstance = null;

async function apiRequest(path, payload = null) {
    const options = { method: payload === null ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } };
    if (payload !== null) options.body = JSON.stringify(payload);
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The server could not complete the request.');
    return data;
}
async function loadState() {
    const data = await apiRequest(`/api/state?month=${encodeURIComponent(selectedMonth)}`);
    state = { ...state, ...data };
    state.totalBalance = Number(data.totalBalance || 0);
    state.remaining = Number(data.remaining || 0);
    state.expenses = Number(data.expenses || 0);
    state.savings = Number(data.savings || 0);
    state.budgetCap = data.budgetCap == null ? null : Number(data.budgetCap);
    state.activities = (data.activities || []).map(x => ({ ...x, id: Number(x.id), amount: Number(x.amount || 0) }));
    state.goals = (data.goals || []).map(x => ({ ...x, id: Number(x.id), target: Number(x.target || 0), saved: Number(x.saved || 0) }));
    state.dailyExpenses = data.dailyExpenses || {};
}
document.addEventListener('DOMContentLoaded', async () => {
    const monthInput = document.getElementById('monthSelect');
    if (monthInput) { monthInput.value = selectedMonth; monthInput.addEventListener('change', changeMonth); }
    const dateInput = document.getElementById('txDate');
    if (dateInput) dateInput.value = selectedDate;
    try { await loadState(); } catch (e) { console.error(e); showToast('Could not connect to the backend. Run py app.py first.', 'info'); }
    loadProfile();
    initCharts();
    renderDashboard();
});
function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function money(n) { return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function renderDashboard() {
    const put = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    put('val-total-balance', money(state.remaining)); put('modal-current-balance', money(state.remaining));
    put('val-total-income', money(state.remaining)); put('val-total-expenses', money(state.expenses)); put('val-total-saving', money(state.savings));
    put('val-donut-balance', money(state.remaining)); put('legend-saving', money(state.savings)); put('legend-income', money(state.remaining)); put('legend-expenses', money(state.expenses));
    renderBudgetUI(); renderActivities(); renderGoals(); renderCalendar(); updateCashflowChart(); updateStatisticsChart();
}
function renderBudgetUI() {
    const label = document.getElementById('val-budget-cap'), bar = document.getElementById('budget-progress-bar'), tag = document.getElementById('budget-status-tag');
    if (!label || !bar || !tag) return;
    if (state.budgetCap == null) {
        label.textContent = 'Budget: Not set'; bar.style.width = '0%'; tag.textContent = 'Set budget';
        tag.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-[#152420] text-gray-400';
    } else {
        label.textContent = `Budget: ${money(state.budgetCap)}`;
        const pct = state.budgetCap > 0 ? Math.min(100, ((state.expenses + state.savings) / state.budgetCap) * 100) : 0;
        bar.style.width = `${pct}%`;
        if (state.expenses + state.savings > state.budgetCap) {
            tag.textContent = 'Over budget'; tag.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-red-950 text-red-400'; bar.className = 'bg-red-500 h-full rounded-full';
        } else { tag.textContent = `${Math.round(pct)}% used`; tag.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-[#152420] text-amber-400'; bar.className = 'bg-amber-400 h-full rounded-full'; }
    }
    const budgetInput = document.getElementById('budgetCapInput'); if (budgetInput && document.activeElement !== budgetInput) budgetInput.value = state.budgetCap ?? '';
    const budgetMonth = document.getElementById('budgetMonthLabel'); if (budgetMonth) budgetMonth.textContent = formatMonth(selectedMonth);
}
function renderActivities() {
    const overview = document.getElementById('activitiesTableBody'), full = document.getElementById('fullActivitiesTableBody');
    if (!overview || !full) return;
    const makeRow = item => {
        let cls = 'text-[#00f585]'; if (item.classify === 'Saving') cls = 'text-orange-400'; if (item.classify === 'Expenses') cls = 'text-amber-400';
        return `<tr class="hover:bg-[#121f1c]"><td class="py-3 font-medium text-white">${escapeHTML(item.name)}<span class="block text-[10px] text-gray-500">${escapeHTML(item.category)}</span></td><td class="py-3 text-gray-300">${escapeHTML(item.method)}</td><td class="py-3 text-gray-400">${escapeHTML(item.time || item.date || '')}</td><td class="py-3 ${cls}">${escapeHTML(item.classify)}</td><td class="py-3 font-semibold text-white">${money(item.amount)}</td><td class="py-3 text-right"><button onclick="openActivityDetails(${item.id})" class="text-gray-400 hover:text-[#00f585]">Details</button></td></tr>`;
    };
    const list = state.activities.filter(x => x.classify !== 'Income');
    const empty = '<tr><td colspan="6" class="py-6 text-center text-gray-500">No expenses yet. Set a budget, then record your first expense.</td></tr>';
    overview.innerHTML = list.length ? list.slice(0, 4).map(makeRow).join('') : empty;
    full.innerHTML = list.length ? list.map(makeRow).join('') : empty;
}
function renderGoals() {
    const widget = document.getElementById('goalsWidgetList'), grid = document.getElementById('fullGoalsGrid');
    if (!widget || !grid) return;
    const html = g => { const pct = g.target > 0 ? Math.min(100, Math.round(g.saved / g.target * 100)) : 0; return `<div class="p-3 rounded-xl bg-[#121f1c] border border-[#1b312b]"><div class="flex justify-between gap-3 mb-2"><div><p class="text-xs font-semibold text-white">${escapeHTML(g.name)}</p><p class="text-[10px] text-gray-400">${money(g.saved)} / ${money(g.target)}</p></div><span class="text-xs font-bold text-[#00f585]">${pct}%</span></div><div class="w-full bg-[#182b26] h-1.5 rounded-full"><div class="bg-[#00f585] h-full rounded-full" style="width:${pct}%"></div></div></div>`; };
    widget.innerHTML = state.goals.map(html).join(''); grid.innerHTML = state.goals.map(html).join('');
}
function formatMonth(month) { const [y,m] = month.split('-').map(Number); return new Date(y, m-1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); }
function changeMonth() {
    const input = document.getElementById('monthSelect'); if (!input || !input.value) return;
    selectedMonth = input.value;
    if (!selectedDate.startsWith(selectedMonth)) selectedDate = `${selectedMonth}-01`;
    const dateInput = document.getElementById('txDate'); if (dateInput) dateInput.value = selectedDate;
    refreshDashboard();
}
async function refreshDashboard(showFeedback = false) {
    const button = document.getElementById('refreshDashboardBtn');
    const icon = document.getElementById('refreshDashboardIcon');
    const label = document.getElementById('refreshDashboardLabel');
    if (button) button.disabled = true;
    if (icon) icon.classList.add('animate-spin');
    if (label) label.textContent = 'Refreshing...';
    try {
        // Read the currently selected month before fetching its latest dashboard data.
        const monthInput = document.getElementById('monthSelect');
        if (monthInput && monthInput.value) selectedMonth = monthInput.value;
        await loadState();
        renderDashboard();
        if (showFeedback) showToast(`Dashboard refreshed for ${formatMonth(selectedMonth)}.`, 'success');
    } catch (e) {
        showToast(e.message, 'info');
    } finally {
        if (button) button.disabled = false;
        if (icon) icon.classList.remove('animate-spin');
        if (label) label.textContent = 'Refresh';
    }
}
function shiftCalendar(amount) {
    const [y,m] = selectedMonth.split('-').map(Number); const d = new Date(y, m - 1 + amount, 1);
    selectedMonth = `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
    const monthInput = document.getElementById('monthSelect'); if (monthInput) monthInput.value = selectedMonth;
    selectedDate = `${selectedMonth}-01`; const dateInput = document.getElementById('txDate'); if (dateInput) dateInput.value = selectedDate;
    refreshDashboard();
}
function selectCalendarDate(day) {
    selectedDate = `${selectedMonth}-${pad(day)}`;
    const dateInput = document.getElementById('txDate'); if (dateInput) dateInput.value = selectedDate;
    renderCalendar();
    showToast(`Selected ${selectedDate}. New expenses will use this date.`, 'info');
}
function renderCalendar() {
    const title = document.getElementById('calendarMonthTitle'), grid = document.getElementById('calendarGrid');
    if (!title || !grid) return;
    title.textContent = formatMonth(selectedMonth);
    const [year, month] = selectedMonth.split('-').map(Number); const first = new Date(year, month-1, 1).getDay(); const days = new Date(year, month, 0).getDate();
    let html = ['S','M','T','W','T','F','S'].map(d => `<div class="text-center text-[10px] text-gray-500 py-1">${d}</div>`).join('');
    for (let i=0; i<first; i++) html += '<div></div>';
    for (let day=1; day<=days; day++) {
        const key = `${selectedMonth}-${pad(day)}`, spent = Number(state.dailyExpenses?.[key] || 0), selected = key === selectedDate;
        html += `<button type="button" onclick="selectCalendarDate(${day})" title="${spent ? `Spent ${money(spent)}` : 'No recorded expenses'}" class="relative h-8 rounded-lg text-xs ${selected ? 'bg-[#00f585] text-black font-bold' : 'text-gray-300 hover:bg-[#1b312b]'}">${day}${spent ? '<span class="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-400"></span>' : ''}</button>`;
    }
    grid.innerHTML = html;
    const daySpend = Number(state.dailyExpenses?.[selectedDate] || 0); const detail = document.getElementById('calendarDaySpend'); if (detail) detail.textContent = `${selectedDate}: ${money(daySpend)} spent`;
}
function switchTab(tab) {
    const allowedTabs = ["overview", "profile", "activities", "goals"];
    if (!allowedTabs.includes(tab)) tab = "overview";

    document.querySelectorAll(".tab-content").forEach(page => {
        page.classList.add("hidden");
    });

    const selectedPage = document.getElementById(`tab-${tab}`);
    if (!selectedPage) {
        console.error(`Page not found: tab-${tab}`);
        return;
    }
    selectedPage.classList.remove("hidden");

    allowedTabs.forEach(id => {
        const button = document.getElementById(`nav-${id}`);
        if (!button) return;
        const active = id === tab;
        button.classList.toggle("bg-[#12201c]", active);
        button.classList.toggle("text-[#00f585]", active);
        button.classList.toggle("text-gray-400", !active);
    });

    if (tab === "profile") loadProfile();
    const main = document.querySelector("main");
    if (main) main.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function initCharts() {
    if (typeof Chart === 'undefined') { console.warn('Chart.js CDN unavailable; dashboard data will still work without charts.'); return; }
    const c = document.getElementById('cashflowChart');
    if (c) cashflowChartInstance = new Chart(c.getContext('2d'), { type:'doughnut', data:{ labels:['Savings','Remaining Budget','Expenses'], datasets:[{data:[0,0,0], backgroundColor:['#f97316','#00f585','#fbbf24'], borderWidth:0}] }, options:{cutout:'75%',plugins:{legend:{display:false}},responsive:true,maintainAspectRatio:false} });
    const s = document.getElementById('statsChart');
    if (s) statsChartInstance = new Chart(s.getContext('2d'), { type:'bar', data:{labels:[],datasets:[{label:'Daily Expenses',data:[],backgroundColor:'#fbbf24',borderRadius:4}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#9ca3af',maxTicksLimit:10}},y:{beginAtZero:true,grid:{color:'#162521'},ticks:{color:'#9ca3af'}}}} });
}
function updateCashflowChart() {
    if (cashflowChartInstance) { cashflowChartInstance.data.datasets[0].data = [state.savings, state.remaining, state.expenses]; cashflowChartInstance.update(); }
    const label = document.getElementById('legend-income'); if (label) label.textContent = money(state.remaining);
}
function updateStatisticsChart() {
    if (!statsChartInstance) return;
    const [year, month] = selectedMonth.split('-').map(Number), days = new Date(year, month, 0).getDate();
    const labels = [], values = [];
    for (let day=1; day<=days; day++) { const key = `${selectedMonth}-${pad(day)}`; labels.push(String(day)); values.push(Number(state.dailyExpenses?.[key] || 0)); }
    statsChartInstance.data.labels = labels; statsChartInstance.data.datasets[0].data = values; statsChartInstance.update();
}
function openModal(id) {
    if (id === 'addMoneyModal') { const d = document.getElementById('txDate'); if (d) d.value = selectedDate; const b = document.getElementById('modal-current-balance'); if (b) b.textContent = money(state.remaining); }
    if (id === 'setBudgetModal') { const input = document.getElementById('budgetCapInput'); if (input) input.value = state.budgetCap ?? ''; const m = document.getElementById('budgetMonthLabel'); if (m) m.textContent = formatMonth(selectedMonth); }
    const el = document.getElementById(id); if (el) el.classList.remove('hidden');
}
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
async function handleSetBudget(e) {
    e.preventDefault(); const amount = Number(document.getElementById('budgetCapInput').value);
    if (!Number.isFinite(amount) || amount <= 0) return showToast('Enter a monthly budget greater than zero.', 'info');
    try { await apiRequest('/api/budget', { amount, month: selectedMonth }); await refreshDashboard(); closeModal('setBudgetModal'); showToast(`Budget set to ${money(amount)} for ${formatMonth(selectedMonth)}.`, 'success'); }
    catch (err) { showToast(err.message, 'info'); }
}
async function handleTransaction(e) {
    e.preventDefault();
    const type = document.getElementById('txType').value, amount = Number(document.getElementById('txAmount').value);
    const category = document.getElementById('txCategory').value, method = document.getElementById('txMethod').value;
    const title = document.getElementById('txTitle').value.trim(), txDate = document.getElementById('txDate').value;
    if (!title || !txDate || !Number.isFinite(amount) || amount <= 0) return showToast('Enter a description, date, and positive amount.', 'info');
    try {
        await apiRequest('/api/transaction', { title, type, amount, category, method, date: txDate });
        selectedMonth = txDate.slice(0, 7);
        selectedDate = txDate;
        const monthInput = document.getElementById('monthSelect');
        if (monthInput) monthInput.value = selectedMonth;

        await loadState();
        renderDashboard();
        closeModal('addMoneyModal');
        e.target.reset();
        const dateInput = document.getElementById('txDate');
        if (dateInput) dateInput.value = selectedDate;

        if (type === 'Expenses' && state.budgetCap !== null &&
            (state.expenses + state.savings) > state.budgetCap) {
            const overBy = state.expenses + state.savings - state.budgetCap;
            showToast(`Expense recorded. You are ${money(overBy)} over your monthly budget.`, 'info');
        } else {
            showToast(`${type === 'Saving' ? 'Savings' : 'Expense'} of ${money(amount)} recorded.`, 'success');
        }
    } catch (err) {
        showToast(err.message, 'info');
    }
}
async function handleAddGoal(e) {
    e.preventDefault(); const name = document.getElementById('goalTitle').value.trim(), target = Number(document.getElementById('goalTarget').value), saved = Number(document.getElementById('goalSaved').value);
    if (!name || !Number.isFinite(target) || target <= 0 || !Number.isFinite(saved) || saved < 0) return showToast('Enter a goal name, positive target, and valid saved amount.', 'info');
    try { await apiRequest('/api/goal', {name,target,saved}); await refreshDashboard(); closeModal('addGoalModal'); e.target.reset(); showToast('Savings goal added.', 'success'); } catch (err) { showToast(err.message, 'info'); }
}
function openActivityDetails(id) {
    const item = state.activities.find(x => x.id === id); if (!item) return;
    const box = document.getElementById('detailsContent'); if (!box) return;
    box.innerHTML = `<div class="flex justify-between"><span class="text-gray-400">Transaction</span><span>${escapeHTML(item.id)}</span></div><div class="flex justify-between"><span class="text-gray-400">Description</span><span>${escapeHTML(item.name)}</span></div><div class="flex justify-between"><span class="text-gray-400">Category</span><span>${escapeHTML(item.category)}</span></div><div class="flex justify-between"><span class="text-gray-400">Date</span><span>${escapeHTML(item.time)}</span></div><div class="flex justify-between"><span class="text-gray-400">Payment</span><span>${escapeHTML(item.method)}</span></div><div class="flex justify-between"><span class="text-gray-400">Type</span><span>${escapeHTML(item.classify)}</span></div><div class="flex justify-between border-t border-[#162521] pt-2"><span class="text-gray-400">Amount</span><span class="text-[#00f585] font-bold">${money(item.amount)}</span></div>`;
    openModal('detailsModal');
}
function filterActivities() { const q = (document.getElementById('searchInput')?.value || '').toLowerCase(); document.querySelectorAll('#activitiesTableBody tr, #fullActivitiesTableBody tr').forEach(row => row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none'); }

const PROFILE_STORAGE_KEY = "wealthwave.profile.v1";

function getProfile() {
    const fallback = {
        name: "",
        email: "",
        photo: ""
    };
    try {
        const saved = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}");
        return { ...fallback, ...(saved && typeof saved === "object" ? saved : {}) };
    } catch (error) {
        console.warn("Could not read saved profile.", error);
        return fallback;
    }
}

function loadProfile() {
    const profile = getProfile();
    const nameInput = document.getElementById("profileName");
    const emailInput = document.getElementById("profileEmail");
    const photoInput = document.getElementById("profilePhoto");
    if (nameInput) nameInput.value = profile.name || "";
    if (emailInput) emailInput.value = profile.email || "";
    if (photoInput) photoInput.value = profile.photo || "";
    updateProfileDisplay(profile);
}

function updateProfileDisplay(profile = getProfile()) {
    const name = profile.name || "Your name";
    const email = profile.email || "Add your email address";
    const nameLabel = document.getElementById("profileDisplayName");
    const emailLabel = document.getElementById("profileDisplayEmail");
    if (nameLabel) nameLabel.textContent = name;
    if (emailLabel) emailLabel.textContent = email;

    const avatar = document.getElementById("profileAvatar");
    const headerAvatar = document.getElementById("headerProfileAvatar");
    const photo = profile.photo || "";
    [avatar, headerAvatar].forEach(img => {
        if (!img) return;
        if (photo) {
            img.src = photo;
            img.onerror = () => {
                img.onerror = null;
                img.removeAttribute("src");
                img.alt = "Profile photo not available";
            };
        } else {
            img.removeAttribute("src");
        }
    });
}

function saveProfile(event) {
    if (event) event.preventDefault();
    const name = (document.getElementById("profileName")?.value || "").trim();
    const email = (document.getElementById("profileEmail")?.value || "").trim();
    const photo = (document.getElementById("profilePhoto")?.value || "").trim();

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast("Please enter a valid email address.", "info");
        return;
    }
    if (photo && !/^https?:\/\//i.test(photo)) {
        showToast("Profile photo must be an image URL starting with http:// or https://.", "info");
        return;
    }

    const profile = { name, email, photo };
    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
        updateProfileDisplay(profile);
        showToast("Profile saved in this browser.", "success");
    } catch (error) {
        showToast("Could not save the profile in this browser.", "info");
    }
}

function handleLogout() { showToast('This demo does not use login sessions.', 'info'); }
function showToast(msg, type='info') {
    const container = document.getElementById('toast-container'); if (!container) { alert(msg); return; }
    const toast = document.createElement('div'); const bg = type === 'success' ? 'bg-[#00f585] text-black font-semibold' : 'bg-[#12201c] border-[#00f585] text-white';
    toast.className = `px-4 py-3 rounded-xl border text-xs shadow-xl pointer-events-auto flex items-center justify-between gap-4 ${bg}`;
    const text = document.createElement('span'); text.textContent = msg; const close = document.createElement('button'); close.textContent = '×'; close.onclick = () => toast.remove(); toast.append(text, close); container.appendChild(toast); setTimeout(() => toast.remove(), 4000);
}
