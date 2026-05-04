let state = {
  members: [], matches: [], fundPayments: [], fixtures: [],
  currentTab: 'tabDashboard', currentFundPeriod: 7,
  selectedMonth: 'all'
};

const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbwTwIM-vhQir-WTdCksw6sstVUGl7lomLUxR_OQnpKvMQNgVOdF93S5xIqGJMJTgLFAqg/exec';

function init() {
  state.apiUrl = localStorage.getItem('fc_api_url') || DEFAULT_API_URL;
  state.members = JSON.parse(localStorage.getItem('fc_members') || 'null') || [...INITIAL_MEMBERS];
  state.matches = JSON.parse(localStorage.getItem('fc_matches') || 'null') || [...INITIAL_MATCHES];
  state.fundPayments = JSON.parse(localStorage.getItem('fc_fund') || 'null') || [...INITIAL_FUND_PAYMENTS];
  state.fixtures = JSON.parse(localStorage.getItem('fc_fixtures') || 'null') || [];
  const currentMonthName = `Quỹ T${new Date().getMonth()+1}/${new Date().getFullYear()}`;
  const currentPeriod = FUND_PERIODS.find(p => p.name === currentMonthName);
  state.currentFundPeriod = currentPeriod ? currentPeriod.id : FUND_PERIODS.length;
  updateSyncStatus();
  renderAll();
  syncFromSheet();
}

function save() {
  localStorage.setItem('fc_members', JSON.stringify(state.members));
  localStorage.setItem('fc_matches', JSON.stringify(state.matches));
  localStorage.setItem('fc_fund', JSON.stringify(state.fundPayments));
  localStorage.setItem('fc_fixtures', JSON.stringify(state.fixtures));
}

function fmt(n) {
  if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1).replace('.0','') + 'M';
  if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(0) + 'K';
  return n.toString();
}

function fmtDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString('vi-VN', {day:'2-digit',month:'2-digit',year:'numeric'});
}

function getMonthKey(d) { return d.substring(0,7); }

function classifyResult(r) {
  const l = r.toLowerCase().trim();
  if (l.includes('thắng')) return 'win';
  if (l.includes('thua')) return 'lose';
  if (l.includes('hòa') || l.includes('hoà') || l.includes('nội bộ') || l.includes('nghỉ') || l.includes('hủy') || l.includes('ko có') || l.includes('giao hữu')) return 'draw';
  return 'other';
}

function resultLabel(r) {
  const c = classifyResult(r);
  return c === 'win' ? 'W' : c === 'lose' ? 'L' : 'D';
}

function selectResult(res, el) {
  document.getElementById('matchResult').value = res;
  document.querySelectorAll('.result-option').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
}

function switchTab(el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  const tabId = el.dataset.tab;
  document.getElementById(tabId).classList.add('active');
  state.currentTab = tabId;
}

function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  setTimeout(() => t.classList.remove('show'), 2500);
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function handleFabClick() {
  const tab = state.currentTab;
  if (tab === 'tabMatches' || tab === 'tabDashboard') {
    document.getElementById('matchDate').value = new Date().toISOString().split('T')[0];
    openModal('modalMatch');
  } else if (tab === 'tabFund') {
    populateFundModal();
    openModal('modalFund');
  } else if (tab === 'tabMembers') {
    openModal('modalMember');
  } else if (tab === 'tabFixtures') {
    document.getElementById('fixtureId').value = '';
    document.getElementById('fixtureDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('fixtureOpponent').value = '';
    document.getElementById('fixtureVenue').value = '';
    document.getElementById('fixtureKitColor').value = '';
    document.getElementById('fixtureStatus').value = 'upcoming';
    document.getElementById('fixtureNote').value = '';
    document.getElementById('modalFixtureTitle').textContent = '📅 Lên kèo giao hữu';
    document.getElementById('btnDeleteFixture').style.display = 'none';
    openModal('modalFixture');
  }
}

function showSetup() { openModal('modalSetup'); }

function renderAll() {
  renderDashboard();
  renderMatches();
  renderFund();
  renderMembers();
  renderFixtures();
}

function renderDashboard() {
  const matches = state.matches;
  const totalCost = matches.reduce((s,m) => s + m.cost, 0);
  const totalFund = state.fundPayments.reduce((s,p) => s + p.amount, 0);
  const balance = totalFund - totalCost;
  const wins = matches.filter(m => classifyResult(m.result)==='win').length;
  const losses = matches.filter(m => classifyResult(m.result)==='lose').length;
  const draws = matches.filter(m => classifyResult(m.result)==='draw').length;

  const balEl = document.getElementById('statBalance');
  balEl.textContent = (balance >= 0 ? '+' : '') + fmt(balance) + 'đ';
  balEl.className = 'stat-value ' + (balance >= 0 ? 'positive' : 'negative');
  document.getElementById('statMatches').textContent = matches.length;
  document.getElementById('statMatches').className = 'stat-value';
  document.getElementById('statMembers').textContent = state.members.filter(m=>m.status==='active').length;
  document.getElementById('statMembers').className = 'stat-value';
  const tfEl = document.getElementById('statTotalFund');
  tfEl.textContent = fmt(totalFund) + 'đ';
  tfEl.className = 'stat-value positive';

  renderWinRateChart(wins, losses, draws);
  renderMonthlyChart();
  renderRecentMatches();
}

let winChart = null;
function renderWinRateChart(w, l, d) {
  const canvas = document.getElementById('winRateChart');
  if (winChart) winChart.destroy();
  winChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Thắng','Thua','Hòa/Khác'],
      datasets: [{
        data: [w, l, d],
        backgroundColor: ['#10b981','#ef4444','#f59e0b'],
        borderWidth: 0, borderRadius: 4
      }]
    },
    options: {
      cutout: '65%', responsive: false,
      plugins: { legend: { display: false } }
    }
  });
  const total = w + l + d;
  const pct = total ? Math.round(w/total*100) : 0;
  document.getElementById('winRateLegend').innerHTML =
    `<div class="legend-item"><span class="legend-dot" style="background:#10b981"></span>Thắng: ${w} (${pct}%)</div>` +
    `<div class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>Thua: ${l} (${Math.round(l/total*100)}%)</div>` +
    `<div class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span>Khác: ${d}</div>`;
}

let monthChart = null;
function renderMonthlyChart() {
  const months = {};
  state.matches.forEach(m => {
    const k = getMonthKey(m.date);
    months[k] = (months[k]||0) + m.cost;
  });
  const keys = Object.keys(months).sort();
  const labels = keys.map(k => { const [y,m]=k.split('-'); return `T${+m}/${y.slice(2)}`; });
  const canvas = document.getElementById('monthlyChart');
  if (monthChart) monthChart.destroy();
  monthChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: keys.map(k => months[k]),
        backgroundColor: 'rgba(16,185,129,0.3)',
        borderColor: '#10b981',
        borderWidth: 1, borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { color: '#6b7280', font: { size: 9 }, callback: v => fmt(v) }, grid: { color: '#333a4a' } }
      }
    }
  });
}

function renderRecentMatches() {
  const recent = [...state.matches].sort((a,b) => {
    const tA = a.timestamp || '';
    const tB = b.timestamp || '';
    if (tA && tB && tA !== tB) return tB.localeCompare(tA);
    return b.date.localeCompare(a.date);
  }).slice(0, 5);
  document.getElementById('recentCount').textContent = `${state.matches.length} trận`;
  document.getElementById('recentMatches').innerHTML = recent.map(m => matchItemHTML(m)).join('');
}

function matchItemHTML(m) {
  const cls = classifyResult(m.result);
  return `<div class="match-item">
    <div class="match-result-badge ${cls}">${resultLabel(m.result)}</div>
    <div class="match-info">
      <div class="match-opponent">${m.opponent || m.result}</div>
      <div class="match-date">${fmtDate(m.date)}${m.note ? ' · '+m.note : ''}</div>
    </div>
    <div class="match-cost">${fmt(m.cost)}đ</div>
  </div>`;
}

function renderMatches() {
  const months = [...new Set(state.matches.map(m => getMonthKey(m.date)))].sort().reverse();
  const sel = document.getElementById('matchMonthSelector');
  sel.innerHTML = `<div class="month-chip ${state.selectedMonth==='all'?'active':''}" onclick="filterMonth('all')">Tất cả</div>` +
    months.map(k => {
      const [y,m] = k.split('-');
      return `<div class="month-chip ${state.selectedMonth===k?'active':''}" onclick="filterMonth('${k}')">T${+m}/${y.slice(2)}</div>`;
    }).join('');

  let filtered = state.selectedMonth === 'all' ? state.matches : state.matches.filter(m => getMonthKey(m.date) === state.selectedMonth);
  filtered = [...filtered].sort((a,b) => {
    const tA = a.timestamp || '';
    const tB = b.timestamp || '';
    if (tA && tB && tA !== tB) return tB.localeCompare(tA);
    return b.date.localeCompare(a.date);
  });

  const w = filtered.filter(m=>classifyResult(m.result)==='win').length;
  const l = filtered.filter(m=>classifyResult(m.result)==='lose').length;
  const d = filtered.filter(m=>classifyResult(m.result)==='draw').length;
  const cost = filtered.reduce((s,m)=>s+m.cost,0);
  document.getElementById('sumWins').textContent = w;
  document.getElementById('sumLosses').textContent = l;
  document.getElementById('sumDraws').textContent = d;
  document.getElementById('sumCost').textContent = fmt(cost) + 'đ';
  document.getElementById('matchList').innerHTML = filtered.map(m => matchItemHTML(m)).join('') ||
    '<div class="empty-state"><p>Chưa có trận đấu nào</p></div>';
}

function filterMonth(m) { state.selectedMonth = m; renderMatches(); }

function renderFund() {
  const period = FUND_PERIODS[state.currentFundPeriod - 1];
  if (!period) return;
  document.getElementById('fundPeriodLabel').textContent = period.name;

  const payments = state.fundPayments.filter(p => p.period === period.id);
  const total = payments.reduce((s,p) => s + p.amount, 0);
  document.getElementById('fundPeriodTotal').textContent = fmt(total) + 'đ';

  const activeMembers = state.members.filter(m => m.status === 'active');
  const html = activeMembers.map(member => {
    const payment = payments.find(p => p.member === member.name);
    const initials = member.name.split(' ').slice(-1)[0][0];
    return `<div class="fund-row">
      <div class="fund-avatar">${initials}</div>
      <div class="fund-info">
        <div class="fund-name">${member.name}</div>
        <div class="fund-detail">${payment ? fmt(payment.amount)+'đ' : 'Chưa nộp'}</div>
      </div>
      <div class="fund-status ${payment ? 'paid' : 'unpaid'}">${payment ? '✓ Đã nộp' : '✗ Chưa'}</div>
    </div>`;
  }).join('');
  document.getElementById('fundList').innerHTML = html;
}

function changeFundPeriod(dir) {
  const next = state.currentFundPeriod + dir;
  if (next >= 1 && next <= FUND_PERIODS.length) {
    state.currentFundPeriod = next;
    renderFund();
  }
}

function renderMembers() {
  const colors = ['#1e3a5f','#3b1f5f','#5f1e3a','#1e5f3a','#5f3a1e','#3a1e5f'];
  document.getElementById('memberCount').textContent = `${state.members.length} thành viên`;
  document.getElementById('memberList').innerHTML = state.members.map((m, i) => {
    const initials = m.name.split(' ').slice(-1)[0][0];
    const bg = colors[i % colors.length];
    const totalPaid = state.fundPayments.filter(p => p.member === m.name).reduce((s,p) => s + p.amount, 0);
    return `<div class="member-card" onclick="openEditMember('${m.name}')">
      <div class="member-avatar" style="background:linear-gradient(135deg,${bg},${bg}cc)">${initials}</div>
      <div class="member-info">
        <div class="member-name">${m.name}</div>
        <div class="member-meta">
          <span>💼 ${m.role || 'Đi làm'}</span>
          <span>🎽 ${m.number || '—'}</span>
          <span>📐 ${m.size}</span>
          <span>💰 ${fmt(totalPaid)}đ</span>
        </div>
      </div>
      <div class="member-status ${m.status}">${m.status === 'active' ? 'Hoạt động' : 'Tạm nghỉ'}</div>
    </div>`;
  }).join('');
}

function renderFixtures() {
  document.getElementById('fixtureCount').textContent = `${state.fixtures.length} trận`;
  
  const sorted = [...state.fixtures].sort((a,b) => a.date.localeCompare(b.date));
  
  document.getElementById('fixtureList').innerHTML = sorted.map(f => {
    return `<div class="member-card" onclick="openEditFixture('${f.timestamp}')">
      <div class="member-avatar" style="background:#3b1f5f;border-radius:8px;font-size:1rem;padding:0 5px">${fmtDate(f.date).substring(0,5)}</div>
      <div class="member-info">
        <div class="member-name">${f.opponent}</div>
        <div class="member-meta">
          <span>📍 ${f.venue||'Chưa rõ'}</span>
          <span>👕 ${f.kitColor||'Chưa chốt'}</span>
          <span>📌 ${f.status==='upcoming'?'Sắp tới':f.status==='completed'?'Đã đá':'Hủy'}</span>
        </div>
      </div>
      ${f.status==='upcoming'?`<button class="btn btn-primary" style="padding:4px 8px;font-size:0.7rem;margin-left:auto" onclick="event.stopPropagation();completeFixture('${f.timestamp}')">Hoàn thành</button>`:''}
    </div>`;
  }).join('') || '<div class="empty-state"><p>Chưa có lịch thi đấu</p></div>';
}

function saveMatch() {
  const date = document.getElementById('matchDate').value;
  const opponent = document.getElementById('matchOpponent').value;
  const result = document.getElementById('matchResult').value;
  const cost = parseInt(document.getElementById('matchCost').value) || 0;
  const note = document.getElementById('matchNote').value;
  if (!date || !result) { showToast('Vui lòng điền ngày và kết quả', 'error'); return; }
  state.matches.push({ timestamp: new Date().toISOString(), date, opponent: opponent || result, result, cost, note, venue: document.getElementById('matchVenue').value });
  save(); renderAll(); closeModal('modalMatch');
  showToast('Đã thêm trận đấu ⚽');
  apiCall('/api/matches', 'POST', { date, opponent: opponent || result, venue: document.getElementById('matchVenue').value, result, cost, note });
}

function populateFundModal() {
  const selP = document.getElementById('fundPeriod');
  selP.innerHTML = FUND_PERIODS.map(p => `<option value="${p.id}" ${p.id===state.currentFundPeriod?'selected':''}>${p.name}</option>`).join('');
  const selM = document.getElementById('fundMember');
  selM.innerHTML = state.members.filter(m=>m.status==='active').map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  const period = FUND_PERIODS[state.currentFundPeriod - 1];
  document.getElementById('fundAmount').value = period ? period.amount : 500000;
}

function saveFund() {
  const periodId = parseInt(document.getElementById('fundPeriod').value);
  const member = document.getElementById('fundMember').value;
  const amount = parseInt(document.getElementById('fundAmount').value) || 0;
  if (!member || !amount) { showToast('Vui lòng điền đầy đủ', 'error'); return; }
  
  const existing = state.fundPayments.findIndex(p => p.period === periodId && p.member === member);
  if (existing >= 0) state.fundPayments[existing].amount = amount;
  else state.fundPayments.push({ period: periodId, member, amount, note: document.getElementById('fundNote').value });
  
  save(); renderAll(); closeModal('modalFund');
  showToast('Đã ghi nhận nộp quỹ 💰');
  
  const periodObj = FUND_PERIODS.find(p => p.id === periodId);
  const periodName = periodObj ? periodObj.name : `Đợt ${periodId}`;
  apiCall('/api/funds', 'POST', { period: periodName, member, amount, note: document.getElementById('fundNote').value });
}

function saveMember() {
  const name = document.getElementById('memberName').value.trim();
  const role = document.getElementById('memberRole').value;
  const number = parseInt(document.getElementById('memberNumber').value) || 0;
  const size = document.getElementById('memberSize').value;
  if (!name) { showToast('Vui lòng nhập tên', 'error'); return; }
  if (state.members.find(m => m.name === name)) { showToast('Thành viên đã tồn tại', 'error'); return; }
  state.members.push({ name, role, number, size, status: 'active' });
  save(); renderAll(); closeModal('modalMember');
  showToast('Đã thêm thành viên 👤');
  apiCall('/api/members', 'POST', { name, role, number, size, status: 'active' });
}

function openEditMember(name) {
  const m = state.members.find(x => x.name === name);
  if (!m) return;
  document.getElementById('editMemberOriginalName').value = m.name;
  document.getElementById('editMemberName').value = m.name;
  document.getElementById('editMemberRole').value = m.role || 'Đi làm';
  document.getElementById('editMemberStatus').value = m.status || 'active';
  document.getElementById('editMemberNumber').value = m.number || '';
  document.getElementById('editMemberSize').value = m.size || 'M';
  openModal('modalMemberEdit');
}

function updateMember() {
  const origName = document.getElementById('editMemberOriginalName').value;
  const name = document.getElementById('editMemberName').value.trim();
  const role = document.getElementById('editMemberRole').value;
  const status = document.getElementById('editMemberStatus').value;
  const number = parseInt(document.getElementById('editMemberNumber').value) || 0;
  const size = document.getElementById('editMemberSize').value;
  
  if (!name) return showToast('Vui lòng nhập tên', 'error');
  const m = state.members.find(x => x.name === origName);
  if (!m) return;
  
  m.name = name; m.role = role; m.status = status; m.number = number; m.size = size;
  save(); renderAll(); closeModal('modalMemberEdit'); showToast('Đã cập nhật 👤');
  apiCall('/api/members', 'PUT', { origName, name, role, status, number, size });
}

function deleteMember() {
  if (!confirm('Bạn có chắc muốn xóa thành viên này?')) return;
  const origName = document.getElementById('editMemberOriginalName').value;
  state.members = state.members.filter(x => x.name !== origName);
  save(); renderAll(); closeModal('modalMemberEdit'); showToast('Đã xóa 🗑️');
  apiCall('/api/members', 'DELETE', { origName });
}

function openEditFixture(ts) {
  const f = state.fixtures.find(x => x.timestamp === ts);
  if (!f) return;
  document.getElementById('fixtureId').value = f.timestamp;
  document.getElementById('fixtureDate').value = f.date;
  document.getElementById('fixtureOpponent').value = f.opponent;
  document.getElementById('fixtureVenue').value = f.venue;
  document.getElementById('fixtureKitColor').value = f.kitColor;
  document.getElementById('fixtureStatus').value = f.status;
  document.getElementById('fixtureNote').value = f.note;
  
  document.getElementById('modalFixtureTitle').textContent = '✏️ Sửa lịch đấu';
  document.getElementById('btnDeleteFixture').style.display = 'block';
  openModal('modalFixture');
}

function saveFixture() {
  const id = document.getElementById('fixtureId').value;
  const date = document.getElementById('fixtureDate').value;
  const opponent = document.getElementById('fixtureOpponent').value.trim();
  const venue = document.getElementById('fixtureVenue').value.trim();
  const kitColor = document.getElementById('fixtureKitColor').value.trim();
  const status = document.getElementById('fixtureStatus').value;
  const note = document.getElementById('fixtureNote').value.trim();
  
  if (!date || !opponent) return showToast('Vui lòng điền Ngày và Đối thủ', 'error');
  
  if (id) {
    const f = state.fixtures.find(x => x.timestamp === id);
    if (f) {
      f.date = date; f.opponent = opponent; f.venue = venue; f.kitColor = kitColor; f.status = status; f.note = note;
      apiCall('/api/fixtures', 'PUT', { id, date, opponent, venue, kitColor, status, note });
    }
  } else {
    const newTs = new Date().toISOString();
    state.fixtures.push({ timestamp: newTs, date, opponent, venue, kitColor, status, note });
    apiCall('/api/fixtures', 'POST', { date, opponent, venue, kitColor, status, note });
  }
  save(); renderAll(); closeModal('modalFixture'); showToast('Đã lưu lịch đấu 📅');
}

function deleteFixture() {
  if (!confirm('Xóa lịch thi đấu này?')) return;
  const id = document.getElementById('fixtureId').value;
  state.fixtures = state.fixtures.filter(x => x.timestamp !== id);
  save(); renderAll(); closeModal('modalFixture'); showToast('Đã xóa 🗑️');
  apiCall('/api/fixtures', 'DELETE', { id });
}

function completeFixture(ts) {
  const f = state.fixtures.find(x => x.timestamp === ts);
  if (!f) return;
  
  document.getElementById('matchDate').value = f.date;
  document.getElementById('matchOpponent').value = f.opponent;
  document.getElementById('matchVenue').value = f.venue;
  openModal('modalMatch');
  
  f.status = 'completed';
  save(); renderAll();
  apiCall('/api/fixtures', 'PUT', { id: f.timestamp, date: f.date, opponent: f.opponent, venue: f.venue, kitColor: f.kitColor, status: 'completed', note: f.note });
}

async function apiCall(endpoint, method, body) {
  try {
    await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    console.error('API Error:', e);
  }
}

function updateSyncStatus() {
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  dot.style.background = '#10b981';
  text.textContent = 'Đã kết nối';
}

function connectApi() {
  closeModal('modalSetup');
  syncFromSheet();
}

async function syncFromSheet() {
  try {
    const res = await fetch('/api/init');
    const data = await res.json();
    if (data.members) { state.members = data.members; }
    if (data.matches) { state.matches = data.matches; }
    if (data.fixtures) { state.fixtures = data.fixtures; }
    if (data.fundPayments) {
      state.fundPayments = data.fundPayments.map(p => {
        const pd = FUND_PERIODS.find(f => f.name === p.period);
        return { ...p, period: pd ? pd.id : 0 };
      });
    }
    save(); renderAll();
    showToast('Đồng bộ thành công ✅');
  } catch(e) {
    showToast('Lỗi đồng bộ dữ liệu', 'error');
  }
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});

document.addEventListener('DOMContentLoaded', init);
