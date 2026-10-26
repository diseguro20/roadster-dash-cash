import express from 'express';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { store, saveStore, addTransaction, syncToFirestore, updateUser } from '../lib/database.js';
import { db, firebaseInitialized } from '../lib/firebase.js';
import { verifyAuth } from '../middleware/auth.js';

const router = express.Router();
const now = () => new Date().toISOString();

// Iniciar corrida valendo aposta
router.post('/start', verifyAuth, async (req, res) => {
  try {
    const { maintenance, minBet, maxBet } = store.settings;
    if (maintenance) {
      return res.status(503).json({ error: 'O sistema de apostas está em manutenção no momento.' });
    }

    const amount = Math.round(Number(req.body.amount || 0));
    if (!Number.isFinite(amount) || amount < minBet || amount > maxBet) {
      return res.status(400).json({
        error: `A aposta deve ser entre R$ ${(minBet / 100).toFixed(2).replace('.', ',')} e R$ ${(maxBet / 100).toFixed(2).replace('.', ',')}.`
      });
    }

    const user = req.user;
    if (!user || user.id.startsWith('pilot_') || !user.password_hash) {
      return res.status(401).json({
        error: 'É obrigatório criar uma conta ou fazer login para apostar.'
      });
    }
    if ((user.balance || 0) < amount) {
      return res.status(400).json({
        error: 'Saldo insuficiente para realizar esta corrida. Faça um depósito via PIX.'
      });
    }

    // Limpa / reembolsa sessões pendentes que nunca rodaram
    const pendingBets = store.bets.filter(b => b.uid === user.id && b.status === 'pending');
    for (const b of pendingBets) {
      b.status = 'cancelled';
      b.result = 'refunded';
      b.completed_at = now();
      user.cash_balance += b.amount;
      user.balance = user.cash_balance + (user.bonus_balance || 0);
      addTransaction(user.id, 'refund', b.amount, 'completed', { bet_id: b.id });
      await syncToFirestore('bets', b.id, b);
    }

    // Desconta valor da aposta
    let cashStake = Math.min(user.cash_balance || 0, amount);
    let bonusStake = amount - cashStake;
    user.cash_balance = (user.cash_balance || 0) - cashStake;
    user.bonus_balance = (user.bonus_balance || 0) - bonusStake;
    user.balance = user.cash_balance + user.bonus_balance;

    const sessionId = uuid();
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const seedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

    const bet = {
      id: uuid(),
      uid: user.id,
      username: user.username,
      amount,
      sessionId,
      serverSeed,
      seedHash,
      status: 'pending',
      result: 'pending',
      multiplier: 1.0,
      payout: 0,
      distance: 0,
      created_at: now()
    };

    store.bets.unshift(bet);
    if (store.bets.length > 500) store.bets.pop();

    addTransaction(user.id, 'bet', -amount, 'completed', { sessionId, bet_id: bet.id });

    saveStore();
    await updateUser(user.id, {
      balance: user.balance,
      cash_balance: user.cash_balance,
      bonus_balance: user.bonus_balance
    });
    await syncToFirestore('bets', bet.id, bet);

    return res.json({
      success: true,
      sessionId,
      seedHash,
      balance_after: user.balance,
      cash_balance: user.cash_balance,
      bonus_balance: user.bonus_balance,
      amount
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao iniciar corrida: ' + err.message });
  }
});

// Finalizar corrida (Resgate / Cashout por habilidade ou Batida / Crash)
router.post('/end', verifyAuth, async (req, res) => {
  try {
    const { sessionId, action, multiplier: reqMultiplier, distance } = req.body;
    const user = req.user;

    let bet = store.bets.find(b => b.uid === user.id && b.sessionId === sessionId && b.status === 'pending');
    if (!bet && firebaseInitialized && db) {
      try {
        const snap = await db.collection('bets').where('sessionId', '==', sessionId).limit(1).get();
        if (!snap.empty && snap.docs[0].data().uid === user.id && snap.docs[0].data().status === 'pending') {
          bet = { id: snap.docs[0].id, ...snap.docs[0].data() };
          store.bets.unshift(bet);
        }
      } catch (_) {}
    }

    if (!bet) {
      return res.status(409).json({ error: 'Corrida não encontrada ou já encerrada.' });
    }

    const dist = Math.max(0, Math.floor(Number(distance || 0)));
    bet.distance = dist;

    if (action === 'cashout') {
      const isInfluencer = Boolean(user.is_influencer);
      const minDistance = Number(store.settings?.cashoutMinDistance || 2000);

      // Regra de RTP 99.9% da plataforma:
      // Impossível resgatar/ganhar sem Modo Influencer ativo no painel admin
      if (!isInfluencer) {
        return res.status(400).json({
          error: `Resgate bloqueado! Para pilotos comuns, a meta de ${(minDistance / 1000).toFixed(1)} km (${minDistance} metros) sem colisões deve ser percorrida na pista antes de resgatar. Telemetria de alta velocidade não confirmada.`
        });
      }

      // Piloto fez o resgate antes de colidir no tráfego!
      const mult = Math.max(1.0, Math.min(Number(reqMultiplier || 1.0), 100.0));
      const payout = Math.floor(bet.amount * mult);

      bet.status = 'completed';
      bet.result = 'win';
      bet.multiplier = Number(mult.toFixed(2));
      bet.payout = payout;
      bet.completed_at = now();

      // Credita o prêmio diretamente no saldo do piloto
      user.cash_balance = (user.cash_balance || 0) + payout;
      user.balance = user.cash_balance + (user.bonus_balance || 0);

      addTransaction(user.id, 'win', payout, 'completed', {
        sessionId,
        bet_id: bet.id,
        multiplier: bet.multiplier,
        distance: dist
      });

      saveStore();
      await updateUser(user.id, {
        balance: user.balance,
        cash_balance: user.cash_balance
      });
      await syncToFirestore('bets', bet.id, bet);

      return res.json({
        success: true,
        result: 'win',
        payout,
        multiplier: bet.multiplier,
        distance: dist,
        balance_after: user.balance,
        cash_balance: user.cash_balance
      });
    } else {
      // Piloto colidiu no tráfego antes de resgatar
      bet.status = 'completed';
      bet.result = 'loss';
      bet.multiplier = 0;
      bet.payout = 0;
      bet.completed_at = now();

      saveStore();
      await syncToFirestore('bets', bet.id, bet);

      return res.json({
        success: true,
        result: 'loss',
        payout: 0,
        distance: dist,
        balance_after: user.balance,
        cash_balance: user.cash_balance
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao finalizar corrida: ' + err.message });
  }
});

// Histórico das últimas corridas para ranking social
router.get('/history', (req, res) => {
  const recent = store.bets
    .filter(b => b.status === 'completed' && b.result === 'win')
    .slice(0, 15)
    .map(b => ({
      username: b.username,
      multiplier: b.multiplier,
      payout: b.payout,
      distance: b.distance,
      time: b.completed_at
    }));

  res.json({ recent });
});

export default router;
