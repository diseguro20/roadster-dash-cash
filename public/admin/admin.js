/**
 * ROADSTER DASH CASH - CONTROLADOR DO PAINEL ADMINISTRATIVO
 * 100% FUNCIONAL E EM TEMPO REAL
 */

const Admin = {
  token: localStorage.getItem('roadster_admin_token') || localStorage.getItem('roadster_token') || '',
  users: [],
  selectedUserId: null,
  currentTab: 'overview',
  pollingInterval: null,
  lastSearchQuery: '',

  formatBRL(cents) {
    return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },

  formatDate(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '—';
    }
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
      const email = String(me.email || '').toLowerCase().trim();
      const username = String(me.username || '').toLowerCase().trim();
      const isAllowed = email === 'diseguro20@gmail.com' || (me.role === 'admin' && (email === 'diseguro20@gmail.com' || username === 'diseguro20'));
      if (!isAllowed) {
        alert('Acesso restrito exclusivamente para o administrador diseguro20@gmail.com.');
        this.logout();
        return;
      }
      document.getElementById('admin-user-display').textContent = me.email || me.username;
      document.getElementById('admin-login-modal').style.display = 'none';
      document.getElementById('admin-app').style.display = 'flex';

      this.showTab('overview');
      this.startPolling();
    } catch (_) {
      this.showLogin();
    }
  },

  startPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.pollingInterval = setInterval(() => {
      this.refreshCurrentTab(true);
    }, 3500);
  },

  showLogin() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    document.getElementById('admin-app').style.display = 'none';
    const errBox = document.getElementById('admin-login-error');
    if (errBox) errBox.style.display = 'none';
    document.getElementById('admin-login-modal').style.display = 'flex';
  },

  togglePassVisibility() {
    const input = document.getElementById('admin-login-pass');
    const btn = document.getElementById('btn-toggle-pass');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (btn) btn.textContent = '🙈';
    } else {
      input.type = 'password';
      if (btn) btn.textContent = '👁️';
    }
  },

  async login() {
    const userInput = document.getElementById('admin-login-user');
    const passInput = document.getElementById('admin-login-pass');
    const errBox = document.getElementById('admin-login-error');
    const btnSubmit = document.getElementById('btn-admin-submit-login');

    const login = (userInput?.value || '').trim();
    const pass = passInput?.value || '';

    if (errBox) errBox.style.display = 'none';

    if (!login || !pass) {
      if (errBox) {
        errBox.textContent = 'Informe seu e-mail/usuário e senha de administrador.';
        errBox.style.display = 'block';
      } else {
        alert('Informe seu e-mail/usuário e senha de administrador.');
      }
      return;
    }

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Autenticando...';
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password: pass })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Credenciais inválidas.');

      const email = String(data.user?.email || '').toLowerCase().trim();
      const username = String(data.user?.username || '').toLowerCase().trim();
      const isAllowed = email === 'diseguro20@gmail.com' || (data.user?.role === 'admin' && (email === 'diseguro20@gmail.com' || username === 'diseguro20'));

      if (!isAllowed) {
        throw new Error('Acesso restrito exclusivamente para o administrador diseguro20@gmail.com.');
      }

      this.token = data.token;
      localStorage.setItem('roadster_admin_token', data.token);
      localStorage.setItem('roadster_token', data.token);
      await this.init();
    } catch (e) {
      if (errBox) {
        errBox.textContent = e.message;
        errBox.style.display = 'block';
      } else {
        alert('Erro: ' + e.message);
      }
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = '🔐 ENTRAR NO PAINEL ADMIN';
      }
    }
  },

  logout() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.token = '';
    localStorage.removeItem('roadster_admin_token');
    const passInput = document.getElementById('admin-login-pass');
    if (passInput) passInput.value = '';
    this.showLogin();
  },

  showTab(tabName, el) {
    this.currentTab = tabName;
    document.querySelectorAll('.admin-tab').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

    const targetEl = document.getElementById(`tab-${tabName}`);
    if (targetEl) targetEl.style.display = 'block';

    if (el) {
      el.classList.add('active');
    } else {
      const matchBtn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.getAttribute('onclick')?.includes(tabName));
      if (matchBtn) matchBtn.classList.add('active');
    }

    const titles = {
      overview: 'Visão Geral em Tempo Real',
      users: 'Gestão de Jogadores & Influenciadores',
      deposits: 'Depósitos PIX VizzionPay (Tempo Real)',
      withdrawals: 'Solicitações de Saque PIX (Tempo Real)',
      settings: 'Configurações da Plataforma & Dificuldade'
    };
    document.getElementById('admin-section-title').textContent = titles[tabName] || 'Painel Administrativo';

    this.refreshCurrentTab(false);
  },

  async refreshCurrentTab(silent = false) {
    if (this.currentTab === 'overview') {
      await this.loadStats();
    } else if (this.currentTab === 'users') {
      await this.loadUsers();
      if (!silent) await this.loadStats();
    } else if (this.currentTab === 'deposits') {
      await this.loadDeposits();
      if (!silent) await this.loadStats();
    } else if (this.currentTab === 'withdrawals') {
      await this.loadWithdrawals();
      if (!silent) await this.loadStats();
    } else if (this.currentTab === 'settings') {
      if (!silent) await this.loadSettings();
    }

    const indicator = document.getElementById('live-text');
    if (indicator) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('pt-BR');
      indicator.textContent = `AO VIVO • ${timeStr}`;
    }
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
        hard: '💀 IMPOSSÍVEL (RTP 99.9% CASA)',
        impossible: '💀 IMPOSSÍVEL (RTP 99.9% CASA)',
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
      if (this.lastSearchQuery) {
        this.searchUsers(this.lastSearchQuery);
      } else {
        this.renderUsersTable(this.users);
      }
    } catch (_) {}
  },

  searchUsers(query) {
    this.lastSearchQuery = query;
    const q = query.toLowerCase().trim();
    if (!q) {
      this.renderUsersTable(this.users);
      return;
    }
    const filtered = this.users.filter(u =>
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.phone && u.phone.includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
    this.renderUsersTable(filtered);
  },

  renderUsersTable(list) {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    if (!list || !list.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">Nenhum jogador encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(u => {
      const isInf = Boolean(u.is_influencer);
      const isMaster = (u.username === 'diseguro20');
      const phoneDisplay = u.phone ? `(${u.phone.substring(0, 2)}) ${u.phone.substring(2)}` : (u.email || '—');

      return `
        <tr>
          <td>
            <strong style="color: #fff; font-size: 14px;">${u.username}</strong>
            ${isInf ? '<span class="badge badge-influencer" style="margin-left: 6px; background: rgba(255, 209, 102, 0.2); color: #ffd166; border: 1px solid #ffd166;">⭐ INFLUENCER</span>' : ''}
            ${isMaster ? '<span class="badge" style="margin-left: 6px; background: rgba(232, 33, 39, 0.2); color: #e82127; border: 1px solid #e82127;">MESTRE</span>' : ''}
          </td>
          <td style="color: #94a3b8; font-size: 13px; font-family: monospace;">${phoneDisplay}</td>
          <td style="color: #ffd166; font-family: monospace; font-weight: 700; font-size: 14px;">${this.formatBRL(u.cash_balance || u.balance)}</td>
          <td>
            <button class="btn-influencer-toggle ${isInf ? 'active' : ''}" onclick="Admin.toggleInfluencer('${u.id}', ${isInf})">
              ${isInf ? '⭐ INFLUENCER ATIVO' : 'TORNAR INFLUENCER'}
            </button>
          </td>
          <td style="color: #94a3b8; font-size: 11px;">${this.formatDate(u.created_at)}</td>
          <td>
            <button class="btn-action btn-edit" title="Alterar saldo do jogador" onclick="Admin.openEditUser('${u.id}', '${u.username}', ${u.cash_balance || u.balance})">
              ✏️ Saldo
            </button>
            ${!isMaster ? `
              <button class="btn-action btn-delete" title="Excluir piloto do sistema" onclick="Admin.deleteUser('${u.id}', '${u.username}')">
                🗑️ Excluir
              </button>
            ` : ''}
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
      await this.loadUsers();
      await this.loadStats();
    } catch (e) {
      alert('Erro ao alterar modo influencer: ' + e.message);
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
      await this.loadUsers();
      await this.loadStats();
    } catch (e) {
      alert('Erro ao atualizar saldo: ' + e.message);
    }
  },

  async deleteUser(userId, username) {
    if (!confirm(`Deseja realmente EXCLUIR o piloto "${username}" do banco de dados? Esta ação não pode ser desfeita.`)) {
      return;
    }
    try {
      await this.api(`/api/admin/users/${userId}`, { method: 'DELETE' });
      await this.loadUsers();
      await this.loadStats();
    } catch (e) {
      alert('Erro ao excluir piloto: ' + e.message);
    }
  },

  async loadDeposits() {
    try {
      const data = await this.api('/api/admin/deposits');
      const tbody = document.getElementById('deposits-table-body');
      if (!tbody) return;
      const list = data.deposits || [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 20px;">Nenhum depósito registrado ainda.</td></tr>';
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
            <td><span class="badge badge-${d.status}">${d.status === 'approved' ? 'Aprovado' : (d.status === 'pending' ? 'Pendente' : d.status)}</span></td>
            <td style="color: #94a3b8; font-size: 11px;">${this.formatDate(d.created_at)}</td>
            <td>
              ${isPending ? `<button class="btn-action btn-approve" onclick="Admin.approveDeposit('${d.id}')">✓ Aprovar PIX</button>` : '—'}
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
      await this.loadDeposits();
      await this.loadStats();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async loadWithdrawals() {
    try {
      const data = await this.api('/api/admin/withdrawals');
      const tbody = document.getElementById('withdrawals-table-body');
      if (!tbody) return;
      const list = data.withdrawals || [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 20px;">Nenhuma solicitação de saque registrada.</td></tr>';
        return;
      }

      tbody.innerHTML = list.map(w => {
        const isPending = w.status === 'pending';
        return `
          <tr>
            <td style="font-family: monospace; font-size: 11px; color: #94a3b8;">${w.id}</td>
            <td><strong>${w.username || w.uid}</strong></td>
            <td style="font-family: monospace; color: #38bdf8; font-weight: 600;">${w.pixKey}</td>
            <td><span class="badge" style="background: rgba(255,255,255,0.06);">${w.pixType}</span></td>
            <td style="color: #ffd166; font-weight: 700; font-family: monospace;">${this.formatBRL(w.amount)}</td>
            <td><span class="badge badge-${w.status}">${w.status === 'completed' ? 'Pago' : (w.status === 'pending' ? 'Pendente' : 'Recusado')}</span></td>
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
    if (!confirm('Confirmar que você efetuou o pagamento deste saque PIX para a chave do piloto?')) return;
    try {
      await this.api(`/api/admin/withdrawals/${wthId}/approve`, { method: 'POST' });
      await this.loadWithdrawals();
      await this.loadStats();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async rejectWithdrawal(wthId) {
    if (!confirm('Recusar saque? O valor será estornado imediatamente de volta para a carteira do piloto.')) return;
    try {
      await this.api(`/api/admin/withdrawals/${wthId}/reject`, { method: 'POST' });
      await this.loadWithdrawals();
      await this.loadStats();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async loadSettings() {
    try {
      const s = await this.api('/api/admin/settings');
      if (s.difficulty) document.getElementById('set-difficulty').value = s.difficulty;
      if (s.cashoutMinDistance) document.getElementById('set-cashout-dist').value = s.cashoutMinDistance;
      if (s.minBet) document.getElementById('set-min-bet').value = (s.minBet / 100).toFixed(2);
      if (s.maxBet) document.getElementById('set-max-bet').value = (s.maxBet / 100).toFixed(2);
      if (s.minDeposit) document.getElementById('set-min-dep').value = (s.minDeposit / 100).toFixed(2);
      if (s.minWithdrawal) document.getElementById('set-min-with').value = (s.minWithdrawal / 100).toFixed(2);
      const bonusMinEl = document.getElementById('set-bonus-min');
      if (bonusMinEl) bonusMinEl.value = ((s.bonusMinDeposit || 5000) / 100).toFixed(2);
      if (s.vizzionpayApiKey) document.getElementById('set-vp-key').value = s.vizzionpayApiKey;
      if (s.vizzionpayApiSecret) document.getElementById('set-vp-secret').value = s.vizzionpayApiSecret;
      if (s.vizzionpayWebhookUrl) document.getElementById('set-vp-webhook').value = s.vizzionpayWebhookUrl;
      if (s.amplopayApiKey && document.getElementById('set-ap-key')) document.getElementById('set-ap-key').value = s.amplopayApiKey;
      if (s.amplopayApiSecret && document.getElementById('set-ap-secret')) document.getElementById('set-ap-secret').value = s.amplopayApiSecret;
      if (s.amplopayWebhookUrl && document.getElementById('set-ap-webhook')) document.getElementById('set-ap-webhook').value = s.amplopayWebhookUrl;
      if (s.amploPercent !== undefined && document.getElementById('set-ap-percent')) document.getElementById('set-ap-percent').value = s.amploPercent;
    } catch (_) {}
  },

  async saveDifficulty(level) {
    try {
      await this.api('/api/admin/difficulty', {
        method: 'POST',
        body: JSON.stringify({ level })
      });
      alert('Dificuldade atualizada com sucesso para: ' + level);
      await this.loadStats();
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  },

  async testVizzionPay() {
    const resultEl = document.getElementById('vp-test-result');
    if (resultEl) {
      resultEl.textContent = 'Verificando conexão...';
      resultEl.style.color = '#ffd166';
    }
    try {
      const res = await this.api('/api/admin/test-vizzionpay');
      if (resultEl) {
        resultEl.textContent = res.success ? `✅ ${res.message}` : `❌ ${res.message}`;
        resultEl.style.color = res.success ? '#10b981' : '#ff4d4f';
      }
    } catch (e) {
      if (resultEl) {
        resultEl.textContent = '❌ Falha: ' + e.message;
        resultEl.style.color = '#ff4d4f';
      }
    }
  },

  async saveLimits() {
    const minBet = Math.round(parseFloat(document.getElementById('set-min-bet').value || '1') * 100);
    const maxBet = Math.round(parseFloat(document.getElementById('set-max-bet').value || '500') * 100);
    const minDeposit = Math.round(parseFloat(document.getElementById('set-min-dep').value || '20') * 100);
    const minWithdrawal = Math.round(parseFloat(document.getElementById('set-min-with').value || '10') * 100);
    const bonusMinDeposit = Math.round(parseFloat(document.getElementById('set-bonus-min')?.value || '50') * 100);
    const cashoutMinDistance = parseInt(document.getElementById('set-cashout-dist').value || '10000', 10);
    const difficulty = document.getElementById('set-difficulty').value;
    const vizzionpayApiKey = document.getElementById('set-vp-key').value.trim();
    const vizzionpayApiSecret = document.getElementById('set-vp-secret').value.trim();
    const vizzionpayWebhookUrl = document.getElementById('set-vp-webhook').value.trim();
    const amplopayApiKey = document.getElementById('set-ap-key')?.value.trim() || '';
    const amplopayApiSecret = document.getElementById('set-ap-secret')?.value.trim() || '';
    const amplopayWebhookUrl = document.getElementById('set-ap-webhook')?.value.trim() || '';
    const amploPercent = Number(document.getElementById('set-ap-percent')?.value || '40');

    try {
      await this.api('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({
          minBet,
          maxBet,
          minDeposit,
          minWithdrawal,
          bonusMinDeposit,
          cashoutMinDistance,
          difficulty,
          vizzionpayApiKey,
          vizzionpayApiSecret,
          vizzionpayWebhookUrl,
          amplopayApiKey,
          amplopayApiSecret,
          amplopayWebhookUrl,
          amploPercent
        })
      });
      alert('Configurações da plataforma salvas com sucesso em tempo real!');
      await this.loadStats();
    } catch (e) {
      alert('Erro ao salvar configurações: ' + e.message);
    }
  }
};

window.Admin = Admin;
document.addEventListener('DOMContentLoaded', () => Admin.init());
