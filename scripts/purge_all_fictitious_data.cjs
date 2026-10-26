const { db, firebaseInitialized } = require('../lib/firebase.js');
const fs = require('fs');
const path = require('path');

async function purgeAll() {
  console.log('[Purge All] Starting complete purge of fictitious/test data...');

  // 1. Purge Firestore
  if (firebaseInitialized && db) {
    // Purge fake/test deposits
    const depSnap = await db.collection('deposits').get();
    for (const doc of depSnap.docs) {
      console.log(' - Deleting deposit:', doc.id, doc.data().username);
      await db.collection('deposits').doc(doc.id).delete();
    }
    console.log(`[Firestore] Deleted ${depSnap.size} test deposits.`);

    // Purge test bets
    const betSnap = await db.collection('bets').get();
    for (const doc of betSnap.docs) {
      await db.collection('bets').doc(doc.id).delete();
    }
    console.log(`[Firestore] Deleted ${betSnap.size} test bets.`);

    // Purge test transactions
    const txSnap = await db.collection('transactions').get();
    for (const doc of txSnap.docs) {
      await db.collection('transactions').doc(doc.id).delete();
    }
    console.log(`[Firestore] Deleted ${txSnap.size} test transactions.`);

    // Purge withdrawals (if any)
    const withSnap = await db.collection('withdrawals').get();
    for (const doc of withSnap.docs) {
      await db.collection('withdrawals').doc(doc.id).delete();
    }
    console.log(`[Firestore] Deleted ${withSnap.size} test withdrawals.`);

    // Reset admin balance to clean R$ 1.000,00 and Piveti to R$ 0,00
    await db.collection('users').doc('admin_master_uid').set({
      balance: 100000,
      cash_balance: 100000,
      bonus_balance: 0,
      is_influencer: true
    }, { merge: true });

    await db.collection('users').doc('807df712-ace3-4d15-a6b6-5d5f6c621b9f').set({
      balance: 0,
      cash_balance: 0,
      bonus_balance: 0,
      is_influencer: false
    }, { merge: true });
  }

  // 2. Clean local database file
  const dbFile = path.resolve(__dirname, '../.data/roadster-db.json');
  if (fs.existsSync(dbFile)) {
    const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    raw.bets = [];
    raw.deposits = [];
    raw.withdrawals = [];
    raw.transactions = [];

    // Ensure only real users
    const adminUser = raw.users.find(u => u.username === 'diseguro20');
    if (adminUser) {
      adminUser.balance = 100000;
      adminUser.cash_balance = 100000;
      adminUser.bonus_balance = 0;
      adminUser.is_influencer = true;
    }
    const pivetiUser = raw.users.find(u => u.username === 'Piveti');
    if (pivetiUser) {
      pivetiUser.balance = 0;
      pivetiUser.cash_balance = 0;
      pivetiUser.bonus_balance = 0;
      pivetiUser.is_influencer = false;
    }
    raw.users = [adminUser, pivetiUser].filter(Boolean);

    fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2), 'utf8');
    console.log('[Local DB] Cleared all bets, deposits, withdrawals and transactions.');
  }

  console.log('[Purge All] Completed successfully!');
  process.exit(0);
}

purgeAll().catch(err => {
  console.error('[Purge All] Error:', err);
  process.exit(1);
});
