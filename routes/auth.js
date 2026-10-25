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
  const isGuest = Boolean(!user || user.id.startsWith('pilot_') || !user.password_hash);
  if (isGuest) {
    return res.status(401).json({ error: 'É necessário criar uma conta ou fazer login para acessar.' });
  }

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
    is_guest: false,
    difficulty: store.settings.difficulty || 'hard'
  });
});

// Criar / autenticar piloto instantâneo (Sem saldo gratuito: saldo exige depósito em conta real)
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
        balance: 0,
        cash_balance: 0,
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

// Login (Compatível com Usuário, E-mail ou Número de Celular)
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Informe usuário/celular e senha.' });
    }

    const clean = String(login).trim().toLowerCase();
    const cleanDigits = clean.replace(/\D/g, '');

    const user = store.users.find(u =>
      (u.username && u.username.toLowerCase() === clean) ||
      (u.email && u.email.toLowerCase() === clean) ||
      (cleanDigits.length >= 10 && u.phone && u.phone.replace(/\D/g, '') === cleanDigits)
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
        role: user.role || 'user',
        is_influencer: Boolean(user.is_influencer),
        is_guest: false
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro no login: ' + err.message });
  }
});

// Cadastro simplificado (Nome, Celular com DDD e Senha obrigatórios; E-mail opcional)
router.post('/register', async (req, res) => {
  try {
    const { username, phone, password, email } = req.body;

    // Validação de nome de piloto
    if (!username) {
      return res.status(400).json({ error: 'Informe o seu nome de piloto.' });
    }
    const cleanUsername = String(username).trim();
    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: 'O nome de piloto deve ter no mínimo 3 caracteres.' });
    }

    // Validação de telefone / celular com DDD
    if (!phone) {
      return res.status(400).json({ error: 'Informe o seu número de celular com DDD.' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Informe um número de celular válido com DDD (mínimo 10 dígitos).' });
    }

    // Validação de senha
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
    }

    // Unicidade de nome de piloto
    if (store.users.some(u => u.username && u.username.toLowerCase() === cleanUsername.toLowerCase())) {
      return res.status(400).json({ error: 'Este nome de piloto já está em uso.' });
    }

    // Unicidade de número de celular
    if (store.users.some(u => u.phone && u.phone.replace(/\D/g, '') === cleanPhone)) {
      return res.status(400).json({ error: 'Este número de celular já está cadastrado em outra conta.' });
    }

    // Validação de e-mail (OPCIONAL)
    const cleanEmail = email ? String(email).trim().toLowerCase() : '';
    if (cleanEmail) {
      if (store.users.some(u => u.email && u.email.toLowerCase() === cleanEmail)) {
        return res.status(400).json({ error: 'Este e-mail já está cadastrado em outra conta.' });
      }
    }

    const newUser = {
      id: uuid(),
      username: cleanUsername,
      email: cleanEmail || '',
      phone: cleanPhone,
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
        role: newUser.role,
        is_influencer: false,
        is_guest: false
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro no cadastro: ' + err.message });
  }
});

export default router;
