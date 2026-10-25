/**
 * ROADSTER DASH CASH - SKILL WAGERING & PIX ENGINE
 * Gerenciador de apostas por habilidade, VizzionPay PIX e integrador de HUD
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
      sessionId: null,
      multiplier: 1.0,
      cashedOut: false,
      distance: 0
    },
    demoBalance: 5000, // R$ 50,00 demo
    pollingTimer: null,

    // Formata centavos em BRL
    formatBRL(cents) {
      const v = (Number(cents || 0) / 100);
      return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },

    // Notificação Toast
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

    // Requisição com autenticação
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

    // Inicialização
    async init() {
      console.log('🏎️ [WagerEngine] Inicializando motor de apostas Roadster Dash Cash...');
      this.bindHooks();
      await this.loadUser();
      this.initBetControls();
      this.updateBalanceUI();
    },

    // Carrega usuário ou cria convidado
    async loadUser() {
      try {
        if (this.token) {
          const data = await this.api('/api/auth/me');
          this.user = data;
        } else {
          // Cria piloto guest imediato para o jogador não perder tempo
          const guest = await this.api('/api/auth/guest', {
            method: 'POST',
            body: JSON.stringify({ name: localStorage.getItem('pilot_name') || '' })
          });
          this.token = guest.token;
          localStorage.setItem('roadster_token', guest.token);
          this.user = guest.user;
        }
      } catch (err) {
        console.warn('[WagerEngine] Falha ao carregar sessão, gerando nova:', err.message);
        try {
          const guest = await this.api('/api/auth/guest', { method: 'POST' });
          this.token = guest.token;
          localStorage.setItem('roadster_token', guest.token);
          this.user = guest.user;
        } catch (_) {}
      }
      this.updateBalanceUI();
    },

    // Atualiza saldo na tela
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
        pilotEl.textContent = this.user.username;
      }
    },

    // Configura botões de aposta no lobby
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
          input.value = (this.activeWager.betAmount / 100).toFixed(2);
          this.updateStartButtonLabel();
        });
      }

      quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const val = parseFloat(btn.dataset.val);
          if (val) {
            this.activeWager.betAmount = Math.round(val * 100);
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

      // Atalho de Cashout via Teclado (Tecla Espaço ou C durante o jogo)
      window.addEventListener('keydown', (e) => {
        if ((e.code === 'Space' || e.code === 'KeyC') && this.activeWager.inProgress && !this.activeWager.cashedOut) {
          // Se o HUD de cashout estiver visível e a corrida rolando
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

    // Inicia a corrida valendo aposta
    async startWagerRace() {
      const amount = this.activeWager.betAmount;

      if (this.activeWager.mode === 'real') {
        if (!this.user || (this.user.balance || 0) < amount) {
          this.showToast('⚠️ Saldo insuficiente! Faça um depósito via PIX para continuar.');
          this.openDepositModal();
          return;
        }

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
          this.showToast('Erro ao iniciar corrida: ' + err.message);
          return;
        }
      } else {
        // Modo Demo
        if (this.demoBalance < amount) {
          this.demoBalance += 10000; // Recarrega demo
        }
        this.demoBalance -= amount;
        this.activeWager.sessionId = 'demo_' + Date.now();
        this.activeWager.inProgress = true;
        this.activeWager.cashedOut = false;
        this.activeWager.multiplier = 1.0;
        this.activeWager.distance = 0;
        this.updateBalanceUI();
      }

      // Ativa o HUD de Cashout
      this.showCashoutHUD();

      // Dispara o jogo Roadster original
      const origPlayBtn = document.getElementById('play-btn');
      if (origPlayBtn) {
        origPlayBtn.click();
      }
    },

    // Mostra HUD de Cashout em tempo real
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
            <span class="cashout-shortcut">ESPAÇO</span>
          </button>
        `;
        document.body.appendChild(cashoutBtnContainer);
        document.getElementById('btn-cashout').addEventListener('click', () => {
          this.executeCashout();
        });
      }
      cashoutBtnContainer.style.display = 'block';

      // Inicia loop de leitura de distância e multiplicador
      this.startMultiplierLoop();
    },

    hideCashoutHUD() {
      const hud = document.getElementById('wager-hud');
      if (hud) hud.style.display = 'none';
      const btn = document.getElementById('btn-cashout-container');
      if (btn) btn.style.display = 'none';
    },

    // Loop do multiplicador em tempo real baseado na distância percorrida
    startMultiplierLoop() {
      const multEl = document.getElementById('wager-mult-live');
      const profitEl = document.getElementById('wager-profit-live');
      const cashoutLabel = document.getElementById('cashout-label');

      const tick = () => {
        if (!this.activeWager.inProgress || this.activeWager.cashedOut) return;

        // Lê distância do jogo original
        let currentDist = 0;
        if (window.__qt && window.__qt.distance != null) {
          currentDist = window.__qt.distance;
        } else {
          const distEl = document.getElementById('dist');
          if (distEl) {
            currentDist = parseFloat(distEl.textContent.replace(/[^\d.-]/g, '')) || 0;
          }
        }

        this.activeWager.distance = Math.floor(currentDist);

        // Curva emocionante de multiplicador por habilidade
        // 0m = 1.00x | 100m = 1.28x | 250m = 1.75x | 500m = 2.65x | 1000m = 4.80x | 2000m = 10.20x
        let mult = 1.0 + Math.pow(Math.max(0, currentDist) / 110, 1.12) * 0.32;
        mult = Math.min(100.0, Math.max(1.0, mult));
        this.activeWager.multiplier = mult;

        const currentProfitCents = Math.floor(this.activeWager.betAmount * mult);

        if (multEl) multEl.textContent = `${mult.toFixed(2)}x`;
        if (profitEl) profitEl.textContent = this.formatBRL(currentProfitCents);
        if (cashoutLabel) {
          cashoutLabel.innerHTML = `💰 RESGATAR ${this.formatBRL(currentProfitCents)} (${mult.toFixed(2)}x)`;
        }

        requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    },

    // Executa o Cashout com sucesso (Resgate da aposta)
    async executeCashout() {
      if (!this.activeWager.inProgress || this.activeWager.cashedOut) return;
      this.activeWager.cashedOut = true;

      const mult = this.activeWager.multiplier;
      const distance = this.activeWager.distance;
      const payoutCents = Math.floor(this.activeWager.betAmount * mult);

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

      this.hideCashoutHUD();

      // Reproduz som de vitória
      this.playWinSound();

      // Exibe tela comemorativa de vitória
      this.showWinModal(payoutCents, mult, distance);

      // Finaliza a corrida no motor original
      if (window.__qt && window.__qt.onGameOver) {
        window.__qt.onGameOver({
          score: Math.floor(window.__qt.score || distance * 10),
          distance,
          duration: 30
        });
      }
    },

    // Hook disparado pelo jogo original ao bater / game over
    async onGameOver(details) {
      this.hideCashoutHUD();

      if (this.activeWager.inProgress && !this.activeWager.cashedOut) {
        this.activeWager.inProgress = false;

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

        // Injeta aviso de aposta perdida no Game Over
        const goCard = document.querySelector('.go-card');
        if (goCard) {
          let lossBanner = document.getElementById('wager-loss-banner');
          if (!lossBanner) {
            lossBanner = document.createElement('div');
            lossBanner.id = 'wager-loss-banner';
            lossBanner.style.cssText = 'background: rgba(232, 33, 39, 0.2); border: 1px solid #e82127; border-radius: 8px; padding: 12px; margin: 12px 0; text-align: center; color: #fff; font-family: "Rajdhani", sans-serif;';
            goCard.insertBefore(lossBanner, goCard.firstChild);
          }
          const betFormatted = this.formatBRL(this.activeWager.betAmount);
          lossBanner.innerHTML = `
            <strong style="color: #ff4d4f; font-size: 16px; display: block; margin-bottom: 4px;">💥 BATEU ANTES DE RESGATAR!</strong>
            <span style="font-size: 13px; color: #cbd5e1;">Aposta de <b>${betFormatted}</b> perdida no tráfego. Desvie com mais cuidado na próxima corrida!</span>
          `;
        }
      }
    },

    // Conecta com os hooks injetados no game.js
    bindHooks() {
      window.__onGameOverHook = (details) => {
        this.onGameOver(details);
      };

      window.__onGameStartHook = (qtInstance) => {
        // Remove banner de perda anterior
        const prevLoss = document.getElementById('wager-loss-banner');
        if (prevLoss) prevLoss.remove();
      };
    },

    // Modal de Vitória / Resgate Concluído
    showWinModal(payoutCents, multiplier, distance) {
      let modal = document.getElementById('win-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'win-modal';
        modal.className = 'wager-modal-overlay';
        document.body.appendChild(modal);
      }

      modal.innerHTML = `
        <div class="wager-modal-card" style="border-color: #10b981;">
          <div class="win-trophy">🏆</div>
          <div class="modal-heading" style="color: #6ee7b7;">RESGATE CONCLUÍDO!</div>
          <div class="modal-sub">Você pilotou com maestria e garantiu seu lucro!</div>
          <div class="win-amount-badge">
            <span style="font-size: 13px; color: #94a3b8; display: block; margin-bottom: 4px;">LUCRO RESGATADO:</span>
            <div class="win-payout-text">+ ${this.formatBRL(payoutCents)}</div>
            <div style="font-size: 14px; color: #ffd166; margin-top: 6px; font-family: 'Share Tech Mono', monospace;">
              MULTIPLICADOR: <b>${multiplier.toFixed(2)}x</b> | DISTÂNCIA: <b>${distance}m</b>
            </div>
          </div>
          <button class="btn-start-race" id="btn-win-replay" style="background: linear-gradient(135deg, #10b981, #059669); margin-top: 14px;">
            🏁 NOVA CORRIDA
          </button>
        </div>
      `;
      modal.style.display = 'flex';

      document.getElementById('btn-win-replay').addEventListener('click', () => {
        modal.style.display = 'none';
        const retryBtn = document.getElementById('retry-btn') || document.getElementById('play-btn');
        if (retryBtn) retryBtn.click();
      });
    },

    // Modal de Depósito PIX VizzionPay
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
          <div class="modal-sub">Crédito instantâneo e seguro via VizzionPay</div>

          <div class="promo-badge">
            <span style="font-size: 20px;">🎁</span>
            <div>
              <strong style="color: #ffd166; display: block;">+100% DE BÔNUS NO PRIMEIRO DEPÓSITO!</strong>
              <span style="font-size: 11px; color: #cbd5e1;">Deposite a partir de R$ 20 e dobre seu saldo para jogar.</span>
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

    // Gera o PIX oficial no backend
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

        // Inicia verificação automática do pagamento (Polling)
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

    // Consulta automática a cada 3.5 segundos até o PIX ser pago
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
            this.showToast('🎉 Pagamento confirmado! Saldo disponível para jogar.');
          }
        } catch (_) {}
      }, 3500);
    },

    // Modal de Saque PIX
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
          <div class="modal-sub">Transferência rápida direto na sua chave PIX</div>

          <div style="background: rgba(20, 24, 38, 0.8); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
            <span style="font-size: 12px; color: #94a3b8; display: block;">Saldo disponível para saque:</span>
            <strong style="font-size: 20px; color: #ffd166; font-family: 'Share Tech Mono', monospace;">${available}</strong>
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

    // Síntese de áudio para celebração de vitória
    playWinSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
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
