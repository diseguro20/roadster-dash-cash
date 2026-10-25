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
      mode: 'real', // 'real' | 'demo'
      betAmount: 200, // em centavos (R$ 2,00)
      hasSelectedBet: true,
      sessionId: null,
      multiplier: 1.0,
      cashedOut: false,
      distance: 0
    },
    demoBalance: 5000,
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

      // Sincroniza modo influenciador com o motor 3D
      if (this.user && (this.user.is_influencer || this.user.difficulty === 'influencer')) {
        window.__isInfluencerActive = true;
        console.log('⭐ [WagerEngine] MODO INFLUENCER ATIVADO para este piloto!');
      } else {
        window.__isInfluencerActive = false;
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
            ${this.user.is_influencer ? '<span class="influencer-badge">⭐ INFLUENCER</span>' : ''}
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

      if (this.activeWager.mode === 'demo') {
        balanceEl.textContent = this.formatBRL(this.demoBalance) + ' (DEMO)';
        balanceEl.style.color = '#38bdf8';
      } else {
        const total = (this.user?.balance != null) ? this.user.balance : 0;
        balanceEl.textContent = this.formatBRL(total);
        balanceEl.style.color = '#ffd166';
      }
    },

    openAuthModal(tab = 'register', isGate = false) {
      const modal = document.getElementById('auth-modal');
      if (!modal) return;
      this.setAuthTab(tab);
      const regErr = document.getElementById('reg-error-msg');
      if (regErr) regErr.style.display = 'none';
      const logErr = document.getElementById('login-error-msg');
      if (logErr) logErr.style.display = 'none';

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
      const emailInput = document.getElementById('reg-email');
      const phoneInput = document.getElementById('reg-phone');
      const passInput = document.getElementById('reg-password');
      const passConfirmInput = document.getElementById('reg-password-confirm');
      const errEl = document.getElementById('reg-error-msg');
      const btn = document.getElementById('btn-submit-reg');

      const username = usernameInput?.value?.trim() || '';
      const email = emailInput?.value?.trim() || '';
      const phone = phoneInput?.value?.trim() || '';
      const password = passInput?.value || '';
      const confirm = passConfirmInput?.value || '';

      if (username.length < 3) {
        if (errEl) {
          errEl.textContent = 'O nome de usuário deve ter pelo menos 3 caracteres.';
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
          body: JSON.stringify({ username, email, phone, password })
        });

        this.token = res.token;
        localStorage.setItem('roadster_token', res.token);
        this.user = res.user;
        this.user.is_guest = false;

        this.closeAuthModal();
        this.updateBalanceUI();
        this.updateAuthUI();
        this.showToast(`🎉 Conta criada com sucesso! Boas corridas, ${this.user.username}!`);
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Erro ao criar conta.';
          errEl.style.display = 'block';
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🏁 CRIAR CONTA E JOGAR';
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
      const modeBtns = document.querySelectorAll('.mode-btn');

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

      modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          modeBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.activeWager.mode = btn.dataset.mode;
          this.updateBalanceUI();
          this.updateStartButtonLabel();
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
      if (this.activeWager.mode === 'demo') {
        btn.innerHTML = `🎮 CORRIDA TREINO (${formatted})`;
        btn.style.background = 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)';
      } else {
        btn.innerHTML = `🏎️ INICIAR CORRIDA (${formatted})`;
        btn.style.background = 'linear-gradient(135deg, #e82127 0%, #b8151a 100%)';
      }
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
      this.activeWager.inProgress = false;
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
      if (menuEl) menuEl.classList.remove('hidden');
      this.updateBalanceUI();
    },

    onReturnToMenu() {
      this.hideCashoutHUD();
      this.hideStartLoading();
      this.activeWager.inProgress = false;
      this._isStartingRace = false;

      const lossModal = document.getElementById('loss-revanche-modal');
      if (lossModal) lossModal.style.display = 'none';
      const hudEl = document.getElementById('hud');
      if (hudEl) hudEl.classList.add('hidden');
      const gameOverEl = document.getElementById('gameover');
      if (gameOverEl) gameOverEl.classList.add('hidden');
      const menuEl = document.getElementById('menu');
      if (menuEl) menuEl.classList.remove('hidden');
    },

    async startWagerRace() {
      if (this._isStartingRace) return;

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
      if (this.activeWager.mode === 'real') {
        const currentBalance = (this.user?.balance != null) ? this.user.balance : 0;
        if (currentBalance < amount) {
          this.showToast(`⚠️ Saldo insuficiente! Você possui ${this.formatBRL(currentBalance)} e escolheu apostar ${formattedAmount}. Faça um PIX para jogar.`);
          this.openDepositModal();
          return;
        }
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

      if (this.activeWager.mode === 'real') {
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
      } else {
        // Modo Demo
        if (this.demoBalance < amount) this.demoBalance += 10000;
        this.demoBalance -= amount;
        this.activeWager.sessionId = 'demo_' + Date.now();
        this.activeWager.inProgress = true;
        this.activeWager.cashedOut = false;
        this.activeWager.multiplier = 1.0;
        this.activeWager.distance = 0;
        this.updateBalanceUI();
      }

      this.updateStartLoadingStatus('🚀 Carregando pista 3D e liberando propulsores...');

      // Ativa HUD de Cashout
      this.showCashoutHUD();

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
          if (cashoutLabel) {
            cashoutLabel.innerHTML = `💰 RESGATAR ${this.formatBRL(currentProfitCents)} (${mult.toFixed(2)}x)`;
          }
        }

        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    },

    async executeCashout() {
      if (!this.activeWager.inProgress || this.activeWager.cashedOut) return;
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
      } else {
        this.demoBalance += payoutCents;
        this.updateBalanceUI();
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

        if (this.activeWager.mode === 'real') {
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
        }

        // Abre Pop-up de Revanche imediato
        this.showLossRevancheModal(lostAmount);
      }
    },

    bindHooks() {
      window.__onGameOverHook = (details) => {
        this.onGameOver(details);
      };
      window.__onGameStartHook = () => {
        clearTimeout(this._loadingFailsafe);
        setTimeout(() => {
          this.hideStartLoading();
        }, 300);
      };
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

      const balance = (this.activeWager.mode === 'real') ? (this.user?.balance || 0) : this.demoBalance;
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

      const balance = (this.activeWager.mode === 'real') ? (this.user?.balance || 0) : this.demoBalance;
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
          <button class="btn-top btn-with" style="width: 100%; justify-content: center; margin-top: 8px;" onclick="WagerEngine.returnToMenu()">
            🏠 MENU PRINCIPAL
          </button>
        </div>
      `;
      modal.style.display = 'flex';
    },

    // Depósito PIX VizzionPay
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
        <div class="wager-modal-card">
          <button class="modal-close-btn" onclick="document.getElementById('deposit-modal').style.display='none'">×</button>
          <div class="modal-heading">DEPOSITAR VIA PIX</div>
          <div class="modal-sub">Crédito instantâneo e seguro via VizzionPay</div>

          <div class="promo-badge">
            <span style="font-size: 20px;">🎁</span>
            <div>
              <strong style="color: #ffd166; display: block;">+100% DE BÔNUS ATIVO!</strong>
              <span style="font-size: 11px; color: #cbd5e1;">Deposite a partir de R$ 20 e dobre seu saldo inicial.</span>
            </div>
          </div>

          <div style="font-size: 12px; color: #94a3b8; font-weight: 700; margin-bottom: 8px;">ESCOLHA O VALOR:</div>
          <div class="quick-bet-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 12px;">
            <button class="quick-btn active" onclick="WagerEngine.setDepAmount(20, this)">R$ 20</button>
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(30, this)">R$ 30</button>
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(50, this)">R$ 50</button>
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(100, this)">R$ 100</button>
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(200, this)">R$ 200</button>
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(500, this)">R$ 500</button>
          </div>

          <div class="wager-input-row">
            <span class="wager-currency">R$</span>
            <input type="number" id="dep-val-input" class="wager-input" value="20" min="20" step="5" />
          </div>

          <button class="btn-start-race" id="btn-gen-pix" onclick="WagerEngine.generatePixDeposit()" style="background: linear-gradient(135deg, #10b981, #059669); margin-top: 10px;">
            ⚡ GERAR PIX
          </button>

          <div id="pix-qr-area" style="display: none;"></div>
        </div>
      `;
      modal.style.display = 'flex';
    },

    setDepAmount(val, btn) {
      const input = document.getElementById('dep-val-input');
      if (input) input.value = val;
      document.querySelectorAll('#deposit-modal .quick-btn').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
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
        btn.textContent = 'Gerando PIX oficial...';
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
            <div class="pix-qr-container">
              <div class="deposit-countdown" id="pix-timer">⏱️ Código expira em 10:00</div>
              <img src="${res.qrCodeUrl}" alt="QR Code PIX VizzionPay" class="pix-qr-img" />
              <div style="font-size: 13.5px; color: #ffd166; font-weight: 700; text-align: center;">
                Valor: ${this.formatBRL(res.amount)}${bonusText}
              </div>
              <div style="font-size: 12px; color: #94a3b8; text-align: center; max-width: 320px;">
                Abra seu banco, escolha <b>PIX Copia e Cola</b> ou <b>Escanear QR Code</b>:
              </div>
              <div class="pix-code-box">
                <input type="text" id="pix-code-text" class="pix-code-input" value="${res.pixCode}" readonly />
                <button class="btn-copy-pix" id="btn-copy-pix" onclick="WagerEngine.copyPix()">COPIAR</button>
              </div>
              <button class="btn-verify-now" onclick="WagerEngine.checkDepositNow('${res.depositId}')">
                🔄 JÁ FIZ O PIX / VERIFICAR AGORA
              </button>
              <div style="font-size: 11px; color: #10b981; font-weight: 600; text-align: center; margin-top: 6px;">
                🔄 Atualização automática a cada 3 segundos...
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
          btn.textContent = '⚡ GERAR PIX';
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
