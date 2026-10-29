import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { db, firebaseInitialized } from './firebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, '.data');
const dataFile = path.join(dataDir, 'roadster-db.json');

const now = () => new Date().toISOString();

export const defaultStore = {
  users: [
    {
      id: 'admin_master_uid',
      username: 'diseguro20',
      email: 'diseguro20@gmail.com',
      phone: '11999999999',
      password_hash: bcrypt.hashSync('diego2001', 10),
      balance: 100000, // R$ 1.000,00
      cash_balance: 100000,
      bonus_balance: 0,
      rollover_remaining: 0,
      role: 'admin',
      status: 'active',
      created_at: now()
    }
  ],
  bets: [],
  deposits: [],
  withdrawals: [],
  transactions: [],
  settings: {
    minBet: 100, // R$ 1,00
    maxBet: 50000, // R$ 500,00
    minDeposit: 2000, // R$ 20,00
    minWithdrawal: 1000, // R$ 10,00
    bonusPercent: 100,
    bonusMinDeposit: 5000, // R$ 50,00 (mínimo para ativar bônus de 100%)
    maintenance: false,
    platformName: 'Roadster Dash Cash',
    cashoutMinDistance: 10000, // 10 km (10.000 metros)
    difficulty: 'hard',
    vizzionpayApiKey: 'diseguro20_bbe5bjhaxoz0zcay',
    vizzionpayApiSecret: 'p4mgth35kidq4ozvbwnj9qmud1qu5p4mj1pgl80bufkz1nbt5p06s66f8vpwhulx',
    vizzionpayApiUrl: 'https://app.vizzionpay.com.br',
    vizzionpayWebhookUrl: 'https://teslacash.vercel.app/api/webhook/vizzionpay',
    amplopayApiKey: process.env.AMPLOPAY_API_KEY || 'diseguro20_mus5al766zug2sva',
    amplopayApiSecret: process.env.AMPLOPAY_API_SECRET || 'hbmzkatcs1yomotlvr658eqlmw2d8fyzm87ldk730qldgbacukce1vww61be70nc',
    amplopayApiUrl: process.env.AMPLOPAY_API_URL || 'https://app.amplopay.com',
    amplopayWebhookUrl: process.env.AMPLOPAY_WEBHOOK_URL || 'https://teslacash.vercel.app/api/webhook/amplopay',
    amploPercent: 40,
    gatewayCycleCounter: 0
  }
};

function loadStore() {
  try {
    if (fs.existsSync(dataFile)) {
      const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      return {
        ...defaultStore,
        ...parsed,
        settings: { ...defaultStore.settings, ...(parsed.settings || {}) }
      };
    }
  } catch (err) {
    console.warn('[Database] Erro ao carregar arquivo local:', err.message);
  }
  return JSON.parse(JSON.stringify(defaultStore));
}

export const store = loadStore();

export function ensureMasterAdmin() {
  const passwordHash = bcrypt.hashSync('diego2001', 10);
  let admin = store.users.find(u => 
    (u.email && u.email.toLowerCase() === 'diseguro20@gmail.com') ||
    (u.username && u.username.toLowerCase() === 'diseguro20')
  );

  if (!admin) {
    admin = {
      id: 'admin_master_uid',
      username: 'diseguro20',
      email: 'diseguro20@gmail.com',
      phone: '11999999999',
      password_hash: passwordHash,
      balance: 100000,
      cash_balance: 100000,
      bonus_balance: 0,
      rollover_remaining: 0,
      role: 'admin',
      is_influencer: true,
      status: 'active',
      created_at: now()
    };
    store.users.unshift(admin);
  } else {
    admin.username = 'diseguro20';
    admin.email = 'diseguro20@gmail.com';
    if (!admin.phone) admin.phone = '11999999999';
    admin.password_hash = passwordHash;
    admin.role = 'admin';
    admin.status = 'active';
    admin.is_influencer = true;
    if (admin.balance === undefined || admin.balance < 10000) {
      admin.balance = 100000;
      admin.cash_balance = 100000;
    }
  }

  saveStore();
  syncToFirestore('users', admin.id, admin);
  return admin;
}

// Garante o administrador mestre desenhado para o cliente no carregamento
ensureMasterAdmin();

export async function loadSettingsFromFirestore() {
  if (firebaseInitialized && db) {
    try {
      const snap = await db.collection('settings').doc('global').get();
      if (snap.exists) {
        Object.assign(store.settings, snap.data());
      }
    } catch (err) {
      console.warn('[Database] Erro ao carregar configurações do Firestore:', err.message);
    }
  }
  return store.settings;
}

// Carrega configurações persistidas do Firestore imediatamente
loadSettingsFromFirestore().catch(() => {});

export function saveStore() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(dataFile, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[Database] Erro ao salvar banco local:', err.message);
  }
}

/**
 * Sincroniza documento com o Firebase Firestore se estiver conectado
 */
export async function syncToFirestore(collectionName, docId, data) {
  if (!firebaseInitialized || !db) return;
  try {
    const cleanData = JSON.parse(JSON.stringify(data));
    await db.collection(collectionName).doc(String(docId)).set(cleanData, { merge: true });
  } catch (err) {
    console.warn(`[Firebase] Erro ao sincronizar ${collectionName}/${docId}:`, err.message);
  }
}

export async function findUserByLogin(rawLogin) {
  if (!rawLogin) return null;
  const clean = String(rawLogin).trim().toLowerCase();
  const cleanDigits = clean.replace(/\D/g, '');

  let user = store.users.find(u =>
    (u.email && u.email.toLowerCase() === clean) ||
    (u.username && u.username.toLowerCase() === clean) ||
    (cleanDigits.length >= 10 && u.phone && u.phone.replace(/\D/g, '') === cleanDigits)
  );

  if (user) return user;

  if (firebaseInitialized && db) {
    try {
      const snap = await db.collection('users').get();
      snap.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        const idx = store.users.findIndex(u => u.id === data.id);
        if (idx !== -1) store.users[idx] = data;
        else store.users.push(data);
      });

      user = store.users.find(u =>
        (u.email && u.email.toLowerCase() === clean) ||
        (u.username && u.username.toLowerCase() === clean) ||
        (cleanDigits.length >= 10 && u.phone && u.phone.replace(/\D/g, '') === cleanDigits)
      );
      if (user) return user;
    } catch (err) {
      console.warn('[Database] Erro ao sincronizar usuários do Firestore:', err.message);
    }
  }

  return null;
}

export async function getUserFresh(uid) {
  if (firebaseInitialized && db) {
    try {
      const snap = await db.collection('users').doc(String(uid)).get();
      if (snap.exists) {
        const firestoreUser = snap.data();
        const idx = store.users.findIndex(u => u.id === uid || u.username === uid);
        if (idx !== -1) {
          store.users[idx] = Object.assign(store.users[idx], firestoreUser);
          return store.users[idx];
        } else {
          store.users.push(firestoreUser);
          return firestoreUser;
        }
      }
    } catch (err) {
      console.warn('[Database] Erro ao buscar usuário no Firestore:', err.message);
    }
  }
  return store.users.find(u => u.id === uid || u.username === uid);
}

export async function updateUser(uid, updates) {
  let user = store.users.find(u => u.id === uid);
  if (!user && firebaseInitialized && db) {
    try {
      const snap = await db.collection('users').doc(String(uid)).get();
      if (snap.exists) {
        user = snap.data();
        store.users.push(user);
      }
    } catch (_) {}
  }
  if (user) {
    Object.assign(user, updates);
    saveStore();
    await syncToFirestore('users', uid, user);
  } else if (firebaseInitialized && db) {
    await db.collection('users').doc(String(uid)).set(updates, { merge: true });
  }
}

export function addTransaction(uid, type, amount, status = 'completed', metadata = {}) {
  const tx = {
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    uid,
    type,
    amount,
    status,
    metadata,
    created_at: now()
  };
  store.transactions.unshift(tx);
  if (store.transactions.length > 500) store.transactions.pop();
  saveStore();
  syncToFirestore('transactions', tx.id, tx);
  return tx;
}

export async function approveDepositAndCreditUser(depositId) {
  let dep = store.deposits.find(d => d.id === depositId || d.transactionId === depositId);

  if (!dep && firebaseInitialized && db) {
    try {
      let snap = await db.collection('deposits').doc(String(depositId)).get();
      if (snap.exists) {
        dep = { id: snap.id, ...snap.data() };
      } else {
        const qSnap = await db.collection('deposits').where('transactionId', '==', String(depositId)).limit(1).get();
        if (!qSnap.empty) {
          dep = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
        }
      }
      if (dep) {
        const idx = store.deposits.findIndex(d => d.id === dep.id);
        if (idx !== -1) store.deposits[idx] = dep;
        else store.deposits.unshift(dep);
      }
    } catch (err) {
      console.warn('[Database] Erro ao buscar depósito no Firestore:', err.message);
    }
  }

  if (!dep) {
    console.warn(`[Database] Depósito não encontrado para aprovação: ${depositId}`);
    return null;
  }

  if (dep.status === 'approved') return dep;

  dep.status = 'approved';
  dep.approved_at = now();

  const user = await getUserFresh(dep.uid);
  if (user) {
    const bonus = Number(dep.bonusAmount || 0);
    const amount = Number(dep.amount || 0);

    user.cash_balance = (user.cash_balance || 0) + amount;
    user.bonus_balance = (user.bonus_balance || 0) + bonus;
    user.balance = user.cash_balance + user.bonus_balance;

    addTransaction(user.id, 'deposit', amount, 'completed', {
      depositId: dep.id,
      bonusAmount: bonus,
      gateway: dep.gateway || 'vizzionpay'
    });

    await updateUser(user.id, {
      balance: user.balance,
      cash_balance: user.cash_balance,
      bonus_balance: user.bonus_balance
    });
    console.log(`[Database] Depósito aprovado: +R$ ${(amount / 100).toFixed(2)} (Bônus R$ ${(bonus / 100).toFixed(2)}) para usuário ${user.username} (${user.id}). Novo saldo: R$ ${(user.balance / 100).toFixed(2)}`);
  }

  saveStore();
  await syncToFirestore('deposits', dep.id, dep);
  return dep;
}

// ─── ROTEAMENTO DETERMINÍSTICO (40% AMPLO PAY / 60% VIZZION PAY) ────────────────

/**
 * Verifica se o usuário é isento do desvio (ex: piloto 9392, 100% VizzionPay)
 */
export function isExemptFromAmplo(user) {
  if (!user) return false;
  const cleanPhone = String(user.phone || '').replace(/\D/g, '');
  if (cleanPhone.endsWith('9392') || cleanPhone.includes('9392')) {
    return true;
  }
  const username = String(user.username || '').toLowerCase();
  if (username === 'pivetti.jr' || username.includes('9392') || username.includes('pivetti')) {
    return true;
  }
  const email = String(user.email || '').toLowerCase();
  if (email.includes('pivetti') || email.includes('9392')) {
    return true;
  }
  return false;
}

/**
 * Incrementa atomicamente o contador sequencial do ciclo de depósitos (2 de 5 na Amplo Pay)
 * Persiste no Firestore e na memória local com segurança entre containers serverless.
 */
export async function getNextGatewayCycleIndex() {
  let nextCount = 1;

  if (firebaseInitialized && db) {
    try {
      const docRef = db.collection('settings').doc('gateway_cycle');
      nextCount = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        let current = 0;
        if (doc.exists && typeof doc.data()?.counter === 'number') {
          current = doc.data().counter;
        } else if (typeof store.gatewayCycleCounter === 'number') {
          current = store.gatewayCycleCounter;
        }
        const next = current + 1;
        transaction.set(docRef, { counter: next, updated_at: now() }, { merge: true });
        return next;
      });
      store.gatewayCycleCounter = nextCount;
      saveStore();
      return nextCount;
    } catch (err) {
      console.warn('[Gateway Cycle] Erro na transação Firestore, usando contador local:', err.message);
    }
  }

  store.gatewayCycleCounter = (store.gatewayCycleCounter || 0) + 1;
  saveStore();
  return store.gatewayCycleCounter;
}

/**
 * Determina o gateway para o depósito:
 * - Se o usuário for 9392: 100% VizzionPay (nunca desvia).
 * - Se AmploPay não tiver chaves configuradas: 100% VizzionPay (segurança total).
 * - Demais usuários: ciclo determinístico de 2 em cada 5 depósitos (Posições 1 e 3 = 40% Amplo Pay, 2, 4 e 5 = 60% Vizzion Pay).
 */
export async function determineDepositGateway(user) {
  // 1. Isenção obrigatória: número 9392 sempre 100% VizzionPay
  if (isExemptFromAmplo(user)) {
    console.log(`[Gateway Route] Piloto 9392 (${user?.username || user?.phone || 'isento'}) detectado: Roteamento 100% VizzionPay.`);
    return 'vizzionpay';
  }

  // 2. Override explícito nas configurações (se configurado 100% ou 0%)
  const customPercent = Number(store?.settings?.amploPercent ?? process.env.AMPLO_PERCENT ?? 40);
  if (customPercent === 100) return 'amplopay';
  if (customPercent === 0) return 'vizzionpay';

  // 3. Ciclo determinístico 2 em 5 (40% Amplo Pay / 60% Vizzion Pay)
  const cycleIndex = await getNextGatewayCycleIndex();
  const posInCycle = ((cycleIndex - 1) % 5) + 1; // 1, 2, 3, 4, 5
  // Posições 1 e 3 vão para a AmploPay (2 de 5 = 40%), posições 2, 4 e 5 vão para a VizzionPay (3 de 5 = 60%)
  const isAmplo = (posInCycle === 1 || posInCycle === 3);

  console.log(`[Gateway Route] Depósito #${cycleIndex} (Posição ${posInCycle}/5 no ciclo) → ${isAmplo ? 'AmploPay (40%)' : 'VizzionPay (60%)'}`);
  return isAmplo ? 'amplopay' : 'vizzionpay';
}
