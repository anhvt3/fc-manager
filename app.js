let state = {
  members: [], matches: [], fundPayments: [], fixtures: [],
  currentTab: 'tabDashboard', currentFundPeriod: 7,
  selectedMonth: 'all',
  pendingWrites: 0,
  initialSynced: false
};

const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbwTwIM-vhQir-WTdCksw6sstVUGl7lomLUxR_OQnpKvMQNgVOdF93S5xIqGJMJTgLFAqg/exec';

function safeParse(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (e) {
    console.warn('Corrupt localStorage key', key, '— resetting');
    localStorage.removeItem(key);
    return fallback;
  }
}

function init() {
  state.apiUrl = localStorage.getItem('fc_api_url') || DEFAULT_API_URL;
  state.members = safeParse('fc_members', null) || [...INITIAL_MEMBERS];
  state.matches = safeParse('fc_matches', null) || [...INITIAL_MATCHES];
  state.fundPayments = safeParse('fc_fund', null) || [...INITIAL_FUND_PAYMENTS];
  state.fixtures = safeParse('fc_fixtures', null) || [];
  const currentMonthName = `Quỹ T${new Date().getMonth() + 1}/${new Date().getFullYear()}`;
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
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v.toString();
}

// Safari iOS không parse được "yyyy-MM-dd HH:mm:ss" với space — normalize trước
function parseDateSafe(d) {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  const s = String(d).trim().replace(' ', 'T');
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

function fmtDate(d) {
  const dt = parseDateSafe(d);
  if (!dt) return String(d || '—');
  return dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getMonthKey(d) { return (d || '').toString().substring(0, 7); }

function safeInitial(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/);
  const last = parts[parts.length - 1] || '';
  return (last[0] || s[0] || '?').toUpperCase();
}

function classifyResult(r) {
  const l = String(r || '').toLowerCase().trim();
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
  if (el) {
    const sel = el.closest('.result-selector');
    if (sel) sel.querySelectorAll('.result-option').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
  }
}

function selectEditResult(res, el) {
  document.getElementById('editMatchResult').value = res;
  if (el) {
    const sel = el.closest('.result-selector');
    if (sel) sel.querySelectorAll('.result-option').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
  }
}

function switchTab(el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  const tabId = el.dataset.tab;
  document.getElementById(tabId).classList.add('active');
  state.currentTab = tabId;
}

function showToast(msg, type = 'success') {
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
  const totalCost = matches.reduce((s, m) => s + (Number(m.cost) || 0), 0);
  const totalFund = state.fundPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balance = totalFund - totalCost;
  const wins = matches.filter(m => classifyResult(m.result) === 'win').length;
  const losses = matches.filter(m => classifyResult(m.result) === 'lose').length;
  const draws = matches.filter(m => classifyResult(m.result) === 'draw').length;

  const balEl = document.getElementById('statBalance');
  balEl.textContent = (balance < 0 ? '-' : '') + fmt(Math.abs(balance)) + 'đ';
  balEl.className = 'stat-value ' + (balance >= 0 ? 'positive' : 'negative');
  document.getElementById('statMatches').textContent = matches.length;
  document.getElementById('statMatches').className = 'stat-value';
  document.getElementById('statMembers').textContent = state.members.filter(m => m.status === 'active').length;
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
      labels: ['Thắng', 'Thua', 'Hòa/Khác'],
      datasets: [{
        data: [w, l, d],
        backgroundColor: ['#10b981', '#ef4444', '#f59e0b'],
        borderWidth: 0, borderRadius: 4
      }]
    },
    options: {
      cutout: '65%', responsive: false,
      plugins: { legend: { display: false } }
    }
  });
  const total = w + l + d;
  const pctW = total ? Math.round(w / total * 100) : 0;
  const pctL = total ? Math.round(l / total * 100) : 0;
  document.getElementById('winRateLegend').innerHTML =
    `<div class="legend-item"><span class="legend-dot" style="background:#10b981"></span>Thắng: ${w} (${pctW}%)</div>` +
    `<div class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>Thua: ${l} (${pctL}%)</div>` +
    `<div class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span>Khác: ${d}</div>`;
}

let monthChart = null;
function renderMonthlyChart() {
  const months = {};
  state.matches.forEach(m => {
    const k = getMonthKey(m.date);
    if (!k) return;
    months[k] = (months[k] || 0) + (Number(m.cost) || 0);
  });
  const keys = Object.keys(months).sort();
  const labels = keys.map(k => { const [y, m] = k.split('-'); return `T${+m}/${y.slice(2)}`; });
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
  const recent = [...state.matches].sort((a, b) => {
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
  const safeTs = String(m.timestamp || '').replace(/'/g, "\\'");
  return `<div class="match-item" onclick="openEditMatch('${safeTs}')" style="cursor:pointer">
    <div class="match-result-badge ${cls}">${resultLabel(m.result)}</div>
    <div class="match-info">
      <div class="match-opponent">${m.opponent || m.result}</div>
      <div class="match-date">${fmtDate(m.date)}${m.note ? ' · ' + m.note : ''}</div>
    </div>
    <div class="match-cost">${fmt(m.cost)}đ</div>
  </div>`;
}

function renderMatches() {
  const months = [...new Set(state.matches.map(m => getMonthKey(m.date)))].sort().reverse();
  const sel = document.getElementById('matchMonthSelector');
  sel.innerHTML = `<div class="month-chip ${state.selectedMonth === 'all' ? 'active' : ''}" onclick="filterMonth('all')">Tất cả</div>` +
    months.map(k => {
      const [y, m] = k.split('-');
      return `<div class="month-chip ${state.selectedMonth === k ? 'active' : ''}" onclick="filterMonth('${k}')">T${+m}/${y.slice(2)}</div>`;
    }).join('');

  let filtered = state.selectedMonth === 'all' ? state.matches : state.matches.filter(m => getMonthKey(m.date) === state.selectedMonth);
  filtered = [...filtered].sort((a, b) => {
    const tA = a.timestamp || '';
    const tB = b.timestamp || '';
    if (tA && tB && tA !== tB) return tB.localeCompare(tA);
    return String(b.date || '').localeCompare(String(a.date || ''));
  });

  const w = filtered.filter(m => classifyResult(m.result) === 'win').length;
  const l = filtered.filter(m => classifyResult(m.result) === 'lose').length;
  const d = filtered.filter(m => classifyResult(m.result) === 'draw').length;
  const cost = filtered.reduce((s, m) => s + (Number(m.cost) || 0), 0);
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
  const total = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  document.getElementById('fundPeriodTotal').textContent = fmt(total) + 'đ';

  const activeMembers = state.members.filter(m => m.status === 'active');
  const html = activeMembers.map(member => {
    const payment = payments.find(p => p.member === member.name);
    const initials = safeInitial(member.name);
    return `<div class="fund-row">
      <div class="fund-avatar">${initials}</div>
      <div class="fund-info">
        <div class="fund-name">${member.name}</div>
        <div class="fund-detail">${payment ? fmt(payment.amount) + 'đ' : 'Chưa nộp'}</div>
      </div>
      <div class="fund-status ${payment ? 'paid' : 'unpaid'}">${payment ? '✓ Đã nộp' : '✗ Chưa'}</div>
    </div>`;
  }).join('') || '<div class="empty-state"><p>Chưa có thành viên hoạt động</p></div>';
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
  const colors = ['#1e3a5f', '#3b1f5f', '#5f1e3a', '#1e5f3a', '#5f3a1e', '#3a1e5f'];
  document.getElementById('memberCount').textContent = `${state.members.length} thành viên`;
  document.getElementById('memberList').innerHTML = state.members.map((m, i) => {
    const initials = safeInitial(m.name);
    const bg = colors[i % colors.length];
    const totalPaid = state.fundPayments.filter(p => p.member === m.name).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const safeName = String(m.name || '').replace(/'/g, "\\'");
    return `<div class="member-card" onclick="openEditMember('${safeName}')">
      <div class="member-avatar" style="background:linear-gradient(135deg,${bg},${bg}cc)">${initials}</div>
      <div class="member-info">
        <div class="member-name">${m.name}</div>
        <div class="member-meta">
          <span>💼 ${m.role || 'Đi làm'}</span>
          <span>🎽 ${m.number || '—'}</span>
          <span>📐 ${m.size || 'M'}</span>
          <span>💰 ${fmt(totalPaid)}đ</span>
        </div>
      </div>
      <div class="member-status ${m.status || 'active'}">${m.status === 'paused' ? 'Tạm nghỉ' : 'Hoạt động'}</div>
    </div>`;
  }).join('') || '<div class="empty-state"><p>Chưa có thành viên</p></div>';
}

function renderFixtures() {
  document.getElementById('fixtureCount').textContent = `${state.fixtures.length} trận`;

  const sorted = [...state.fixtures].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  document.getElementById('fixtureList').innerHTML = sorted.map(f => {
    return `<div class="member-card" onclick="openEditFixture('${f.timestamp}')">
      <div class="member-avatar" style="background:#3b1f5f;border-radius:8px;font-size:1rem;padding:0 5px">${fmtDate(f.date).substring(0, 5)}</div>
      <div class="member-info">
        <div class="member-name">${f.opponent}</div>
        <div class="member-meta">
          <span>📍 ${f.venue || 'Chưa rõ'}</span>
          <span>👕 ${f.kitColor || 'Chưa chốt'}</span>
          <span>📌 ${f.status === 'upcoming' ? 'Sắp tới' : f.status === 'completed' ? 'Đã đá' : 'Hủy'}</span>
        </div>
      </div>
      ${f.status === 'upcoming' ? `<button class="btn btn-primary" style="width:auto;padding:6px 10px;font-size:0.7rem;margin-left:auto;flex-shrink:0" onclick="event.stopPropagation();completeFixture('${f.timestamp}')">✅ Xong</button>` : ''}
    </div>`;
  }).join('') || '<div class="empty-state"><p>Chưa có lịch thi đấu</p></div>';
}

async function saveMatch(btn) {
  const date = document.getElementById('matchDate').value;
  const opponent = document.getElementById('matchOpponent').value;
  const result = document.getElementById('matchResult').value;
  const cost = parseInt(document.getElementById('matchCost').value) || 0;
  const note = document.getElementById('matchNote').value;
  const venue = document.getElementById('matchVenue').value;
  const linkedFixtureId = document.getElementById('matchLinkedFixture')?.value || '';
  if (!date || !result) { showToast('Vui lòng điền ngày và kết quả', 'error'); return; }

  const lock = lockButton(btn || event?.target);
  const newMatch = { timestamp: new Date().toISOString(), date, opponent: opponent || result, result, cost, note, venue };
  state.matches.push(newMatch);
  save(); renderAll(); closeModal('modalMatch');

  const ok = await apiCall('/api/matches', 'POST', { date, opponent: opponent || result, venue, result, cost, note });
  if (!ok) {
    state.matches = state.matches.filter(m => m !== newMatch);
    save(); renderAll();
    showToast('Lỗi mạng — đã hoàn tác trận đấu', 'error');
    lock.release(); return;
  }
  // Sync timestamp local với server để edit/delete ngay sau add work được (id phải khớp Sheet)
  if (ok.timestamp) { newMatch.timestamp = ok.timestamp; save(); }
  // Nếu trận đấu được tạo từ "Hoàn thành" fixture, cập nhật fixture status
  if (linkedFixtureId) {
    const f = state.fixtures.find(x => x.timestamp === linkedFixtureId);
    if (f) {
      f.status = 'completed';
      save(); renderAll();
      apiCall('/api/fixtures', 'PUT', { id: f.timestamp, date: f.date, opponent: f.opponent, venue: f.venue, kitColor: f.kitColor, status: 'completed', note: f.note });
    }
    document.getElementById('matchLinkedFixture').value = '';
  }
  showToast('Đã thêm trận đấu ⚽');
  lock.release();
}

function populateFundModal() {
  const selP = document.getElementById('fundPeriod');
  selP.innerHTML = FUND_PERIODS.map(p => `<option value="${p.id}" ${p.id === state.currentFundPeriod ? 'selected' : ''}>${p.name}</option>`).join('');
  const selM = document.getElementById('fundMember');
  selM.innerHTML = state.members.filter(m => m.status === 'active').map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  const period = FUND_PERIODS[state.currentFundPeriod - 1];
  document.getElementById('fundAmount').value = period ? period.amount : 500000;
}

async function saveFund(btn) {
  const periodId = parseInt(document.getElementById('fundPeriod').value);
  const member = document.getElementById('fundMember').value;
  const amount = parseInt(document.getElementById('fundAmount').value) || 0;
  const note = document.getElementById('fundNote').value;
  if (!member || !amount) { showToast('Vui lòng điền đầy đủ', 'error'); return; }

  const lock = lockButton(btn || event?.target);
  const periodObj = FUND_PERIODS.find(p => p.id === periodId);
  const periodName = periodObj ? periodObj.name : `Đợt ${periodId}`;

  const existing = state.fundPayments.findIndex(p => p.period === periodId && p.member === member);
  const isUpdate = existing >= 0;
  const prevSnapshot = isUpdate ? { ...state.fundPayments[existing] } : null;

  if (isUpdate) state.fundPayments[existing] = { ...state.fundPayments[existing], amount, note };
  else state.fundPayments.push({ period: periodId, member, amount, note });

  save(); renderAll(); closeModal('modalFund');

  // PUT khi update để tránh duplicate row trên Sheet, POST khi tạo mới
  const ok = isUpdate
    ? await apiCall('/api/funds', 'PUT', { period: periodName, member, amount, note })
    : await apiCall('/api/funds', 'POST', { period: periodName, member, amount, note });

  if (!ok) {
    if (isUpdate && prevSnapshot) state.fundPayments[existing] = prevSnapshot;
    else state.fundPayments.pop();
    save(); renderAll();
    showToast('Lỗi mạng — đã hoàn tác', 'error');
    lock.release(); return;
  }
  showToast('Đã ghi nhận nộp quỹ 💰');
  lock.release();
}

async function saveMember(btn) {
  const name = document.getElementById('memberName').value.trim();
  const role = document.getElementById('memberRole').value;
  const number = parseInt(document.getElementById('memberNumber').value) || 0;
  const size = document.getElementById('memberSize').value;
  if (!name) { showToast('Vui lòng nhập tên', 'error'); return; }
  if (state.members.find(m => m.name === name)) { showToast('Thành viên đã tồn tại', 'error'); return; }

  const lock = lockButton(btn || event?.target);
  const newMember = { name, role, number, size, status: 'active' };
  state.members.push(newMember);
  save(); renderAll(); closeModal('modalMember');

  const ok = await apiCall('/api/members', 'POST', newMember);
  if (!ok) {
    state.members = state.members.filter(m => m !== newMember);
    save(); renderAll();
    showToast('Lỗi mạng — đã hoàn tác', 'error');
    lock.release(); return;
  }
  showToast('Đã thêm thành viên 👤');
  lock.release();
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

async function updateMember(btn) {
  const origName = document.getElementById('editMemberOriginalName').value;
  const name = document.getElementById('editMemberName').value.trim();
  const role = document.getElementById('editMemberRole').value;
  const status = document.getElementById('editMemberStatus').value;
  const number = parseInt(document.getElementById('editMemberNumber').value) || 0;
  const size = document.getElementById('editMemberSize').value;

  if (!name) return showToast('Vui lòng nhập tên', 'error');
  const m = state.members.find(x => x.name === origName);
  if (!m) return;

  const lock = lockButton(btn || event?.target);
  const prev = { ...m };
  m.name = name; m.role = role; m.status = status; m.number = number; m.size = size;

  // Cascade rename: cập nhật fund payments local nếu đổi tên
  let renamedFunds = [];
  if (origName !== name) {
    state.fundPayments.forEach(p => {
      if (p.member === origName) { renamedFunds.push(p); p.member = name; }
    });
  }
  save(); renderAll(); closeModal('modalMemberEdit');

  const ok = await apiCall('/api/members', 'PUT', { origName, name, role, status, number, size });
  if (!ok) {
    Object.assign(m, prev);
    renamedFunds.forEach(p => p.member = origName);
    save(); renderAll();
    showToast('Lỗi mạng — đã hoàn tác', 'error');
    lock.release(); return;
  }
  showToast('Đã cập nhật 👤');
  lock.release();
}

async function deleteMember(btn) {
  if (!confirm('Bạn có chắc muốn xóa thành viên này?')) return;
  const origName = document.getElementById('editMemberOriginalName').value;
  const lock = lockButton(btn || event?.target);
  const prevMembers = [...state.members];
  state.members = state.members.filter(x => x.name !== origName);
  save(); renderAll(); closeModal('modalMemberEdit');

  const ok = await apiCall('/api/members', 'DELETE', { origName });
  if (!ok) {
    state.members = prevMembers;
    save(); renderAll();
    showToast('Lỗi mạng — đã hoàn tác xóa', 'error');
    lock.release(); return;
  }
  showToast('Đã xóa 🗑️');
  lock.release();
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

async function saveFixture(btn) {
  const id = document.getElementById('fixtureId').value;
  const date = document.getElementById('fixtureDate').value;
  const opponent = document.getElementById('fixtureOpponent').value.trim();
  const venue = document.getElementById('fixtureVenue').value.trim();
  const kitColor = document.getElementById('fixtureKitColor').value.trim();
  const status = document.getElementById('fixtureStatus').value;
  const note = document.getElementById('fixtureNote').value.trim();

  if (!date || !opponent) return showToast('Vui lòng điền Ngày và Đối thủ', 'error');

  const lock = lockButton(btn || event?.target);
  let rollback;

  if (id) {
    const f = state.fixtures.find(x => x.timestamp === id);
    if (!f) { lock.release(); return; }
    const prev = { ...f };
    f.date = date; f.opponent = opponent; f.venue = venue; f.kitColor = kitColor; f.status = status; f.note = note;
    rollback = () => Object.assign(f, prev);
    save(); renderAll(); closeModal('modalFixture');
    const ok = await apiCall('/api/fixtures', 'PUT', { id, date, opponent, venue, kitColor, status, note });
    if (!ok) { rollback(); save(); renderAll(); showToast('Lỗi mạng — đã hoàn tác', 'error'); lock.release(); return; }
  } else {
    const newTs = new Date().toISOString();
    const newFix = { timestamp: newTs, date, opponent, venue, kitColor, status, note };
    state.fixtures.push(newFix);
    rollback = () => { state.fixtures = state.fixtures.filter(x => x !== newFix); };
    save(); renderAll(); closeModal('modalFixture');
    const ok = await apiCall('/api/fixtures', 'POST', { date, opponent, venue, kitColor, status, note });
    if (!ok) { rollback(); save(); renderAll(); showToast('Lỗi mạng — đã hoàn tác', 'error'); lock.release(); return; }
    if (ok.timestamp) { newFix.timestamp = ok.timestamp; save(); renderAll(); }
  }
  showToast('Đã lưu lịch đấu 📅');
  lock.release();
}

async function deleteFixture(btn) {
  if (!confirm('Xóa lịch thi đấu này?')) return;
  const id = document.getElementById('fixtureId').value;
  const lock = lockButton(btn || event?.target);
  const prev = [...state.fixtures];
  state.fixtures = state.fixtures.filter(x => x.timestamp !== id);
  save(); renderAll(); closeModal('modalFixture');
  const ok = await apiCall('/api/fixtures', 'DELETE', { id });
  if (!ok) {
    state.fixtures = prev;
    save(); renderAll();
    showToast('Lỗi mạng — đã hoàn tác xóa', 'error');
    lock.release(); return;
  }
  showToast('Đã xóa 🗑️');
  lock.release();
}

function openEditMatch(ts) {
  const m = state.matches.find(x => x.timestamp === ts);
  if (!m) return;
  document.getElementById('editMatchId').value = m.timestamp;
  // date có thể là "2025-02-07 00:00:00" — input type=date cần "yyyy-MM-dd"
  const dateOnly = String(m.date || '').substring(0, 10);
  document.getElementById('editMatchDate').value = dateOnly;
  document.getElementById('editMatchOpponent').value = m.opponent || '';
  document.getElementById('editMatchVenue').value = m.venue || '';
  document.getElementById('editMatchResult').value = m.result || '';
  document.getElementById('editMatchCost').value = Number(m.cost) || 0;
  document.getElementById('editMatchNote').value = m.note || '';

  // highlight result option
  const sel = document.querySelector('#modalMatchEdit .result-selector');
  if (sel) {
    sel.querySelectorAll('.result-option').forEach(n => {
      n.classList.toggle('active', n.textContent.trim().startsWith(String(m.result || '').trim()));
    });
  }
  openModal('modalMatchEdit');
}

async function updateMatch(btn) {
  const id = document.getElementById('editMatchId').value;
  const date = document.getElementById('editMatchDate').value;
  const opponent = document.getElementById('editMatchOpponent').value.trim();
  const venue = document.getElementById('editMatchVenue').value.trim();
  const result = document.getElementById('editMatchResult').value;
  const cost = parseInt(document.getElementById('editMatchCost').value) || 0;
  const note = document.getElementById('editMatchNote').value.trim();

  if (!date || !result) return showToast('Vui lòng điền ngày và kết quả', 'error');
  const m = state.matches.find(x => x.timestamp === id);
  if (!m) return;

  const lock = lockButton(btn || event?.target);
  const prev = { ...m };
  m.date = date; m.opponent = opponent || result; m.venue = venue; m.result = result; m.cost = cost; m.note = note;
  save(); renderAll(); closeModal('modalMatchEdit');

  const ok = await apiCall('/api/matches', 'PUT', { id, date, opponent: opponent || result, venue, result, cost, note });
  if (!ok) {
    Object.assign(m, prev);
    save(); renderAll();
    showToast('Lỗi mạng — đã hoàn tác', 'error');
    lock.release(); return;
  }
  showToast('Đã cập nhật trận đấu ⚽');
  lock.release();
}

async function deleteMatch(btn) {
  if (!confirm('Xóa trận đấu này?')) return;
  const id = document.getElementById('editMatchId').value;
  const lock = lockButton(btn || event?.target);
  const prev = [...state.matches];
  state.matches = state.matches.filter(x => x.timestamp !== id);
  save(); renderAll(); closeModal('modalMatchEdit');

  const ok = await apiCall('/api/matches', 'DELETE', { id });
  if (!ok) {
    state.matches = prev;
    save(); renderAll();
    showToast('Lỗi mạng — đã hoàn tác xóa', 'error');
    lock.release(); return;
  }
  showToast('Đã xóa 🗑️');
  lock.release();
}

// Mở modal match từ một fixture; KHÔNG set fixture status ở đây.
// saveMatch() sẽ cập nhật fixture status sau khi POST match thành công.
function completeFixture(ts) {
  const f = state.fixtures.find(x => x.timestamp === ts);
  if (!f) return;

  document.getElementById('matchDate').value = f.date;
  document.getElementById('matchOpponent').value = f.opponent;
  document.getElementById('matchVenue').value = f.venue || '';
  document.getElementById('matchResult').value = '';
  document.getElementById('matchCost').value = '';
  document.getElementById('matchNote').value = '';
  document.querySelectorAll('.result-option').forEach(n => n.classList.remove('active'));

  // Lưu fixture id ẩn để saveMatch dùng
  let hidden = document.getElementById('matchLinkedFixture');
  if (!hidden) {
    hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = 'matchLinkedFixture';
    document.getElementById('modalMatch').appendChild(hidden);
  }
  hidden.value = ts;

  openModal('modalMatch');
}

// apiCall trả về object data từ server khi OK, null khi fail. Mọi caller dùng `if (!res)` để rollback.
async function apiCall(endpoint, method, body) {
  state.pendingWrites++;
  try {
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      console.error('API non-OK:', endpoint, res.status);
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (data && data.error) {
      console.error('API error payload:', endpoint, data.error);
      return null;
    }
    // Đảm bảo trả về truthy object kể cả khi server trả {} (rỗng)
    return data && Object.keys(data).length ? data : { status: 'ok' };
  } catch (e) {
    console.error('API Error:', endpoint, e);
    return null;
  } finally {
    state.pendingWrites = Math.max(0, state.pendingWrites - 1);
  }
}

// Disable button và hiện loading nhẹ trong khi chờ network. Tránh double-submit.
function lockButton(btn) {
  if (!btn || !btn.tagName) return { release: () => { } };
  const prevDisabled = btn.disabled;
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.dataset._origText = prevText;
  if (!btn.textContent.includes('…')) btn.textContent = '… đang lưu';
  return {
    release: () => {
      btn.disabled = prevDisabled;
      if (btn.dataset._origText !== undefined) {
        btn.textContent = btn.dataset._origText;
        delete btn.dataset._origText;
      }
    }
  };
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

async function syncFromSheet(force = false) {
  // Tránh ghi đè local khi đang có write chưa xác nhận. Lần boot đầu thì bỏ qua check
  // (vì lúc đó chưa có pending write nào).
  if (!force && state.pendingWrites > 0) {
    console.warn('syncFromSheet: skipping — có write đang pending');
    return;
  }
  try {
    const res = await fetch('/api/init');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data && data.error) throw new Error(data.error);
    if (Array.isArray(data.members)) { state.members = data.members; }
    if (Array.isArray(data.matches)) { state.matches = data.matches; }
    if (Array.isArray(data.fixtures)) { state.fixtures = data.fixtures; }
    if (Array.isArray(data.fundPayments)) {
      state.fundPayments = data.fundPayments.map(p => {
        const pd = FUND_PERIODS.find(f => f.name === p.period);
        return { ...p, period: pd ? pd.id : 0, amount: Number(p.amount) || 0 };
      });
    }
    state.initialSynced = true;
    save(); renderAll();
    showToast('Đồng bộ thành công ✅');
  } catch (e) {
    console.error('Sync error:', e);
    showToast('Lỗi đồng bộ dữ liệu', 'error');
  }
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});

document.addEventListener('DOMContentLoaded', init);
