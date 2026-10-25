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
    },

    async loadUser() {
      try {
        if (this.token) {
          const data = await this.api('/api/auth/me');
          this.user = data;
        } else {
          const guest = await this.api('/api/auth/guest', {
            method: 'POST',
            body: JSON.stringify({ name: localStorage.getItem('pilot_name') || '' })
          });
          this.token = guest.token;
          localStorage.setItem('roadster_token', guest.token);
          this.user = guest.user;
        }
      } catch (err) {
        console.warn('[WagerEngine] Sessão renovada.');
        try {
          const guest = await this.api('/api/auth/guest', { method: 'POST' });
          this.token = guest.token;
          localStorage.setItem('roadster_token', guest.token);
          this.user = guest.user;
        } catch (_) {}
      }

      // Sincroniza modo influenciador com o motor 3D
      if (this.user && (this.user.is_influencer || this.user.difficulty === 'influencer')) {
        window.__isInfluencerActive = true;
        console.log('⭐ [WagerEngine] MODO INFLUENCER ATIVADO para este piloto!');
      } else {
        window.__isInfluencerActive = false;
      }

      this.updateBalanceUI();
    },

    updateBalanceUI() {
      const balanceEl = document.getElementById('topbar-balance');
      if (!balanceEl) return;

      if (this.activeWager.mode === 'demo') {
        balanceEl.textContent = this.formatBRL(this.demoBalance) + ' (DEMO)';
        balanceEl.style.color = '#38bdf8';
      } else {
        const total = (this.user?.balance != null) ? this.user.balance : 0;
        balanceEl.textContent = this.formatBRL(total);
        balanceEl.style.color = '#ffd166';
      }

      const pilotEl = document.getElementById('topbar-pilot');
      if (pilotEl && this.user) {
        pilotEl.innerHTML = `${this.user.username} ${this.user.is_influencer ? '<span style="color:#ffd166;font-size:11px;">⭐ INFLUENCER</span>' : ''}`;
      }
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
          <div class="modal-sub">Crédito instantâneo via VizzionPay</div>

          <div class="promo-badge">
            <span style="font-size: 20px;">🎁</span>
            <div>
              <strong style="color: #ffd166; display: block;">+100% DE BÔNUS ATIVO!</strong>
              <span style="font-size: 11px; color: #cbd5e1;">Deposite a partir de R$ 20 e dobre seu saldo.</span>
            </div>
          </div>

          <div style="font-size: 12px; color: #94a3b8; font-weight: 700; margin-bottom: 8px;">ESCOLHA O VALOR:</div>
          <div class="quick-bet-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 12px;">
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(20)">R$ 20</button>
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(30)">R$ 30</button>
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(50)">R$ 50</button>
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(100)">R$ 100</button>
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(200)">R$ 200</button>
            <button class="quick-btn" onclick="WagerEngine.setDepAmount(500)">R$ 500</button>
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

    setDepAmount(val) {
      const input = document.getElementById('dep-val-input');
      if (input) input.value = val;
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
        btn.textContent = 'Gerando PIX seguro...';
      }

      try {
        const res = await this.api('/api/wallet/deposit', {
          method: 'POST',
          body: JSON.stringify({ amount: Math.round(val * 100) })
        });

        const area = document.getElementById('pix-qr-area');
        if (area) {
          area.style.display = 'block';
          area.innerHTML = `
            <div class="pix-qr-container">
              <img src="${res.qrCodeUrl}" alt="QR Code PIX" class="pix-qr-img" />
              <div style="font-size: 12px; color: #94a3b8; text-align: center;">
                Escaneie o QR Code ou copie o código abaixo:
              </div>
              <div class="pix-code-box">
                <input type="text" id="pix-code-text" class="pix-code-input" value="${res.pixCode}" readonly />
                <button class="btn-copy-pix" onclick="WagerEngine.copyPix()">COPIAR</button>
              </div>
              <div style="font-size: 11px; color: #10b981; font-weight: 600; text-align: center; margin-top: 4px;">
                🔄 Aguardando confirmação do pagamento...
              </div>
            </div>
          `;
        }

        if (btn) btn.style.display = 'none';
        this.startDepositPolling(res.depositId);
      } catch (err) {
        this.showToast('Erro ao gerar PIX: ' + err.message);
        if (btn) {
          btn.disabled = false;
          btn.textContent = '⚡ GERAR PIX';
        }
      }
    },

    copyPix() {
      const input = document.getElementById('pix-code-text');
      if (input) {
        input.select();
        navigator.clipboard.writeText(input.value);
        this.showToast('📋 Código PIX copiado com sucesso! Pague no app do seu banco.');
      }
    },

    startDepositPolling(depositId) {
      if (this.pollingTimer) clearInterval(this.pollingTimer);

      this.pollingTimer = setInterval(async () => {
        try {
          const res = await this.api(`/api/wallet/check-deposit/${encodeURIComponent(depositId)}`);
          if (res && res.status === 'approved') {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;

            if (this.user) {
              this.user.balance = res.balance;
              this.user.cash_balance = res.cash_balance;
            }
            this.updateBalanceUI();

            const area = document.getElementById('pix-qr-area');
            if (area) {
              area.innerHTML = `
                <div style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; border-radius: 10px; padding: 20px; text-align: center; margin-top: 15px;">
                  <div style="font-size: 36px; color: #6ee7b7; margin-bottom: 8px;">✓</div>
                  <strong style="color: #6ee7b7; font-size: 17px; display: block; margin-bottom: 5px;">PAGAMENTO CONFIRMADO!</strong>
                  <p style="color: #f1f5f2; font-size: 13px; margin-bottom: 14px;">Seu saldo de <b>${this.formatBRL(res.amount + (res.bonusAmount || 0))}</b> já foi creditado!</p>
                  <button class="btn-start-race" onclick="document.getElementById('deposit-modal').style.display='none'">
                    🏁 JOGAR AGORA
                  </button>
                </div>
              `;
            }

            this.playWinSound();
            this.showToast('🎉 Pagamento confirmado! Saldo creditado.');
          }
        } catch (_) {}
      }, 3500);
    },

    openWithdrawModal() {
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
