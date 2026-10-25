/**
 * ROADSTER DASH CASH - CONTROLADOR DO PAINEL ADMINISTRATIVO
 */

const Admin = {
  token: localStorage.getItem('roadster_admin_token') || localStorage.getItem('roadster_token') || '',
  users: [],
  selectedUserId: null,

  formatBRL(cents) {
    return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },

  async api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const res = await fetch(url, { ...options, headers });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        this.showLogin();
      }
      throw new Error(data.error || 'Erro na requisição');
    }
    return data;
  },

  async init() {
    if (!this.token) {
      this.showLogin();
      return;
    }
    try {
      const me = await this.api('/api/auth/me');
      if (me.role !== 'admin' && me.username !== 'diseguro20') {
        alert('Acesso restrito para administradores.');
        this.showLogin();
        return;
      }
      document.getElementById('admin-user-display').textContent = me.username;
      document.getElementById('admin-login-modal').style.display = 'none';
      document.getElementById('admin-app').style.display = 'flex';
      this.loadStats();
      this.loadUsers();
      this.loadSettings();
    } catch (_) {
      this.showLogin();
    }
  },

  showLogin() {
    document.getElementById('admin-app').style.display = 'none';
    document.getElementById('admin-login-modal').style.display = 'flex';
  },

  async login() {
    const login = document.getElementById('admin-login-user').value.trim();
    const pass = document.getElementById('admin-login-pass').value;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password: pass })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha no login');
      this.token = data.token;
      localStorage.setItem('roadster_admin_token', data.token);
      this.init();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  logout() {
    localStorage.removeItem('roadster_admin_token');
    location.reload();
  },

  showTab(tabName, el) {
    document.querySelectorAll('.admin-tab').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    if (el) el.classList.add('active');

    const titles = {
      overview: 'Visão Geral',
      users: 'Gestão de Jogadores & Influenciadores',
      deposits: 'Depósitos PIX VizzionPay',
      withdrawals: 'Solicitações de Saque PIX',
      settings: 'Configurações da Plataforma & Dificuldade'
    };
    document.getElementById('admin-section-title').textContent = titles[tabName] || 'Painel';

    if (tabName === 'overview') this.loadStats();
    if (tabName === 'users') this.loadUsers();
    if (tabName === 'deposits') this.loadDeposits();
    if (tabName === 'withdrawals') this.loadWithdrawals();
    if (tabName === 'settings') this.loadSettings();
  },

  async loadStats() {
    try {
      const d = await this.api('/api/admin/stats');
      document.getElementById('stat-users').textContent = d.totalUsers;
      document.getElementById('stat-influencers').textContent = `${d.influencersCount} influenciadores ativos`;
      document.getElementById('stat-bets').textContent = this.formatBRL(d.totalBets);
      document.getElementById('stat-games').textContent = `${d.totalGames} corridas realizadas`;
      document.getElementById('stat-payouts').textContent = this.formatBRL(d.totalPayouts);
      document.getElementById('stat-winloss').textContent = `${d.wins} vitórias • ${d.losses} derrotas`;
      document.getElementById('stat-profit').textContent = this.formatBRL(d.houseProfit);
      document.getElementById('stat-dep-vol').textContent = this.formatBRL(d.totalDepositsVolume);
      document.getElementById('stat-dep-counts').textContent = `${d.approvedDeposits} aprovados • ${d.pendingDeposits} pendentes`;
      document.getElementById('stat-with-pend').textContent = d.pendingWithdrawals;
      document.getElementById('stat-wallets').textContent = this.formatBRL(d.totalWalletBalance);

      const diffLabels = {
        hard: '🔥 MUITO DIFÍCIL',
        impossible: '💀 IMPOSSÍVEL',
        balanced: '⚖️ EQUILIBRADO',
        influencer: '⭐ MODO INFLUENCER'
      };
      document.getElementById('stat-diff-badge').textContent = diffLabels[d.difficulty] || d.difficulty;
    } catch (_) {}
  },

  async loadUsers() {
    try {
      const data = await this.api('/api/admin/users');
      this.users = data.users || [];
      this.renderUsersTable(this.users);
    } catch (_) {}
  },

  searchUsers(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      this.renderUsersTable(this.users);
      return;
    }
    const filtered = this.users.filter(u =>
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.phone && u.phone.includes(q))
    );
    this.renderUsersTable(filtered);
  },

  renderUsersTable(list) {
    const tbody = document.getElementById('users-table-body');
    if (!list || !list.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8;">Nenhum jogador encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(u => {
      const isInf = Boolean(u.is_influencer);
      return `
        <tr>
          <td>
            <strong style="color: #fff;">${u.username}</strong>
            ${isInf ? '<span class="badge badge-influencer" style="margin-left: 6px;">⭐ INFLUENCER</span>' : ''}
          </td>
          <td style="color: #94a3b8; font-size: 12px;">${u.email || u.phone || '—'}</td>
          <td style="color: #ffd166; font-family: monospace; font-weight: 700;">${this.formatBRL(u.cash_balance || u.balance)}</td>
          <td>
            <button class="btn-influencer-toggle ${isInf ? 'active' : ''}" onclick="Admin.toggleInfluencer('${u.id}', ${isInf})">
              ${isInf ? '⭐ INFLUENCER ATIVO' : 'TORNAR INFLUENCER'}
            </button>
          </td>
          <td><span class="badge" style="background: rgba(255,255,255,0.08);">${u.role}</span></td>
          <td>
            <button class="btn-action btn-edit" onclick="Admin.openEditUser('${u.id}', '${u.username}', ${u.cash_balance || u.balance})">
              ✏️ Saldo
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  async toggleInfluencer(userId, current) {
    try {
      const next = !current;
      await this.api(`/api/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ is_influencer: next })
      });
      this.loadUsers();
      this.loadStats();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  openEditUser(userId, username, currentCents) {
    this.selectedUserId = userId;
    document.getElementById('edit-user-name').value = username;
    document.getElementById('edit-user-cash').value = (currentCents / 100).toFixed(2);
    document.getElementById('modal-edit-user').style.display = 'flex';
  },

  async saveUserBalance() {
    if (!this.selectedUserId) return;
    const val = parseFloat(document.getElementById('edit-user-cash').value || '0');
    try {
      await this.api(`/api/admin/users/${this.selectedUserId}`, {
        method: 'PUT',
        body: JSON.stringify({ cash_balance: Math.round(val * 100) })
      });
      document.getElementById('modal-edit-user').style.display = 'none';
      this.loadUsers();
      this.loadStats();
    } catch (e) {
      alert('Erro ao atualizar saldo: ' + e.message);
    }
  },

  async loadDeposits() {
    try {
      const data = await this.api('/api/admin/deposits');
      const tbody = document.getElementById('deposits-table-body');
      const list = data.deposits || [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8;">Nenhum depósito registrado.</td></tr>';
        return;
      }

      tbody.innerHTML = list.map(d => {
        const isPending = d.status === 'pending';
        return `
          <tr>
            <td style="font-family: monospace; font-size: 11px; color: #94a3b8;">${d.id}</td>
            <td><strong>${d.username || d.uid}</strong></td>
            <td style="color: #10b981; font-weight: 700; font-family: monospace;">${this.formatBRL(d.amount)}</td>
            <td style="color: #ffd166; font-size: 12px;">+${this.formatBRL(d.bonusAmount || 0)}</td>
            <td><span class="badge badge-${d.status}">${d.status}</span></td>
            <td style="color: #94a3b8; font-size: 11px;">${new Date(d.created_at).toLocaleString('pt-BR')}</td>
            <td>
              ${isPending ? `<button class="btn-action btn-approve" onclick="Admin.approveDeposit('${d.id}')">✓ Aprovar</button>` : '—'}
            </td>
          </tr>
        `;
      }).join('');
    } catch (_) {}
  },

  async approveDeposit(depId) {
    if (!confirm('Deseja realmente aprovar este depósito e creditar o saldo ao piloto?')) return;
    try {
      await this.api(`/api/admin/deposits/${depId}/approve`, { method: 'POST' });
      this.loadDeposits();
      this.loadStats();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async loadWithdrawals() {
    try {
      const data = await this.api('/api/admin/withdrawals');
      const tbody = document.getElementById('withdrawals-table-body');
      const list = data.withdrawals || [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8;">Nenhum saque registrado.</td></tr>';
        return;
      }

      tbody.innerHTML = list.map(w => {
        const isPending = w.status === 'pending';
        return `
          <tr>
            <td style="font-family: monospace; font-size: 11px; color: #94a3b8;">${w.id}</td>
            <td><strong>${w.username || w.uid}</strong></td>
            <td style="font-family: monospace; color: #38bdf8;">${w.pixKey}</td>
            <td><span class="badge" style="background: rgba(255,255,255,0.06);">${w.pixType}</span></td>
            <td style="color: #ffd166; font-weight: 700; font-family: monospace;">${this.formatBRL(w.amount)}</td>
            <td><span class="badge badge-${w.status}">${w.status}</span></td>
            <td>
              ${isPending ? `
                <button class="btn-action btn-approve" onclick="Admin.approveWithdrawal('${w.id}')">✓ Pago</button>
                <button class="btn-action btn-reject" onclick="Admin.rejectWithdrawal('${w.id}')">✕ Recusar</button>
              ` : '—'}
            </td>
          </tr>
        `;
      }).join('');
    } catch (_) {}
  },

  async approveWithdrawal(wthId) {
    if (!confirm('Confirmar pagamento do saque PIX?')) return;
    try {
      await this.api(`/api/admin/withdrawals/${wthId}/approve`, { method: 'POST' });
      this.loadWithdrawals();
      this.loadStats();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async rejectWithdrawal(wthId) {
    if (!confirm('Recusar saque? O valor será estornado de volta para o piloto.')) return;
    try {
      await this.api(`/api/admin/withdrawals/${wthId}/reject`, { method: 'POST' });
      this.loadWithdrawals();
      this.loadStats();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async loadSettings() {
    try {
      const s = await this.api('/api/admin/settings');
      if (s.difficulty) document.getElementById('set-difficulty').value = s.difficulty;
      if (s.minBet) document.getElementById('set-min-bet').value = (s.minBet / 100).toFixed(2);
      if (s.maxBet) document.getElementById('set-max-bet').value = (s.maxBet / 100).toFixed(2);
      if (s.minDeposit) document.getElementById('set-min-dep').value = (s.minDeposit / 100).toFixed(2);
      if (s.minWithdrawal) document.getElementById('set-min-with').value = (s.minWithdrawal / 100).toFixed(2);
    } catch (_) {}
  },

  async saveDifficulty(level) {
    try {
      await this.api('/api/admin/difficulty', {
        method: 'POST',
        body: JSON.stringify({ level })
      });
      alert('Dificuldade atualizada com sucesso para: ' + level);
      this.loadStats();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async saveLimits() {
    const minBet = Math.round(parseFloat(document.getElementById('set-min-bet').value || '1') * 100);
    const maxBet = Math.round(parseFloat(document.getElementById('set-max-bet').value || '500') * 100);
    const minDeposit = Math.round(parseFloat(document.getElementById('set-min-dep').value || '20') * 100);
    const minWithdrawal = Math.round(parseFloat(document.getElementById('set-min-with').value || '10') * 100);

    try {
      await this.api('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({ minBet, maxBet, minDeposit, minWithdrawal })
      });
      alert('Configurações salvas com sucesso!');
      this.loadStats();
    } catch (e) {
      alert('Erro ao salvar: ' + e.message);
    }
  }
};

window.Admin = Admin;
document.addEventListener('DOMContentLoaded', () => Admin.init());
