import express from 'express';
import { store, saveStore, addTransaction, syncToFirestore, updateUser, getUserFresh, approveDepositAndCreditUser, determineDepositGateway, isExemptFromAmplo } from '../lib/database.js';
import { db, firebaseInitialized } from '../lib/firebase.js';
import { createVizzionPayPix, checkVizzionPayStatus, getVizzionPayConfig } from '../lib/vizzionpay.js';
import { createAmploPayPix, checkAmploPayStatus, getAmploPayConfig } from '../lib/amplopay.js';
import { verifyAuth } from '../middleware/auth.js';

const router = express.Router();
const now = () => new Date().toISOString();

// Consultar saldo
router.get('/balance', verifyAuth, (req, res) => {
  const user = req.user;
  res.json({
    balance: user.balance || 0,
    cash_balance: user.cash_balance || 0,
    bonus_balance: user.bonus_balance || 0
  });
});

// Criar depósito PIX via VizzionPay
router.post('/deposit', verifyAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.id.startsWith('pilot_') || !user.password_hash) {
      return res.status(401).json({ error: 'É obrigatório estar cadastrado e logado para depositar via PIX.' });
    }
    const amount = Math.round(Number(req.body?.amount || 0));
    const minDeposit = Number(store.settings.minDeposit) || 2000; // R$ 20,00

    if (amount < minDeposit) {
      return res.status(400).json({
        error: `O depósito mínimo é de R$ ${(minDeposit / 100).toFixed(2).replace('.', ',')}.`
      });
    }

    const depositId = `dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const bonusPercent = Number(store.settings.bonusPercent || 100);
    const bonusMin = Number(store.settings.bonusMinDeposit || 5000);
    const bonusAmount = amount >= bonusMin ? Math.floor((amount * bonusPercent) / 100) : 0;

    // ─── Roteamento de gateway: Ciclo 40% Amplo Pay / 60% Vizzion Pay (Isento 9392) ───
    const selectedGateway = await determineDepositGateway(user);
    let pixData;
    let gatewayUsed = 'vizzionpay';

    if (selectedGateway === 'amplopay') {
      console.log(`[Deposit] Roteando depósito ${depositId} → AmploPay (40%)`);
      gatewayUsed = 'amplopay';
      try {
        pixData = await createAmploPayPix({
          amountCents: amount,
          customer: {
            name: user.username,
            email: user.email,
            phone: user.phone || '11999999999'
          },
          referenceId: depositId
        });
        if (pixData.mode === 'simulation_fallback') {
          console.warn('[Deposit] AmploPay retornou fallback. Alternando para VizzionPay oficial...');
          gatewayUsed = 'vizzionpay';
          pixData = await createVizzionPayPix({
            amountCents: amount,
            customer: {
              name: user.username,
              email: user.email,
              phone: user.phone || '11999999999'
            },
            referenceId: depositId
          });
        }
      } catch (e) {
        console.warn('[Deposit] Erro na AmploPay, alternando para VizzionPay:', e.message);
        gatewayUsed = 'vizzionpay';
        pixData = await createVizzionPayPix({
          amountCents: amount,
          customer: {
            name: user.username,
            email: user.email,
            phone: user.phone || '11999999999'
          },
          referenceId: depositId
        });
      }
    } else {
      console.log(`[Deposit] Roteando depósito ${depositId} → VizzionPay (60% / isento 9392)`);
      gatewayUsed = 'vizzionpay';
      pixData = await createVizzionPayPix({
        amountCents: amount,
        customer: {
          name: user.username,
          email: user.email,
          phone: user.phone || '11999999999'
        },
        referenceId: depositId
      });
    }

    const deposit = {
      id: depositId,
      uid: user.id,
      username: user.username,
      amount,
      bonusAmount,
      pixCode: pixData.pixCode,
      qrCodeUrl: pixData.qrCodeUrl,
      transactionId: pixData.transactionId,
      gateway: gatewayUsed,
      mode: pixData.mode,
      status: 'pending',
      created_at: now()
    };

    store.deposits.unshift(deposit);
    saveStore();
    await syncToFirestore('deposits', deposit.id, deposit);

    return res.json({
      success: true,
      depositId: deposit.id,
      amount,
      bonusAmount,
      pixCode: pixData.pixCode,
      qrCodeUrl: pixData.qrCodeUrl,
      expiresInSeconds: 600,
      mode: pixData.mode
    });
  } catch (err) {
    console.error('[Wallet] Erro ao criar depósito:', err);
    return res.status(500).json({ error: 'Erro ao gerar PIX: ' + err.message });
  }
});

// Verificar status do depósito (Polling ativo do front-end)
router.get('/check-deposit/:id', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;
    let dep = store.deposits.find(d => d.id === id || d.transactionId === id);

    if (!dep && firebaseInitialized && db) {
      try {
        let snap = await db.collection('deposits').doc(String(id)).get();
        if (snap.exists) {
          dep = { id: snap.id, ...snap.data() };
        } else {
          const qSnap = await db.collection('deposits').where('transactionId', '==', String(id)).limit(1).get();
          if (!qSnap.empty) {
            dep = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
          }
        }
        if (dep) {
          const idx = store.deposits.findIndex(d => d.id === dep.id);
          if (idx !== -1) store.deposits[idx] = dep;
          else store.deposits.unshift(dep);
        }
      } catch (_) {}
    }

    if (!dep) {
      return res.status(404).json({ error: 'Depósito não encontrado.' });
    }

    if (dep.status === 'approved') {
      const user = await getUserFresh(dep.uid);
      return res.json({
        status: 'approved',
        amount: dep.amount,
        bonusAmount: dep.bonusAmount,
        balance: user?.balance || 0,
        cash_balance: user?.cash_balance || 0,
        bonus_balance: user?.bonus_balance || 0
      });
    }

    // Consulta status oficial no gateway correspondente (AmploPay ou VizzionPay)
    const checkFn = dep.gateway === 'amplopay' ? checkAmploPayStatus : checkVizzionPayStatus;
    const statusResult = await checkFn(dep.transactionId || dep.id);
    if (statusResult && statusResult.status === 'approved') {
      await approveDepositAndCreditUser(dep.id);
      const user = await getUserFresh(dep.uid);
      return res.json({
        status: 'approved',
        amount: dep.amount,
        bonusAmount: dep.bonusAmount,
        balance: user?.balance || 0,
        cash_balance: user?.cash_balance || 0,
        bonus_balance: user?.bonus_balance || 0
      });
    }

    return res.json({ status: dep.status });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao checar depósito: ' + err.message });
  }
});

// Solicitar saque via PIX
router.post('/withdraw', verifyAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.id.startsWith('pilot_') || !user.password_hash) {
      return res.status(401).json({ error: 'É obrigatório estar cadastrado e logado para solicitar saques.' });
    }
    const amount = Math.round(Number(req.body?.amount || 0));
    const pixKey = String(req.body?.pixKey || '').trim();
    const pixType = String(req.body?.pixType || 'cpf').trim();
    const minWithdrawal = Number(store.settings.minWithdrawal) || 1000; // R$ 10,00

    if (amount < minWithdrawal) {
      return res.status(400).json({
        error: `O valor mínimo para saque é de R$ ${(minWithdrawal / 100).toFixed(2).replace('.', ',')}.`
      });
    }

    if (!pixKey) {
      return res.status(400).json({ error: 'Informe sua chave PIX para transferência.' });
    }

    if ((user.cash_balance || 0) < amount) {
      return res.status(400).json({ error: 'Saldo em dinheiro insuficiente para este saque.' });
    }

    // Debita do saldo
    user.cash_balance -= amount;
    user.balance = user.cash_balance + (user.bonus_balance || 0);

    const withdrawalId = `wth_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const withdrawal = {
      id: withdrawalId,
      uid: user.id,
      username: user.username,
      amount,
      pixKey,
      pixType,
      status: 'pending',
      created_at: now()
    };

    store.withdrawals.unshift(withdrawal);
    addTransaction(user.id, 'withdraw', -amount, 'pending', { withdrawalId, pixKey, pixType });

    await updateUser(user.id, {
      balance: user.balance,
      cash_balance: user.cash_balance
    });
    await syncToFirestore('withdrawals', withdrawal.id, withdrawal);

    return res.json({
      success: true,
      message: 'Solicitação de saque PIX enviada com sucesso!',
      withdrawalId,
      balance: user.balance,
      cash_balance: user.cash_balance
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao solicitar saque: ' + err.message });
  }
});

// Histórico de transações
router.get('/history', verifyAuth, (req, res) => {
  const user = req.user;
  const userTxs = store.transactions.filter(t => t.uid === user.id).slice(0, 30);
  res.json({
    balance: user.balance,
    cashBalance: user.cash_balance,
    bonusBalance: user.bonus_balance,
    transactions: userTxs
  });
});

// Status dos Gateways de Pagamento
router.get('/gateway/status', verifyAuth, (req, res) => {
  const vpConfig = getVizzionPayConfig();
  const apConfig = getAmploPayConfig();
  res.json({
    vizzionpay: {
      provider: 'VizzionPay',
      configured: vpConfig.configured,
      ratio: '60%',
      webhookUrl: vpConfig.webhookUrl
    },
    amplopay: {
      provider: 'AmploPay',
      configured: apConfig.configured,
      ratio: '40%',
      webhookUrl: apConfig.webhookUrl
    }
  });
});

export default router;
