/**
 * ROADSTER DASH CASH - SKILL WAGERING & CASHOUT ENGINE (V2 OTIMIZADA)
 * Sem travamentos, 60+ FPS em mobile, controle de aposta obrigatório,
 * tecla de saque independente (C / Toque) e modal de derrota com revanche.
 */

(function () {
  'use strict';

  const WagerEngine = {
    user: null,
    token: localStorage.getItem('roadster_token') || '',
    activeWager: {
      inProgress: false,
      mode: 'real',
      betAmount: 200, // em centavos (R$ 2,00)
      hasSelectedBet: true,
      sessionId: null,
      multiplier: 1.0,
      cashedOut: false,
      distance: 0
    },
    pollingTimer: null,
    _lastHudUpdate: 0,
    _isStartingRace: false,
    _loadingFailsafe: null,
    _pixCountdownTimer: null,

    formatBRL(cents) {
      const v = (Number(cents || 0) / 100);
      return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },

    showToast(msg, duration = 4000) {
      let toast = document.getElementById('wager-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'wager-toast';
        toast.className = 'wager-toast';
        document.body.appendChild(toast);
      }
      toast.innerHTML = msg;
      toast.style.display = 'flex';
      clearTimeout(this._toastTimeout);
      this._toastTimeout = setTimeout(() => {
        toast.style.display = 'none';
      }, duration);
    },

    async api(url, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }
      const res = await fetch(url, { ...options, headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro na requisição');
      }
      return data;
    },

    async init() {
      console.log('🏎️ [WagerEngine] Inicializando motor de apostas fluido 60 FPS...');
      this.bindHooks();
      await this.loadUser();
      this.initBetControls();
      this.updateBalanceUI();
      this.updateAuthUI();

      // "ja ao entrar, entre direto na tela de cadastro ou se ja tiver login pode escolher logar"
      if (!this.user || this.user.is_guest) {
        this.openAuthModal('register', true);
      }

      window.addEventListener('focus', () => {
        if (this.token) {
          this.loadUser().catch(() => {});
        }
      });

      // Se tentar sair / recarregar / fechar a aba no meio da corrida, perde o saldo apostado imediatamente
      const handleAbandon = () => {
        if (this.activeWager && this.activeWager.inProgress && !this.activeWager.cashedOut && this.activeWager.sessionId) {
          this.activeWager.inProgress = false;
          const payload = JSON.stringify({
            sessionId: this.activeWager.sessionId,
            action: 'abandon',
            distance: this.activeWager.distance || 0
          });
          if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/game/end', new Blob([payload], { type: 'application/json' }));
          }
        }
      };
      window.addEventListener('beforeunload', handleAbandon);
      window.addEventListener('pagehide', handleAbandon);
    },

    async loadUser() {
      if (this.token) {
        try {
          const data = await this.api('/api/auth/me');
          if (data && !data.is_guest) {
            this.user = data;
          } else {
            this.token = '';
            localStorage.removeItem('roadster_token');
            this.user = null;
          }
        } catch (_) {
          this.token = '';
          localStorage.removeItem('roadster_token');
          this.user = null;
        }
      } else {
        this.user = null;
      }

      // Sincroniza modo influenciador com o motor 3D internamente (sem exibir na tela do lead)
      if (this.user && (this.user.is_influencer || this.user.difficulty === 'influencer')) {
        window.__isInfluencerActive = true;
      } else {
        window.__isInfluencerActive = false;
      }

      if (this.user && this.user.cashoutMinDistance) {
        window.__cashoutMinDistance = Number(this.user.cashoutMinDistance);
      } else {
        window.__cashoutMinDistance = 10000;
      }

      this.updateBalanceUI();
      this.updateAuthUI();
    },

    updateAuthUI() {
      const authBox = document.getElementById('topbar-auth');
      if (!authBox) return;

      const isRegistered = this.user && !this.user.is_guest;
      if (isRegistered) {
        authBox.innerHTML = `
          <div class="user-pill">
            <span class="user-avatar">🏎️</span>
            <span class="user-name" title="${this.user.username}">${this.user.username}</span>
            <button class="btn-logout" title="Sair da conta" onclick="WagerEngine.logout()">SAIR</button>
          </div>
        `;
      } else {
        authBox.innerHTML = `
          <button class="btn-top btn-auth-login" onclick="WagerEngine.openAuthModal('login')">
            <span>👤</span> <span>ENTRAR</span>
          </button>
          <button class="btn-top btn-auth-reg" onclick="WagerEngine.openAuthModal('register')">
            <span>✨</span> <span>CRIAR CONTA</span>
          </button>
        `;
      }

      const pilotBtn = document.getElementById('pilot-name');
      if (pilotBtn) {
        if (this.user && !this.user.is_guest) {
          pilotBtn.textContent = this.user.username;
          pilotBtn.onclick = null;
        } else {
          pilotBtn.innerHTML = 'Cadastre-se para Jogar';
          pilotBtn.onclick = () => this.openAuthModal('register', true);
        }
      }
    },

    updateBalanceUI() {
      const balanceEl = document.getElementById('topbar-balance');
      if (!balanceEl) return;

      if (!this.user || this.user.is_guest) {
        balanceEl.textContent = 'R$ 0,00';
        balanceEl.style.color = '#94a3b8';
        return;
      }

      const total = (this.user?.balance != null) ? this.user.balance : 0;
      balanceEl.textContent = this.formatBRL(total);
      balanceEl.style.color = '#ffd166';
    },

    openAuthModal(tab = 'register', isGate = false) {
      const modal = document.getElementById('auth-modal');
      if (!modal) return;
      this.setAuthTab(tab);
      const regErr = document.getElementById('reg-error-msg');
      if (regErr) regErr.style.display = 'none';
      const logErr = document.getElementById('login-error-msg');
      if (logErr) logErr.style.display = 'none';

      // Máscara automática de telefone celular com DDD
      const phoneInput = document.getElementById('reg-phone');
      if (phoneInput && !phoneInput._maskBound) {
        phoneInput._maskBound = true;
        phoneInput.addEventListener('input', (e) => {
          let v = e.target.value.replace(/\D/g, '');
          if (v.length > 11) v = v.substring(0, 11);
          if (v.length > 6) {
            e.target.value = `(${v.substring(0, 2)}) ${v.substring(2, 7)}-${v.substring(7)}`;
          } else if (v.length > 2) {
            e.target.value = `(${v.substring(0, 2)}) ${v.substring(2)}`;
          } else if (v.length > 0) {
            e.target.value = `(${v}`;
          }
        });
      }

      // Fecha outros modais se abertos
      const depModal = document.getElementById('deposit-modal');
      if (depModal) depModal.style.display = 'none';
      const wthModal = document.getElementById('withdraw-modal');
      if (wthModal) wthModal.style.display = 'none';

      modal.style.display = 'flex';
    },

    setAuthTab(tab = 'register') {
      const regForm = document.getElementById('form-register');
      const logForm = document.getElementById('form-login');
      const regTab = document.getElementById('tab-btn-register');
      const logTab = document.getElementById('tab-btn-login');
      const heading = document.getElementById('auth-heading');
      const sub = document.getElementById('auth-sub');

      if (tab === 'register') {
        if (regForm) regForm.style.display = 'block';
        if (logForm) logForm.style.display = 'none';
        if (regTab) regTab.classList.add('active');
        if (logTab) logTab.classList.remove('active');
        if (heading) heading.textContent = 'CRIAR CONTA DE PILOTO';
        if (sub) sub.textContent = 'Cadastre-se para apostar e resgatar dinheiro real via PIX!';
      } else {
        if (regForm) regForm.style.display = 'none';
        if (logForm) logForm.style.display = 'block';
        if (regTab) regTab.classList.remove('active');
        if (logTab) logTab.classList.add('active');
        if (heading) heading.textContent = 'ENTRAR NA CONTA';
        if (sub) sub.textContent = 'Acesse sua conta para apostar, depositar e sacar via PIX';
      }
    },

    closeAuthModal() {
      const modal = document.getElementById('auth-modal');
      if (modal) modal.style.display = 'none';
    },

    openLoginModal() {
      this.openAuthModal('login');
    },

    openRegisterModal(isGate = false) {
      this.openAuthModal('register', isGate);
    },

    closeAuthModals() {
      this.closeAuthModal();
    },

    switchToRegister(e) {
      if (e) e.preventDefault();
      this.setAuthTab('register');
    },

    switchToLogin(e) {
      if (e) e.preventDefault();
      this.setAuthTab('login');
    },

    async handleLogin(e) {
      if (e) e.preventDefault();
      const loginInput = document.getElementById('login-identity');
      const passInput = document.getElementById('login-password');
      const errEl = document.getElementById('login-error-msg');
      const btn = document.getElementById('btn-submit-login');

      if (!loginInput || !passInput) return;
      const login = loginInput.value.trim();
      const password = passInput.value;

      if (!login || !password) {
        if (errEl) {
          errEl.textContent = 'Informe usuário e senha.';
          errEl.style.display = 'block';
        }
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Entrando...';
      }
      if (errEl) errEl.style.display = 'none';

      try {
        const res = await this.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ login, password })
        });

        this.token = res.token;
        localStorage.setItem('roadster_token', res.token);
        this.user = res.user;
        this.user.is_guest = false;

        if (this.user.is_influencer) {
          window.__isInfluencerActive = true;
        } else {
          window.__isInfluencerActive = false;
        }

        this.closeAuthModal();
        this.updateBalanceUI();
        this.updateAuthUI();
        this.showToast(`👋 Bem-vindo de volta, ${this.user.username}!`);

        // Leva imediatamente para a tela de depósito igual da Fruit Cash
        setTimeout(() => {
          this.openDepositModal();
        }, 350);
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Erro ao realizar login.';
          errEl.style.display = 'block';
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🚀 ENTRAR NO ROADSTER';
        }
      }
    },

    async handleRegister(e) {
      if (e) e.preventDefault();
      const usernameInput = document.getElementById('reg-username');
      const phoneInput = document.getElementById('reg-phone');
      const passInput = document.getElementById('reg-password');
      const passConfirmInput = document.getElementById('reg-password-confirm');
      const errEl = document.getElementById('reg-error-msg');
      const btn = document.getElementById('btn-submit-reg');

      const username = usernameInput?.value?.trim() || '';
      const phone = phoneInput?.value?.trim() || '';
      const password = passInput?.value || '';
      const confirm = passConfirmInput?.value || '';

      if (username.length < 3) {
        if (errEl) {
          errEl.textContent = 'O nome de piloto deve ter pelo menos 3 caracteres.';
          errEl.style.display = 'block';
        }
        return;
      }

      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        if (errEl) {
          errEl.textContent = 'Informe um número de celular válido com DDD (mínimo 10 dígitos).';
          errEl.style.display = 'block';
        }
        return;
      }

      if (password.length < 6) {
        if (errEl) {
          errEl.textContent = 'A senha deve ter no mínimo 6 caracteres.';
          errEl.style.display = 'block';
        }
        return;
      }

      if (password !== confirm) {
        if (errEl) {
          errEl.textContent = 'As senhas não coincidem!';
          errEl.style.display = 'block';
        }
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Criando conta...';
      }
      if (errEl) errEl.style.display = 'none';

      try {
        const res = await this.api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, phone: cleanPhone, password })
        });

        this.token = res.token;
        localStorage.setItem('roadster_token', res.token);
        this.user = res.user;
        this.user.is_guest = false;

        this.closeAuthModal();
        this.updateBalanceUI();
        this.updateAuthUI();
        this.showToast(`🎉 Conta criada com sucesso! Boas corridas, ${this.user.username}!`);

        // Leva imediatamente para a tela de depósito igual da Fruit Cash
        setTimeout(() => {
          this.openDepositModal();
        }, 350);
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Erro ao criar conta.';
          errEl.style.display = 'block';
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🏁 CRIAR CONTA E ENTRAR';
        }
      }
    },

    async logout() {
      localStorage.removeItem('roadster_token');
      this.token = '';
      this.user = null;
      this.updateBalanceUI();
      this.updateAuthUI();
      this.openAuthModal('login');
      this.showToast('Você saiu da sua conta.');
    },

    initBetControls() {
      const input = document.getElementById('wager-amount-input');
      const quickBtns = document.querySelectorAll('.quick-btn');
      const startBtn = document.getElementById('btn-wager-start');

      if (input) {
        input.value = (this.activeWager.betAmount / 100).toFixed(2);
        input.addEventListener('change', () => {
          let val = Math.max(1, parseFloat(input.value) || 1);
          this.activeWager.betAmount = Math.round(val * 100);
          this.activeWager.hasSelectedBet = true;
          input.value = (this.activeWager.betAmount / 100).toFixed(2);
          this.updateStartButtonLabel();
        });
      }

      quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const val = parseFloat(btn.dataset.val);
          if (val) {
            this.activeWager.betAmount = Math.round(val * 100);
            this.activeWager.hasSelectedBet = true;
            if (input) input.value = val.toFixed(2);
            quickBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.updateStartButtonLabel();
          }
        });
      });

      if (startBtn) {
        startBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.startWagerRace();
        });
      }

      // Atalho de Cashout no PC: Tecla C ou Enter (Espaço estritamente reservado para Pular)
      window.addEventListener('keydown', (e) => {
        if ((e.code === 'KeyC' || e.code === 'KeyX' || e.code === 'Enter') && this.activeWager.inProgress && !this.activeWager.cashedOut) {
          const hud = document.getElementById('wager-hud');
          if (hud && hud.style.display !== 'none') {
            e.preventDefault();
            this.executeCashout();
          }
        }
      });
    },

    updateStartButtonLabel() {
      const btn = document.getElementById('btn-wager-start');
      if (!btn) return;
      const formatted = this.formatBRL(this.activeWager.betAmount);
      btn.innerHTML = `🏎️ INICIAR CORRIDA (${formatted})`;
      btn.style.background = 'linear-gradient(135deg, #e82127 0%, #b8151a 100%)';
    },

    showStartLoading(amountText, statusText) {
      let overlay = document.getElementById('wager-start-loading');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'wager-start-loading';
        document.body.appendChild(overlay);
      }
      overlay.classList.remove('fade-out');
      overlay.innerHTML = `
        <div class="wager-loading-card">
          <div class="wager-loading-spinner"></div>
          <div class="wager-loading-title">🏎️ PREPARANDO O TESLA...</div>
          <div class="wager-loading-desc">
            Registrando aposta de <strong style="color: #ffd166;">${amountText}</strong> e calibrando propulsores...
          </div>
          <div class="wager-loading-bar-track">
            <div class="wager-loading-bar-fill"></div>
          </div>
          <div class="wager-loading-status" id="wager-loading-status">${statusText || '⚡ Autenticando e gerando sessão de corrida...'}</div>
        </div>
      `;
      overlay.style.display = 'flex';
    },

    updateStartLoadingStatus(text) {
      const el = document.getElementById('wager-loading-status');
      if (el) el.textContent = text;
    },

    hideStartLoading() {
      const overlay = document.getElementById('wager-start-loading');
      if (overlay) {
        overlay.classList.add('fade-out');
        setTimeout(() => {
          overlay.style.display = 'none';
          overlay.classList.remove('fade-out');
        }, 280);
      }
      this._isStartingRace = false;
    },

    returnToMenu() {
      this.hideCashoutHUD();
      this.hideStartLoading();

      // Se tentar sair ou voltar ao menu no meio da corrida sem resgatar, perde o saldo apostado
      if (this.activeWager.inProgress && !this.activeWager.cashedOut) {
        this.activeWager.inProgress = false;
        const sessionId = this.activeWager.sessionId;
        if (sessionId) {
          this.api('/api/game/end', {
            method: 'POST',
            body: JSON.stringify({
              sessionId,
              action: 'abandon',
              distance: this.activeWager.distance || 0
            })
          }).catch(() => {});
        }
        this.showToast('⚠️ Partida abandonada! O saldo da corrida foi perdido.');
      } else {
        this.activeWager.inProgress = false;
      }

      this._isStartingRace = false;

      const lossModal = document.getElementById('loss-revanche-modal');
      if (lossModal) lossModal.style.display = 'none';
      const winModal = document.getElementById('win-modal');
      if (winModal) winModal.style.display = 'none';
      const gameOverEl = document.getElementById('gameover');
      if (gameOverEl) gameOverEl.classList.add('hidden');
      const hudEl = document.getElementById('hud');
      if (hudEl) hudEl.classList.add('hidden');

      if (typeof window.__goToMenu === 'function') {
        window.__goToMenu();
      } else if (window.__game && typeof window.__game.toMenu === 'function') {
        window.__game.toMenu();
      } else {
        const btn = document.getElementById('go-menu-btn');
        if (btn) btn.click();
      }

      const menuEl = document.getElementById('menu');
      if (menuEl) {
        menuEl.classList.remove('hidden');
        menuEl.style.removeProperty('display');
      }
      this.updateBalanceUI();
    },

    onReturnToMenu() {
      this.hideCashoutHUD();
      this.hideStartLoading();

      if (this.activeWager.inProgress && !this.activeWager.cashedOut) {
        this.activeWager.inProgress = false;
        const sessionId = this.activeWager.sessionId;
        if (sessionId) {
          this.api('/api/game/end', {
            method: 'POST',
            body: JSON.stringify({
              sessionId,
              action: 'abandon',
              distance: this.activeWager.distance || 0
            })
          }).catch(() => {});
        }
        this.showToast('⚠️ Partida abandonada! O saldo da corrida foi perdido.');
      } else {
        this.activeWager.inProgress = false;
      }

      this._isStartingRace = false;

      const lossModal = document.getElementById('loss-revanche-modal');
      if (lossModal) lossModal.style.display = 'none';
      const hudEl = document.getElementById('hud');
      if (hudEl) hudEl.classList.add('hidden');
      const gameOverEl = document.getElementById('gameover');
      if (gameOverEl) gameOverEl.classList.add('hidden');
      const menuEl = document.getElementById('menu');
      if (menuEl) {
        menuEl.classList.remove('hidden');
        menuEl.style.removeProperty('display');
      }
    },

    async startWagerRace() {
      if (this._isStartingRace) return;

      // Sincroniza dados atualizados do usuário (saldo e status de influencer em tempo real)
      try {
        await this.loadUser();
      } catch (_) {}

      // 0. Bloqueia corrida se não estiver logado
      if (!this.user || this.user.is_guest) {
        this.showToast('⚠️ É obrigatório criar uma conta ou fazer login para jogar!');
        this.openAuthModal('register', true);
        return;
      }

      // 1. Exige seleção explícita de valor
      if (!this.activeWager.hasSelectedBet || !this.activeWager.betAmount || this.activeWager.betAmount < 100) {
        this.showToast('⚠️ Escolha o valor da aposta antes de iniciar a corrida!');
        const box = document.querySelector('.quick-bet-grid');
        if (box) {
          box.style.border = '1px solid #e82127';
          setTimeout(() => { box.style.border = 'none'; }, 2000);
        }
        return;
      }

      const amount = this.activeWager.betAmount;
      const formattedAmount = this.formatBRL(amount);

      // 2. Sempre verifica saldo na conta antes de disparar o jogo
      const currentBalance = (this.user?.balance != null) ? this.user.balance : 0;
      if (currentBalance < amount) {
        this.showToast(`⚠️ Saldo insuficiente! Você possui ${this.formatBRL(currentBalance)} e escolheu apostar ${formattedAmount}. Faça um PIX para jogar.`);
        this.openDepositModal();
        return;
      }

      // 3. Exibe tela de carregamento IMEDIATAMENTE (sem sensação de congelamento)
      this._isStartingRace = true;
      this.showStartLoading(formattedAmount, '⚡ Registrando aposta e conectando à pista...');

      // Fecha modais anteriores
      const lossModal = document.getElementById('loss-revanche-modal');
      if (lossModal) lossModal.style.display = 'none';
      const winModal = document.getElementById('win-modal');
      if (winModal) winModal.style.display = 'none';
      const gameOverEl = document.getElementById('gameover');
      if (gameOverEl) gameOverEl.classList.add('hidden');

      try {
        const res = await this.api('/api/game/start', {
          method: 'POST',
          body: JSON.stringify({ amount })
        });

        this.activeWager.sessionId = res.sessionId;
        this.activeWager.inProgress = true;
        this.activeWager.cashedOut = false;
        this.activeWager.multiplier = 1.0;
        this.activeWager.distance = 0;

        if (this.user) {
          this.user.balance = res.balance_after;
          this.user.cash_balance = res.cash_balance;
        }
        this.updateBalanceUI();
      } catch (err) {
        this.hideStartLoading();
        this.showToast('Erro ao iniciar corrida: ' + err.message);
        return;
      }

      this.updateStartLoadingStatus('🚀 Carregando pista 3D e liberando propulsores...');

      // Ativa HUD de Cashout
      this.showCashoutHUD();

      // Força ocultação imediata do menu da tela inicial e seu HUD de apostas
      const menuEl = document.getElementById('menu');
      if (menuEl) {
        menuEl.classList.add('hidden');
        menuEl.style.setProperty('display', 'none', 'important');
      }

      // Dispara o motor 3D
      if (typeof window.__origStartGame === 'function') {
        window.__origStartGame();
      } else {
        const origPlayBtn = document.getElementById('play-btn');
        if (origPlayBtn) origPlayBtn.click();
      }

      // Failsafe: oculta o loading após 2.5s caso a cena 3D demore para invocar o hook
      clearTimeout(this._loadingFailsafe);
      this._loadingFailsafe = setTimeout(() => {
        this.hideStartLoading();
      }, 2500);
    },

    showCashoutHUD() {
      let hud = document.getElementById('wager-hud');
      if (!hud) {
        hud = document.createElement('div');
        hud.id = 'wager-hud';
        hud.innerHTML = `
          <div class="multiplier-pill">
            <span class="mult-live" id="wager-mult-live">1.00x</span>
            <span class="profit-live" id="wager-profit-live">R$ 0,00</span>
          </div>
        `;
        document.body.appendChild(hud);
      }
      hud.style.display = 'flex';

      // HUD de Meta no canto superior direito (NUNCA mostrar para quem está com Modo Influencer ativo!)
      const isInfluencer = Boolean(this.user?.is_influencer);
      let goalHud = document.getElementById('wager-goal-hud');
      if (!goalHud && !isInfluencer) {
        goalHud = document.createElement('div');
        goalHud.id = 'wager-goal-hud';
        goalHud.className = 'wager-goal-hud';
        goalHud.innerHTML = `
          <div class="goal-hud-top">
            <span class="goal-hud-icon">🎯</span>
            <span class="goal-hud-title" id="goal-hud-title">META: 10 KM</span>
          </div>
          <div class="goal-hud-body">
            <div class="goal-hud-bar"><div class="goal-hud-fill" id="goal-hud-fill"></div></div>
            <span class="goal-hud-dist" id="goal-hud-dist">0m / 10.000m</span>
          </div>
        `;
        document.body.appendChild(goalHud);
      }
      if (goalHud) {
        goalHud.style.display = isInfluencer ? 'none' : 'flex';
      }

      let cashoutBtnContainer = document.getElementById('btn-cashout-container');
      if (!cashoutBtnContainer) {
        cashoutBtnContainer = document.createElement('div');
        cashoutBtnContainer.id = 'btn-cashout-container';
        cashoutBtnContainer.innerHTML = `
          <button class="btn-cashout" id="btn-cashout">
            <span id="cashout-label">💰 RESGATAR</span>
            <span class="cashout-shortcut">TECLA C</span>
          </button>
        `;
        document.body.appendChild(cashoutBtnContainer);

        const btn = document.getElementById('btn-cashout');
        const trigger = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.executeCashout();
        };
        btn.addEventListener('touchstart', trigger, { passive: false });
        btn.addEventListener('click', trigger);
      }
      cashoutBtnContainer.style.display = 'block';

      this.startMultiplierLoop();
    },

    hideCashoutHUD() {
      const hud = document.getElementById('wager-hud');
      if (hud) hud.style.display = 'none';
      const goalHud = document.getElementById('wager-goal-hud');
      if (goalHud) goalHud.style.display = 'none';
      const btn = document.getElementById('btn-cashout-container');
      if (btn) btn.style.display = 'none';
    },

    // Loop ultra-fluido: 0 leituras pesadas no DOM dentro do rAF
    startMultiplierLoop() {
      const multEl = document.getElementById('wager-mult-live');
      const profitEl = document.getElementById('wager-profit-live');
      const cashoutLabel = document.getElementById('cashout-label');

      const tick = (now) => {
        if (!this.activeWager.inProgress || this.activeWager.cashedOut) return;

        // Leitura direta de memória do Three.js (sem tocar no layout DOM)
        const currentDist = (window.__qt && window.__qt.distance != null) ? window.__qt.distance : 0;
        this.activeWager.distance = Math.floor(currentDist);

        // Curva de multiplicador
        let mult = 1.0 + Math.pow(Math.max(0, currentDist) / 105, 1.12) * 0.32;
        mult = Math.min(100.0, Math.max(1.0, mult));
        this.activeWager.multiplier = mult;

        // Limita a atualização dos textos para 15 vezes/segundo para eliminar jank
        if (now - this._lastHudUpdate > 66) {
          this._lastHudUpdate = now;
          const currentProfitCents = Math.floor(this.activeWager.betAmount * mult);
          if (multEl) multEl.textContent = `${mult.toFixed(2)}x`;
          if (profitEl) profitEl.textContent = this.formatBRL(currentProfitCents);

          const isInfluencer = Boolean(this.user?.is_influencer);
          const minMeters = window.__cashoutMinDistance || 10000;
          const canCashout = isInfluencer || (currentDist >= minMeters);
          const cashoutBtn = document.getElementById('btn-cashout');

          // O HUD de meta NUNCA deve ser exibido quando em modo influencer
          const goalHud = document.getElementById('wager-goal-hud');
          if (goalHud) {
            if (isInfluencer) {
              goalHud.style.display = 'none';
            } else {
              goalHud.style.display = 'flex';
              const goalTitle = document.getElementById('goal-hud-title');
              const goalDist = document.getElementById('goal-hud-dist');
              const goalFill = document.getElementById('goal-hud-fill');
              if (goalTitle && goalDist && goalFill) {
                const kmLabel = (minMeters >= 1000) ? `${(minMeters / 1000).toFixed(0)} KM` : `${minMeters}M`;
                const remaining = Math.max(0, minMeters - Math.floor(currentDist));
                const pct = Math.min(100, Math.max(0, (currentDist / minMeters) * 100));
                goalTitle.innerHTML = `🎯 META: ${kmLabel}`;
                goalDist.innerHTML = `${Math.floor(currentDist)}m / ${minMeters}m (Faltam ${remaining}m)`;
                goalFill.style.width = `${pct.toFixed(1)}%`;
              }
            }
          }

          if (cashoutLabel && cashoutBtn) {
            if (canCashout) {
              cashoutBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
              cashoutBtn.style.opacity = '1';
              cashoutBtn.style.boxShadow = '0 0 25px rgba(16, 185, 129, 0.5)';
              cashoutBtn.style.border = '2px solid rgba(255, 255, 255, 0.7)';
              cashoutLabel.innerHTML = `💰 RESGATAR ${this.formatBRL(currentProfitCents)} (${mult.toFixed(2)}x)`;
            } else {
              cashoutBtn.style.background = 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)';
              cashoutBtn.style.opacity = '0.96';
              cashoutBtn.style.boxShadow = '0 0 15px rgba(0, 0, 0, 0.6)';
              cashoutBtn.style.border = '2px solid rgba(255, 209, 102, 0.4)';
              cashoutLabel.innerHTML = `🔒 ${this.formatBRL(currentProfitCents)} (${mult.toFixed(2)}x)`;
            }
          }
        }

        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    },

    async executeCashout() {
      if (!this.activeWager.inProgress || this.activeWager.cashedOut) return;

      const isInfluencer = Boolean(this.user?.is_influencer);
      const currentDist = (window.__qt && window.__qt.distance != null) ? window.__qt.distance : (this.activeWager.distance || 0);
      const minMeters = window.__cashoutMinDistance || 10000;

      if (!isInfluencer && currentDist < minMeters) {
        const remaining = Math.max(0, minMeters - Math.floor(currentDist));
        const kmLabel = (minMeters >= 1000) ? `${(minMeters / 1000).toFixed(0)} km` : `${minMeters} metros`;
        const currentProfitCents = Math.floor(this.activeWager.betAmount * this.activeWager.multiplier);
        this.showToast(`🔒 Resgate bloqueado! Percorra a meta de ${kmLabel} (${minMeters}m) sem bater para liberar o saque. Faltam ${remaining} metros!`);
        return;
      }

      this.activeWager.cashedOut = true;
      this.activeWager.inProgress = false;

      const mult = this.activeWager.multiplier;
      const distance = this.activeWager.distance;
      const payoutCents = Math.floor(this.activeWager.betAmount * mult);

      // 1. Imediatamente para o jogo, áudio de corrida e retorna ao lobby principal
      this.returnToMenu();

      // 2. Registra o resgate no backend
      if (this.activeWager.mode === 'real') {
        try {
          const res = await this.api('/api/game/end', {
            method: 'POST',
            body: JSON.stringify({
              sessionId: this.activeWager.sessionId,
              action: 'cashout',
              multiplier: mult,
              distance
            })
          });

          if (this.user) {
            this.user.balance = res.balance_after;
            this.user.cash_balance = res.cash_balance;
          }
          this.updateBalanceUI();
        } catch (err) {
          console.error('[WagerEngine] Erro no cashout:', err);
        }
      }

      // 3. Toca som de vitória e exibe o modal sobre o menu
      this.playWinSound();
      this.showWinModal(payoutCents, mult, distance);
    },

    // Derrota / Batida no Tráfego: Exibe Pop-up de Revanche com Seleção de Aposta
    async onGameOver(details) {
      this.hideCashoutHUD();
      this.hideStartLoading();

      const gameOverEl = document.getElementById('gameover');
      if (gameOverEl) gameOverEl.classList.add('hidden');

      if (this.activeWager.inProgress && !this.activeWager.cashedOut) {
        this.activeWager.inProgress = false;
        const lostAmount = this.activeWager.betAmount;

        try {
          await this.api('/api/game/end', {
            method: 'POST',
            body: JSON.stringify({
              sessionId: this.activeWager.sessionId,
              action: 'crash',
              distance: details?.distance || this.activeWager.distance
            })
          });
          await this.loadUser();
        } catch (_) {}

        // Abre Pop-up de Revanche imediato
        this.showLossRevancheModal(lostAmount);
      }
    },

    bindHooks() {
      window.__onGameOverHook = (details) => {
        this.onGameOver(details);
      };
      window.__onGameStartHook = () => {
        const menuEl = document.getElementById('menu');
        if (menuEl) {
          menuEl.classList.add('hidden');
          menuEl.style.setProperty('display', 'none', 'important');
        }
        clearTimeout(this._loadingFailsafe);
        setTimeout(() => {
          this.hideStartLoading();
        }, 300);
      };

      const pauseMenuBtn = document.getElementById('pause-menu-btn');
      if (pauseMenuBtn) {
        pauseMenuBtn.addEventListener('click', () => {
          this.onReturnToMenu();
        });
      }
      const pauseRetryBtn = document.getElementById('pause-retry-btn');
      if (pauseRetryBtn) {
        pauseRetryBtn.addEventListener('click', () => {
          this.returnToMenuOrLoss();
        });
      }
    },

    // Modal de Derrota / Revanche
    showLossRevancheModal(lostAmountCents) {
      let modal = document.getElementById('loss-revanche-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'loss-revanche-modal';
        modal.className = 'wager-modal-overlay';
        document.body.appendChild(modal);
      }

      const balance = this.user?.balance || 0;
      const currentBet = this.activeWager.betAmount || 200;
      const hasBalance = balance >= currentBet;

      modal.innerHTML = `
        <div class="wager-modal-card" style="border-color: #e82127; text-align: center;">
          <div style="font-size: 50px; margin-bottom: 8px;">💥</div>
          <div class="modal-heading" style="color: #ff4d4f;">VOCÊ BATEU NO TRÁFEGO!</div>
          <div class="modal-sub">Aposta de <b>${this.formatBRL(lostAmountCents)}</b> perdida. Deseja correr novamente?</div>

          <div style="background: rgba(20, 24, 38, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; color: #94a3b8;">SEU SALDO:</span>
            <strong style="font-size: 18px; color: #ffd166; font-family: monospace;">${this.formatBRL(balance)}</strong>
          </div>

          <div style="font-size: 11px; color: #94a3b8; font-weight: 700; text-align: left; margin-bottom: 6px;">SELECIONE O VALOR DA PRÓXIMA APOSTA:</div>
          <div class="quick-bet-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 14px;">
            <button class="quick-btn ${currentBet === 100 ? 'active' : ''}" onclick="WagerEngine.setRevancheBet(100, this)">R$ 1</button>
            <button class="quick-btn ${currentBet === 200 ? 'active' : ''}" onclick="WagerEngine.setRevancheBet(200, this)">R$ 2</button>
            <button class="quick-btn ${currentBet === 500 ? 'active' : ''}" onclick="WagerEngine.setRevancheBet(500, this)">R$ 5</button>
            <button class="quick-btn ${currentBet === 1000 ? 'active' : ''}" onclick="WagerEngine.setRevancheBet(1000, this)">R$ 10</button>
            <button class="quick-btn ${currentBet === 2000 ? 'active' : ''}" onclick="WagerEngine.setRevancheBet(2000, this)">R$ 20</button>
            <button class="quick-btn ${currentBet === 5000 ? 'active' : ''}" onclick="WagerEngine.setRevancheBet(5000, this)">R$ 50</button>
          </div>

          <div id="revanche-action-btn-area">
            ${hasBalance ? `
              <button class="btn-start-race" onclick="document.getElementById('loss-revanche-modal').style.display='none'; WagerEngine.startWagerRace();" style="margin-bottom: 8px;">
                🏎️ JOGAR NOVAMENTE (${this.formatBRL(currentBet)})
              </button>
            ` : `
              <button class="btn-start-race" onclick="WagerEngine.openDepositModal()" style="background: linear-gradient(135deg, #10b981, #059669); margin-bottom: 8px;">
                ⚡ DEPOSITAR VIA PIX (SALDO INSUFICIENTE)
              </button>
            `}
          </div>

          <button class="btn-top btn-with" style="width: 100%; justify-content: center;" onclick="WagerEngine.returnToMenu()">
            🏠 VOLTAR AO LOBBY
          </button>
        </div>
      `;
      modal.style.display = 'flex';
    },

    setRevancheBet(cents, btn) {
      this.activeWager.betAmount = cents;
      this.activeWager.hasSelectedBet = true;
      document.querySelectorAll('#loss-revanche-modal .quick-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');

      const balance = this.user?.balance || 0;
      const hasBalance = balance >= cents;
      const area = document.getElementById('revanche-action-btn-area');
      if (area) {
        area.innerHTML = hasBalance ? `
          <button class="btn-start-race" onclick="document.getElementById('loss-revanche-modal').style.display='none'; WagerEngine.startWagerRace();" style="margin-bottom: 8px;">
            🏎️ JOGAR NOVAMENTE (${this.formatBRL(cents)})
          </button>
        ` : `
          <button class="btn-start-race" onclick="WagerEngine.openDepositModal()" style="background: linear-gradient(135deg, #10b981, #059669); margin-bottom: 8px;">
            ⚡ DEPOSITAR VIA PIX (SALDO INSUFICIENTE)
          </button>
        `;
      }
      this.updateStartButtonLabel();
    },

    showWinModal(payoutCents, multiplier, distance) {
      let modal = document.getElementById('win-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'win-modal';
        modal.className = 'wager-modal-overlay';
        document.body.appendChild(modal);
      }

      modal.innerHTML = `
        <div class="wager-modal-card" style="border-color: #10b981; text-align: center;">
          <div class="win-trophy">🏆</div>
          <div class="modal-heading" style="color: #6ee7b7;">RESGATE CONCLUÍDO!</div>
          <div class="modal-sub">Você pilotou com precisão e resgatou com lucro!</div>
          <div class="win-amount-badge">
            <span style="font-size: 13px; color: #94a3b8; display: block; margin-bottom: 4px;">LUCRO TOTAL:</span>
            <div class="win-payout-text">+ ${this.formatBRL(payoutCents)}</div>
            <div style="font-size: 14px; color: #ffd166; margin-top: 6px; font-family: monospace;">
              MULTIPLICADOR: <b>${multiplier.toFixed(2)}x</b> | DISTÂNCIA: <b>${distance}m</b>
            </div>
          </div>
          <button class="btn-start-race" onclick="document.getElementById('win-modal').style.display='none'; WagerEngine.startWagerRace();" style="background: linear-gradient(135deg, #10b981, #059669); margin-top: 14px;">
            🏁 CORRER NOVAMENTE (${this.formatBRL(this.activeWager.betAmount)})
          </button>
          <button class="btn-share-whatsapp" onclick="WagerEngine.shareWinWhatsApp(${payoutCents}, ${multiplier.toFixed(2)})" style="background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: #fff; width: 100%; border: none; padding: 13px 18px; border-radius: 12px; font-weight: 800; font-size: 15px; margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; box-shadow: 0 4px 18px rgba(37, 211, 102, 0.45); font-family: 'Rajdhani', sans-serif; letter-spacing: 0.5px;">
            <span>📲</span> <span>COMPARTILHAR NO WHATSAPP (+100% BÔNUS)</span>
          </button>
          <button class="btn-top btn-with" style="width: 100%; justify-content: center; margin-top: 8px;" onclick="WagerEngine.returnToMenu()">
            🏠 MENU PRINCIPAL
          </button>
        </div>
      `;
      modal.style.display = 'flex';
    },

    shareWhatsApp() {
      const text = `🏎️💨 *TESLA CASH - CORRIDA COM LUCRO REAL NO PIX!* ⚡💰\n\nAcabei de jogar no Tesla Cash! Pilote o Roadster em altíssima velocidade, desvie do tráfego e resgate seus lucros direto no PIX!\n\n🎁 *BÔNUS DE 100% NO PRIMEIRO DEPÓSITO!*\nDeposite a partir de R$ 50 e GANHE O DOBRO (Depositou R$ 50, joga com R$ 100 na hora)!\n\n👇 *Cadastre-se e venha lucrar agora:* \nhttps://teslacash.vercel.app`;
      const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    },

    shareWinWhatsApp(payoutCents, multiplier) {
      const val = this.formatBRL(payoutCents);
      const text = `💰🔥 *LUCRO CONFIRMADO NO TESLA CASH!* 🏎️💨\n\nAcabei de resgatar *${val}* (${multiplier}x) pilotando o Roadster no Tesla Cash!\n\n🎁 *CADASTRE-SE E GANHE 100% DE BÔNUS!*\nDeposite a partir de R$ 50 e dobre seu saldo na hora (Depositou R$ 50, joga com R$ 100)!\n\n👇 *Clique no link e venha jogar comigo:* \nhttps://teslacash.vercel.app`;
      const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    },

    // Depósito PIX VizzionPay (Interface estilo Fruit Cash)
    openDepositModal() {
      if (!this.user || this.user.is_guest) {
        this.showToast('⚠️ Crie sua conta de piloto ou faça login para depositar via PIX.');
        this.openAuthModal('register', true);
        return;
      }

      let modal = document.getElementById('deposit-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'deposit-modal';
        modal.className = 'wager-modal-overlay';
        document.body.appendChild(modal);
      }

      modal.innerHTML = `
        <div class="wager-modal-card fruit-deposit-card">
          <button class="modal-close-btn" onclick="document.getElementById('deposit-modal').style.display='none'">×</button>
          
          <div class="deposit-header-fruit">
            <div class="deposit-badge-icon">⚡</div>
            <div>
              <div class="deposit-title-main">DEPÓSITO VIA PIX</div>
              <div class="deposit-subtitle">Crédito automático em segundos na sua carteira</div>
            </div>
          </div>

          <!-- Banner de Bônus 100% estilo Fruit -->
          <div class="fruit-bonus-banner">
            <div class="bonus-tag-pill" style="background: linear-gradient(135deg, #10b981, #059669); color: #fff;">🎁 BÔNUS DE 100% (A PARTIR DE R$ 50)</div>
            <div class="bonus-headline">DOBRE SEU SALDO A PARTIR DE R$ 50!</div>
            <div class="bonus-desc">
              Depósitos de <b>R$ 50 ou mais</b> ativam <b>+100% de bônus imediato</b> para dobrar suas chances de lucrar!
              <span style="display: block; margin-top: 4px; color: #f87171; font-size: 10.5px;">* Depósitos de R$ 20 a R$ 49 são creditados com saldo normal (sem bônus).</span>
            </div>
          </div>

          <div class="deposit-section-label">SELECIONE O VALOR DO DEPÓSITO:</div>

          <!-- Grade de Valores Rápidos estilo Fruit Cash -->
          <div class="fruit-values-grid">
            <div class="fruit-val-card" onclick="WagerEngine.setFruitDepAmount(20, this)">
              <span class="f-val">R$ 20</span>
              <span class="f-bonus no-bonus">SEM BÔNUS</span>
            </div>
            <div class="fruit-val-card" onclick="WagerEngine.setFruitDepAmount(30, this)">
              <span class="f-val">R$ 30</span>
              <span class="f-bonus no-bonus">SEM BÔNUS</span>
            </div>
            <div class="fruit-val-card active" onclick="WagerEngine.setFruitDepAmount(50, this)">
              <span class="f-badge">⭐ DOBRA SEU SALDO</span>
              <span class="f-val">R$ 50</span>
              <span class="f-bonus active-bonus">+ R$ 50 BÔNUS</span>
            </div>
            <div class="fruit-val-card" onclick="WagerEngine.setFruitDepAmount(100, this)">
              <span class="f-badge hot">🔥 POPULAR</span>
              <span class="f-val">R$ 100</span>
              <span class="f-bonus active-bonus">+ R$ 100 BÔNUS</span>
            </div>
            <div class="fruit-val-card" onclick="WagerEngine.setFruitDepAmount(200, this)">
              <span class="f-val">R$ 200</span>
              <span class="f-bonus active-bonus">+ R$ 200 BÔNUS</span>
            </div>
            <div class="fruit-val-card" onclick="WagerEngine.setFruitDepAmount(500, this)">
              <span class="f-badge vip">👑 VIP</span>
              <span class="f-val">R$ 500</span>
              <span class="f-bonus active-bonus">+ R$ 500 BÔNUS</span>
            </div>
          </div>

          <!-- Campo de Outro Valor -->
          <div class="fruit-custom-wrap">
            <div class="custom-label">Ou digite outro valor (Mínimo R$ 20):</div>
            <div class="wager-input-row fruit-input-row">
              <span class="wager-currency">R$</span>
              <input type="number" id="dep-val-input" class="wager-input" value="50" min="20" step="5" oninput="WagerEngine.onFruitCustomInput(this.value)" />
            </div>
            <div id="bonus-helper-tip" style="font-size: 11.5px; margin-top: 6px; font-weight: 700; color: #34d399;">
              🎉 <b>BÔNUS DE 100% ATIVADO!</b> Você vai receber +R$ 50,00 e jogar com <b>R$ 100,00</b>!
            </div>
          </div>

          <!-- Botão Chamativo de Ação Estilo Fruit -->
          <button class="btn-deposit-fruit" id="btn-gen-pix" onclick="WagerEngine.generatePixDeposit()">
            <span class="btn-fruit-bolt">⚡</span>
            <span id="btn-fruit-text">DEPOSITAR R$ 50,00 (+ R$ 50,00 BÔNUS = R$ 100,00)</span>
          </button>

          <!-- Badges de Segurança -->
          <div class="fruit-security-footer">
            <span>🔒 Pagamento Seguro 256-bit</span>
            <span>⚡ Compensação Imediata via Banco Central</span>
          </div>

          <div id="pix-qr-area" style="display: none;"></div>
        </div>
      `;
      modal.style.display = 'flex';
    },

    setFruitDepAmount(val, el) {
      const input = document.getElementById('dep-val-input');
      if (input) input.value = val;
      document.querySelectorAll('.fruit-val-card').forEach(c => c.classList.remove('active'));
      if (el) el.classList.add('active');
      this.updateFruitDepositBtn(val);
    },

    onFruitCustomInput(val) {
      const num = parseFloat(val) || 0;
      document.querySelectorAll('.fruit-val-card').forEach(c => c.classList.remove('active'));
      this.updateFruitDepositBtn(num);
    },

    updateFruitDepositBtn(val) {
      const btnText = document.getElementById('btn-fruit-text');
      const helper = document.getElementById('bonus-helper-tip');
      const num = Math.max(0, Number(val) || 0);
      const formatted = this.formatBRL(num * 100);

      if (num >= 50) {
        const bonusFormatted = this.formatBRL(num * 100);
        const totalFormatted = this.formatBRL(num * 200);
        if (btnText) btnText.textContent = `DEPOSITAR ${formatted} (+ ${bonusFormatted} BÔNUS = ${totalFormatted})`;
        if (helper) {
          helper.style.color = '#34d399';
          helper.innerHTML = `🎉 <b>BÔNUS DE 100% ATIVADO!</b> Você vai receber +${bonusFormatted} e jogar com <b>${totalFormatted}</b>!`;
        }
      } else {
        if (btnText) btnText.textContent = `DEPOSITAR ${formatted} (SEM BÔNUS)`;
        if (helper) {
          const falta = (50 - num).toFixed(2).replace('.', ',');
          helper.style.color = '#f59e0b';
          helper.innerHTML = `💡 <b>Atenção:</b> Bônus de 100% a partir de R$ 50! Faltam R$ ${falta} para DOBRAR seu saldo.`;
        }
      }
    },

    setDepAmount(val, btn) {
      this.setFruitDepAmount(val, btn);
    },

    async generatePixDeposit() {
      const input = document.getElementById('dep-val-input');
      const val = parseFloat(input?.value || '20');
      if (val < 20) {
        this.showToast('O valor mínimo de depósito é de R$ 20,00.');
        return;
      }

      const btn = document.getElementById('btn-gen-pix');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⚡</span> <span>Gerando PIX oficial...</span>';
      }

      try {
        const res = await this.api('/api/wallet/deposit', {
          method: 'POST',
          body: JSON.stringify({ amount: Math.round(val * 100) })
        });

        const area = document.getElementById('pix-qr-area');
        if (area) {
          area.style.display = 'block';
          const bonusText = res.bonusAmount > 0 ? ` (+ ${this.formatBRL(res.bonusAmount)} de Bônus = ${this.formatBRL(res.amount + res.bonusAmount)} total)` : '';
          area.innerHTML = `
            <div class="pix-qr-container fruit-pix-container">
              <div class="deposit-countdown" id="pix-timer">⏱️ Código expira em 10:00</div>
              <div class="pix-qr-frame">
                <img src="${res.qrCodeUrl}" alt="QR Code PIX VizzionPay" class="pix-qr-img" />
              </div>
              <div class="pix-value-tag">
                Valor: <strong style="color: #6ee7b7; font-size: 17px;">${this.formatBRL(res.amount)}</strong> ${bonusText}
              </div>
              <div class="pix-instruction">
                Abra seu aplicativo de banco e escolha <b>Pagar com PIX Copia e Cola</b> ou <b>Escanear QR Code</b>:
              </div>
              <div class="pix-code-box">
                <input type="text" id="pix-code-text" class="pix-code-input" value="${res.pixCode}" readonly />
                <button class="btn-copy-pix" id="btn-copy-pix" onclick="WagerEngine.copyPix()">📋 COPIAR PIX</button>
              </div>
              <button class="btn-verify-now" onclick="WagerEngine.checkDepositNow('${res.depositId}')">
                🔄 JÁ FIZ O PIX / VERIFICAR AGORA
              </button>
              <div class="pix-status-radar">
                <span class="live-dot pulse"></span>
                <span>Aguardando compensação pelo banco em tempo real...</span>
              </div>
            </div>
          `;
        }

        if (btn) btn.style.display = 'none';
        this.startPixCountdown(600);
        this.startDepositPolling(res.depositId);
      } catch (err) {
        this.showToast('Erro ao gerar PIX: ' + err.message);
        if (btn) {
          btn.disabled = false;
          this.updateFruitDepositBtn(val);
        }
      }
    },

    startPixCountdown(seconds) {
      if (this._pixCountdownTimer) clearInterval(this._pixCountdownTimer);
      let remaining = seconds;
      const el = document.getElementById('pix-timer');
      this._pixCountdownTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(this._pixCountdownTimer);
          if (el) el.textContent = '⚠️ Código PIX expirado. Gere um novo se necessário.';
          return;
        }
        const mins = Math.floor(remaining / 60).toString().padStart(2, '0');
        const secs = (remaining % 60).toString().padStart(2, '0');
        if (el) el.textContent = `⏱️ Código expira em ${mins}:${secs}`;
      }, 1000);
    },

    async checkDepositNow(depositId) {
      this.showToast('🔍 Consultando confirmação no banco...');
      try {
        const res = await this.api(`/api/wallet/check-deposit/${encodeURIComponent(depositId)}`);
        if (res && res.status === 'approved') {
          this.handleDepositSuccess(res);
        } else {
          this.showToast('Pagamento ainda aguardando compensação pelo banco. Se já realizou a transferência, o saldo será creditado automaticamente em instantes.');
        }
      } catch (err) {
        this.showToast('Erro ao verificar status: ' + err.message);
      }
    },

    handleDepositSuccess(res) {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
      }
      if (this._pixCountdownTimer) {
        clearInterval(this._pixCountdownTimer);
        this._pixCountdownTimer = null;
      }

      if (this.user) {
        this.user.balance = res.balance;
        this.user.cash_balance = res.cash_balance;
      }
      this.updateBalanceUI();

      const area = document.getElementById('pix-qr-area');
      if (area) {
        area.innerHTML = `
          <div style="background: rgba(16, 185, 129, 0.2); border: 1.5px solid #10b981; border-radius: 12px; padding: 22px; text-align: center; margin-top: 15px;">
            <div style="font-size: 42px; color: #6ee7b7; margin-bottom: 8px;">✓</div>
            <strong style="color: #6ee7b7; font-size: 19px; display: block; margin-bottom: 6px;">PAGAMENTO CONFIRMADO!</strong>
            <p style="color: #f1f5f2; font-size: 13.5px; margin-bottom: 16px;">Seu saldo de <b>${this.formatBRL(res.amount + (res.bonusAmount || 0))}</b> foi creditado na sua conta!</p>
            <button class="btn-start-race" onclick="document.getElementById('deposit-modal').style.display='none'" style="background: linear-gradient(135deg, #10b981, #059669);">
              🏎️ JOGAR AGORA
            </button>
          </div>
        `;
      }

      this.playWinSound();
      this.showToast('🎉 Pagamento confirmado com sucesso! Saldo creditado.');
    },

    copyPix() {
      const input = document.getElementById('pix-code-text');
      const btn = document.getElementById('btn-copy-pix');
      if (input) {
        input.select();
        navigator.clipboard.writeText(input.value);
        if (btn) {
          const original = btn.textContent;
          btn.textContent = '✓ COPIADO!';
          btn.style.background = '#10b981';
          btn.style.color = '#fff';
          setTimeout(() => {
            btn.textContent = original;
            btn.style.background = '';
            btn.style.color = '';
          }, 2500);
        }
        this.showToast('📋 Código PIX copiado com sucesso! Pague no app do seu banco.');
      }
    },

    startDepositPolling(depositId) {
      if (this.pollingTimer) clearInterval(this.pollingTimer);

      this.pollingTimer = setInterval(async () => {
        try {
          const res = await this.api(`/api/wallet/check-deposit/${encodeURIComponent(depositId)}`);
          if (res && res.status === 'approved') {
            this.handleDepositSuccess(res);
          }
        } catch (_) {}
      }, 3000);
    },

    openWithdrawModal() {
      if (!this.user || this.user.is_guest) {
        this.showToast('⚠️ Crie sua conta de piloto ou faça login para solicitar saques.');
        this.openAuthModal('login', true);
        return;
      }

      let modal = document.getElementById('withdraw-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'withdraw-modal';
        modal.className = 'wager-modal-overlay';
        document.body.appendChild(modal);
      }

      const available = this.formatBRL(this.user?.cash_balance || 0);

      modal.innerHTML = `
        <div class="wager-modal-card">
          <button class="modal-close-btn" onclick="document.getElementById('withdraw-modal').style.display='none'">×</button>
          <div class="modal-heading">SACAR VIA PIX</div>
          <div class="modal-sub">Transferência direta para sua chave PIX</div>

          <div style="background: rgba(20, 24, 38, 0.8); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
            <span style="font-size: 12px; color: #94a3b8; display: block;">Saldo disponível para saque:</span>
            <strong style="font-size: 20px; color: #ffd166; font-family: monospace;">${available}</strong>
          </div>

          <div style="font-size: 12px; color: #94a3b8; font-weight: 700; margin-bottom: 6px;">TIPO DE CHAVE:</div>
          <select id="wth-type" class="pix-code-input" style="margin-bottom: 12px; padding: 10px;">
            <option value="cpf">CPF</option>
            <option value="telefone">Celular (Telefone)</option>
            <option value="email">E-mail</option>
            <option value="evp">Chave Aleatória (EVP)</option>
          </select>

          <div style="font-size: 12px; color: #94a3b8; font-weight: 700; margin-bottom: 6px;">SUA CHAVE PIX:</div>
          <input type="text" id="wth-key" class="pix-code-input" placeholder="Digite sua chave PIX" style="margin-bottom: 14px;" />

          <div style="font-size: 12px; color: #94a3b8; font-weight: 700; margin-bottom: 6px;">VALOR DO SAQUE:</div>
          <div class="wager-input-row" style="margin-bottom: 18px;">
            <span class="wager-currency">R$</span>
            <input type="number" id="wth-val" class="wager-input" value="10" min="10" step="5" />
          </div>

          <button class="btn-start-race" onclick="WagerEngine.submitWithdraw()" style="background: linear-gradient(135deg, #10b981, #059669);">
            💸 SOLICITAR SAQUE
          </button>
        </div>
      `;
      modal.style.display = 'flex';
    },

    async submitWithdraw() {
      const key = document.getElementById('wth-key')?.value?.trim();
      const type = document.getElementById('wth-type')?.value;
      const val = parseFloat(document.getElementById('wth-val')?.value || '0');

      if (!key) {
        this.showToast('Informe sua chave PIX.');
        return;
      }
      if (val < 10) {
        this.showToast('O valor mínimo para saque é de R$ 10,00.');
        return;
      }

      try {
        const res = await this.api('/api/wallet/withdraw', {
          method: 'POST',
          body: JSON.stringify({
            amount: Math.round(val * 100),
            pixKey: key,
            pixType: type
          })
        });

        if (this.user) {
          this.user.balance = res.balance;
          this.user.cash_balance = res.cash_balance;
        }
        this.updateBalanceUI();

        document.getElementById('withdraw-modal').style.display = 'none';
        this.showToast('✅ Solicitação de saque enviada com sucesso!');
      } catch (err) {
        this.showToast('Erro ao solicitar saque: ' + err.message);
      }
    },

    playWinSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.1);
          gain.gain.setValueAtTime(0.2, now + idx * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.1);
          osc.stop(now + idx * 0.1 + 0.4);
        });
      } catch (_) {}
    }
  };

  window.WagerEngine = WagerEngine;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => WagerEngine.init());
  } else {
    WagerEngine.init();
  }
})();
