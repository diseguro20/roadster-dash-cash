import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { store, saveStore, syncToFirestore, getUserFresh } from '../lib/database.js';
import { generateToken, verifyAuth } from '../middleware/auth.js';

const router = express.Router();
const now = () => new Date().toISOString();

// Obter dados do usuário atual
router.get('/me', verifyAuth, async (req, res) => {
  const user = req.user;
  const isGuest = Boolean(user.id.startsWith('pilot_') || !user.password_hash);
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone || '',
    balance: user.balance || 0,
    cash_balance: user.cash_balance || 0,
    bonus_balance: user.bonus_balance || 0,
    role: user.role || 'user',
    is_influencer: Boolean(user.is_influencer),
    is_guest: isGuest,
    difficulty: store.settings.difficulty || 'hard'
  });
});

// Criar / autenticar piloto instantâneo (Guest / Piloto Rápido)
router.post('/guest', async (req, res) => {
  try {
    const rawName = (req.body?.name || '').trim();
    const guestId = req.body?.guestId || `pilot_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    
    let user = await getUserFresh(guestId);
    if (!user) {
      const username = rawName || `Piloto_${Math.floor(1000 + Math.random() * 9000)}`;
      user = {
        id: guestId,
        username,
        email: `${guestId}@roadsterdash.local`,
        phone: '11999999999',
        balance: 2000, // R$ 20,00 de crédito cortesia para experimentar o jogo de habilidade!
        cash_balance: 2000,
        bonus_balance: 0,
        role: 'user',
        status: 'active',
        created_at: now()
      };
      store.users.push(user);
      saveStore();
      await syncToFirestore('users', user.id, user);
    }

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        balance: user.balance,
        cash_balance: user.cash_balance,
        bonus_balance: user.bonus_balance
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar piloto: ' + err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Informe login e senha.' });
    }

    const clean = String(login).trim().toLowerCase();
    const user = store.users.find(u =>
      (u.username && u.username.toLowerCase() === clean) ||
      (u.email && u.email.toLowerCase() === clean)
    );

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone || '',
        balance: user.balance || 0,
        cash_balance: user.cash_balance || 0,
        bonus_balance: user.bonus_balance || 0,
        is_influencer: Boolean(user.is_influencer),
        is_guest: false
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro no login: ' + err.message });
  }
});

// Cadastro
router.post('/register', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Preencha usuário e senha.' });
    }

    const cleanUsername = String(username).trim();
    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: 'O nome de usuário deve ter no mínimo 3 caracteres.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
    }

    if (store.users.some(u => u.username && u.username.toLowerCase() === cleanUsername.toLowerCase())) {
      return res.status(400).json({ error: 'Este nome de piloto já está em uso.' });
    }

    const cleanEmail = email ? String(email).trim().toLowerCase() : '';
    if (cleanEmail && store.users.some(u => u.email && u.email.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado em outra conta.' });
    }

    const newUser = {
      id: uuid(),
      username: cleanUsername,
      email: cleanEmail || `${cleanUsername.toLowerCase()}@player.local`,
      phone: phone ? String(phone).replace(/\D/g, '') : '',
      password_hash: await bcrypt.hash(password, 10),
      balance: 0,
      cash_balance: 0,
      bonus_balance: 0,
      role: 'user',
      is_influencer: false,
      status: 'active',
      created_at: now()
    };

    store.users.push(newUser);
    saveStore();
    await syncToFirestore('users', newUser.id, newUser);

    const token = generateToken(newUser);
    res.json({
      success: true,
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        phone: newUser.phone,
        balance: newUser.balance,
        cash_balance: newUser.cash_balance,
        bonus_balance: newUser.bonus_balance,
        is_influencer: false,
        is_guest: false
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro no cadastro: ' + err.message });
  }
});

export default router;
