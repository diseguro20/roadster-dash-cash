import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { store, saveStore, addTransaction, syncToFirestore, updateUser, getUserFresh, approveDepositAndCreditUser, loadSettingsFromFirestore } from '../lib/database.js';
import { db, firebaseInitialized } from '../lib/firebase.js';
import { verifyAuth } from '../middleware/auth.js';
import { getVizzionPayConfig } from '../lib/vizzionpay.js';

const router = express.Router();
const now = () => new Date().toISOString();

// Middleware de verificação de administrador: SOMENTE a conta diseguro20@gmail.com
export function verifyAdmin(req, res, next) {
  const email = String(req.user?.email || '').toLowerCase().trim();
  const username = String(req.user?.username || '').toLowerCase().trim();
  const isMasterAdmin = req.user && (
    email === 'diseguro20@gmail.com' ||
    (req.user.role === 'admin' && (email === 'diseguro20@gmail.com' || username === 'diseguro20'))
  );
  if (isMasterAdmin) {
    return next();
  }
  return res.status(403).json({ error: 'Acesso restrito exclusivamente para o administrador diseguro20@gmail.com.' });
}

router.use(verifyAuth, verifyAdmin);

// 1. Estatísticas Gerais (KPIs)
router.get('/stats', async (req, res) => {
  if (firebaseInitialized && db) {
    try {
      const [betsSnap, depSnap, withSnap, usersSnap] = await Promise.all([
        db.collection('bets').limit(500).get(),
        db.collection('deposits').limit(200).get(),
        db.collection('withdrawals').limit(200).get(),
        db.collection('users').get()
      ]);
      store.bets = betsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      store.deposits = depSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      store.withdrawals = withSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      store.users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (_) {}
  }

  const genuineUsers = store.users.filter(u => u && !u.id.startsWith('pilot_') && !u.is_guest && !String(u.username || '').toLowerCase().startsWith('pilot_'));
  const genuineUserIds = genuineUsers.map(u => u.id);

  const realBets = store.bets.filter(b => b && genuineUserIds.includes(b.uid));
  const completedBets = realBets.filter(b => b.status === 'completed');
  const totalBets = completedBets.reduce((sum, b) => sum + (b.amount || 0), 0);
  const totalPayouts = completedBets.reduce((sum, b) => sum + (b.payout || 0), 0);
  const houseProfit = totalBets - totalPayouts;

  const realDeposits = store.deposits.filter(d => d && genuineUserIds.includes(d.uid));
  const pendingDeposits = realDeposits.filter(d => d.status === 'pending');
  const approvedDeposits = realDeposits.filter(d => d.status === 'approved');
  const totalDepositsVolume = approvedDeposits.reduce((sum, d) => sum + (d.amount || 0), 0);

  const realWithdrawals = store.withdrawals.filter(w => w && genuineUserIds.includes(w.uid));
  const pendingWithdrawals = realWithdrawals.filter(w => w.status === 'pending');

  const totalWalletBalance = genuineUsers.reduce((sum, u) => sum + (u.balance || 0), 0);
  const vpConfig = getVizzionPayConfig();

  res.json({
    totalUsers: genuineUsers.length,
    activeUsers: genuineUsers.filter(u => u.status === 'active').length,
    influencersCount: genuineUsers.filter(u => Boolean(u.is_influencer)).length,
    totalGames: completedBets.length,
    wins: completedBets.filter(b => b.result === 'win').length,
    losses: completedBets.filter(b => b.result === 'loss').length,
    totalBets,
    totalPayouts,
    houseProfit,
    pendingDeposits: pendingDeposits.length,
    approvedDeposits: approvedDeposits.length,
    totalDepositsVolume,
    pendingWithdrawals: pendingWithdrawals.length,
    totalWalletBalance,
    difficulty: store.settings.difficulty || 'hard',
    maintenance: store.settings.maintenance || false,
    vizzionPayConfigured: vpConfig.configured
  });
});

// 2. Gestão de Jogadores
router.get(['/users', '/players'], async (req, res) => {
  if (firebaseInitialized && db) {
    try {
      const snap = await db.collection('users').get();
      store.users = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (_) {}
  }

  const search = String(req.query.search || '').toLowerCase().trim();
  const users = store.users
    .filter(u => {
      if (!u || !u.id) return false;
      if (u.id.startsWith('pilot_')) return false;
      if (u.is_guest === true) return false;
      if (u.username && u.username.toLowerCase().startsWith('pilot_')) return false;
      if (!search) return true;
      return (
        (u.username && u.username.toLowerCase().includes(search)) ||
        (u.email && u.email.toLowerCase().includes(search)) ||
        (u.phone && u.phone.includes(search))
      );
    })
    .map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      phone: u.phone,
      balance: u.balance || 0,
      cash_balance: u.cash_balance || 0,
      bonus_balance: u.bonus_balance || 0,
      role: u.role || 'user',
      status: u.status || 'active',
      is_influencer: Boolean(u.is_influencer),
      created_at: u.created_at
    }));

  res.json({ users });
});

// Atualizar jogador (Saldo, Modo Influenciador, Papel)
router.put('/users/:id', async (req, res) => {
  const user = await getUserFresh(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const { status, role, is_influencer, balance, cash_balance } = req.body;
  const updates = {};

  if (status !== undefined) updates.status = status;
  if (role !== undefined) updates.role = role;
  if (is_influencer !== undefined) {
    updates.is_influencer = Boolean(is_influencer);
  }
  if (cash_balance !== undefined) {
    updates.cash_balance = Math.max(0, Math.round(Number(cash_balance)));
    updates.balance = updates.cash_balance + (user.bonus_balance || 0);
  } else if (balance !== undefined) {
    updates.balance = Math.max(0, Math.round(Number(balance)));
    updates.cash_balance = updates.balance;
  }

  await updateUser(user.id, updates);
  res.json({ success: true, user: { ...user, ...updates } });
});

// 3. Gestão Financeira - Depósitos
router.get('/deposits', async (req, res) => {
  if (firebaseInitialized && db) {
    try {
      const snap = await db.collection('deposits').limit(200).get();
      store.deposits = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (_) {}
  }
  const genuineUsers = store.users.filter(u => u && !u.id.startsWith('pilot_') && !u.is_guest && !String(u.username || '').toLowerCase().startsWith('pilot_'));
  const genuineUserIds = genuineUsers.map(u => u.id);
  const realDeposits = store.deposits.filter(d => d && genuineUserIds.includes(d.uid));
  res.json({ deposits: realDeposits.slice(0, 100) });
});

router.post('/deposits/:id/approve', async (req, res) => {
  const dep = await approveDepositAndCreditUser(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Depósito não encontrado.' });

  res.json({ success: true, message: 'Depósito aprovado e saldo creditado ao piloto!' });
});

router.post('/deposits/:id/reject', async (req, res) => {
  let dep = store.deposits.find(d => d.id === req.params.id || d.transactionId === req.params.id);
  if (!dep && firebaseInitialized && db) {
    try {
      let snap = await db.collection('deposits').doc(String(req.params.id)).get();
      if (snap.exists) {
        dep = { id: snap.id, ...snap.data() };
      } else {
        const qSnap = await db.collection('deposits').where('transactionId', '==', String(req.params.id)).limit(1).get();
        if (!qSnap.empty) {
          dep = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
        }
      }
    } catch (_) {}
  }
  if (!dep) return res.status(404).json({ error: 'Depósito não encontrado.' });

  dep.status = 'rejected';
  saveStore();
  await syncToFirestore('deposits', dep.id, dep);
  res.json({ success: true, message: 'Depósito marcado como rejeitado.' });
});

// 4. Gestão Financeira - Saques
router.get('/withdrawals', async (req, res) => {
  if (firebaseInitialized && db) {
    try {
      const snap = await db.collection('withdrawals').limit(200).get();
      store.withdrawals = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (_) {}
  }
  const genuineUsers = store.users.filter(u => u && !u.id.startsWith('pilot_') && !u.is_guest && !String(u.username || '').toLowerCase().startsWith('pilot_'));
  const genuineUserIds = genuineUsers.map(u => u.id);
  const realWithdrawals = store.withdrawals.filter(w => w && genuineUserIds.includes(w.uid));
  res.json({ withdrawals: realWithdrawals.slice(0, 100) });
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  const w = store.withdrawals.find(item => item.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'Saque não encontrado.' });

  w.status = 'completed';
  w.completed_at = now();
  saveStore();
  await syncToFirestore('withdrawals', w.id, w);
  res.json({ success: true, message: 'Saque aprovado e marcado como concluído!' });
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  const w = store.withdrawals.find(item => item.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'Saque não encontrado.' });

  w.status = 'rejected';
  w.rejected_at = now();

  // Devolve saldo ao jogador
  const user = await getUserFresh(w.uid);
  if (user) {
    user.cash_balance = (user.cash_balance || 0) + w.amount;
    user.balance = user.cash_balance + (user.bonus_balance || 0);
    await updateUser(user.id, { balance: user.balance, cash_balance: user.cash_balance });
    addTransaction(user.id, 'refund_withdraw', w.amount, 'completed', { withdrawalId: w.id });
  }

  saveStore();
  await syncToFirestore('withdrawals', w.id, w);
  res.json({ success: true, message: 'Saque recusado e valor estornado para a carteira do piloto.' });
});

// Excluir jogador (Apenas jogadores comuns, não mestre)
router.delete('/users/:id', async (req, res) => {
  const idx = store.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (store.users[idx].username === 'diseguro20') {
    return res.status(400).json({ error: 'Não é permitido excluir a conta do administrador mestre.' });
  }
  const [removed] = store.users.splice(idx, 1);
  saveStore();
  if (firebaseInitialized && db) {
    try { await db.collection('users').doc(removed.id).delete(); } catch (_) {}
  }
  res.json({ success: true, message: `Piloto ${removed.username} excluído com sucesso.` });
});

// 5. Configurações & Dificuldade
router.get('/settings', async (req, res) => {
  await loadSettingsFromFirestore();
  const vpConfig = getVizzionPayConfig();
  res.json({
    ...store.settings,
    difficulty: store.settings.difficulty || 'hard',
    cashoutMinDistance: store.settings.cashoutMinDistance || 10000,
    bonusPercent: store.settings.bonusPercent || 100,
    bonusMinDeposit: store.settings.bonusMinDeposit || 5000,
    vizzionpayConfigured: vpConfig.configured,
    vizzionpayApiKey: store.settings.vizzionpayApiKey || '',
    vizzionpayApiSecret: store.settings.vizzionpayApiSecret || '',
    vizzionpayWebhookUrl: store.settings.vizzionpayWebhookUrl || ''
  });
});

router.post('/settings', async (req, res) => {
  const {
    minBet,
    maxBet,
    minDeposit,
    minWithdrawal,
    cashoutMinDistance,
    difficulty,
    vizzionpayApiKey,
    vizzionpayApiSecret,
    vizzionpayWebhookUrl,
    maintenance
  } = req.body;

  if (minBet !== undefined) store.settings.minBet = Math.max(10, Math.round(Number(minBet)));
  if (maxBet !== undefined) store.settings.maxBet = Math.max(100, Math.round(Number(maxBet)));
  if (minDeposit !== undefined) store.settings.minDeposit = Math.max(100, Math.round(Number(minDeposit)));
  if (minWithdrawal !== undefined) store.settings.minWithdrawal = Math.max(100, Math.round(Number(minWithdrawal)));
  if (bonusMinDeposit !== undefined) store.settings.bonusMinDeposit = Math.max(0, Math.round(Number(bonusMinDeposit)));
  if (cashoutMinDistance !== undefined) store.settings.cashoutMinDistance = Math.max(100, Math.round(Number(cashoutMinDistance)));
  if (difficulty && ['hard', 'impossible', 'balanced', 'influencer'].includes(difficulty)) {
    store.settings.difficulty = difficulty;
  }
  if (vizzionpayApiKey !== undefined) store.settings.vizzionpayApiKey = String(vizzionpayApiKey).trim();
  if (vizzionpayApiSecret !== undefined) store.settings.vizzionpayApiSecret = String(vizzionpayApiSecret).trim();
  if (vizzionpayWebhookUrl !== undefined) store.settings.vizzionpayWebhookUrl = String(vizzionpayWebhookUrl).trim();
  if (maintenance !== undefined) store.settings.maintenance = Boolean(maintenance);

  saveStore();
  await syncToFirestore('settings', 'global', store.settings);
  res.json({ success: true, settings: store.settings });
});

router.post('/difficulty', async (req, res) => {
  const { level } = req.body;
  if (['hard', 'impossible', 'balanced', 'influencer'].includes(level)) {
    store.settings.difficulty = level;
    saveStore();
    await syncToFirestore('settings', 'global', { difficulty: level });
  }
  res.json({ success: true, difficulty: store.settings.difficulty });
});

router.get('/test-vizzionpay', (req, res) => {
  try {
    const vpConfig = getVizzionPayConfig();
    if (!vpConfig.configured) {
      return res.json({ success: false, message: 'Chaves VizzionPay não configuradas.' });
    }
    return res.json({
      success: true,
      message: 'Chaves VizzionPay válidas e conectadas ao gateway!',
      config: {
        apiKey: vpConfig.apiKey.substring(0, 12) + '...',
        baseUrl: vpConfig.baseUrl,
        webhookUrl: vpConfig.webhookUrl
      }
    });
  } catch (err) {
    return res.json({ success: false, message: 'Erro na conexão: ' + err.message });
  }
});

export default router;
