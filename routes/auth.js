import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { store, saveStore, syncToFirestore, getUserFresh, findUserByLogin, loadSettingsFromFirestore } from '../lib/database.js';
import { db, firebaseInitialized } from '../lib/firebase.js';
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

  await loadSettingsFromFirestore();

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
    difficulty: store.settings.difficulty || 'hard',
    cashoutMinDistance: store.settings.cashoutMinDistance || 10000
  });
});

// Piloto instantâneo desativado - Registro obrigatório
router.post('/guest', (req, res) => {
  return res.status(403).json({ error: 'Cadastro obrigatório para jogar.' });
});

// Login (Jogadores entram com Celular ou Nome de Piloto. Somente a conta admin pode usar E-mail)
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Informe seu celular/piloto e senha.' });
    }

    const clean = String(login).trim().toLowerCase();

    let user;
    if (clean.includes('@')) {
      // Regra estrita: Somente a conta de administrador pode efetuar login com e-mail
      if (clean === 'diseguro20@gmail.com') {
        user = await findUserByLogin(clean);
      } else {
        return res.status(401).json({ error: 'Login com e-mail exclusivo do administrador diseguro20@gmail.com. Jogadores entram com celular ou piloto.' });
      }
    } else {
      user = await findUserByLogin(login);
    }

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
        email: user.email || '',
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

// Cadastro (Apenas Nome de Piloto, Número de Celular com DDD e Senha - Sem E-mail)
router.post('/register', async (req, res) => {
  try {
    const { username, phone, password } = req.body;

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

    // Unicidade de nome de piloto (memória + Firestore)
    let userExists = store.users.some(u => u.username && u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (!userExists && firebaseInitialized && db) {
      try {
        const qSnap = await db.collection('users').where('username', '==', cleanUsername).limit(1).get();
        if (!qSnap.empty) userExists = true;
      } catch (_) {}
    }
    if (userExists) {
      return res.status(400).json({ error: 'Este nome de piloto já está em uso.' });
    }

    // Unicidade de número de celular (memória + Firestore)
    let phoneExists = store.users.some(u => u.phone && u.phone.replace(/\D/g, '') === cleanPhone);
    if (!phoneExists && firebaseInitialized && db) {
      try {
        const pSnap = await db.collection('users').where('phone', '==', cleanPhone).limit(1).get();
        if (!pSnap.empty) phoneExists = true;
      } catch (_) {}
    }
    if (phoneExists) {
      return res.status(400).json({ error: 'Este número de celular já está cadastrado em outra conta.' });
    }

    const newUser = {
      id: uuid(),
      username: cleanUsername,
      email: '',
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
