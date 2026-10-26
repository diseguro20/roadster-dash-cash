const { db, firebaseInitialized } = require('../lib/firebase.js');
const fs = require('fs');
const path = require('path');

const keepUsernames = ['diseguro20', 'Piveti'];
const keepIds = ['admin_master_uid', '807df712-ace3-4d15-a6b6-5d5f6c621b9f'];

async function purge() {
  console.log('[Purge] Inactivity clean starting...');
  
  // 1. Clean local database file
  const dbFile = path.resolve(__dirname, '../.data/roadster-db.json');
  if (fs.existsSync(dbFile)) {
    const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const beforeCount = (raw.users || []).length;
    raw.users = (raw.users || []).filter(u => 
      keepIds.includes(u.id) || keepUsernames.includes(u.username)
    );
    // Also clean up any bets from deleted pilots
    raw.bets = (raw.bets || []).filter(b => keepIds.includes(b.uid));
    raw.deposits = (raw.deposits || []).filter(d => keepIds.includes(d.uid));
    raw.withdrawals = (raw.withdrawals || []).filter(w => keepIds.includes(w.uid));
    raw.transactions = (raw.transactions || []).filter(t => keepIds.includes(t.uid));
    
    fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2), 'utf8');
    console.log(`[Purge] Cleaned local database: ${beforeCount} -> ${raw.users.length} users remaining.`);
  }

  // 2. Clean Firestore
  if (firebaseInitialized && db) {
    const snap = await db.collection('users').get();
    let deletedCount = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      const shouldKeep = keepIds.includes(doc.id) || 
                         keepUsernames.includes(d.username) || 
                         (d.username && d.username.toLowerCase() === 'piveti') ||
                         (d.username && d.username.toLowerCase() === 'diseguro20');
      if (!shouldKeep) {
        console.log(`[Purge] Deleting fake lead from Firestore: ${doc.id} (${d.username})`);
        await db.collection('users').doc(doc.id).delete();
        deletedCount++;
      } else {
        console.log(`[Purge] Keeping genuine user in Firestore: ${doc.id} (${d.username})`);
      }
    }
    console.log(`[Purge] Deleted ${deletedCount} fake leads from Firestore.`);

    // Clean bets from fake leads
    const betsSnap = await db.collection('bets').get();
    for (const doc of betsSnap.docs) {
      if (!keepIds.includes(doc.data().uid)) {
        await db.collection('bets').doc(doc.id).delete();
      }
    }
  }

  console.log('[Purge] Completed successfully!');
  process.exit(0);
}

purge().catch(err => {
  console.error('[Purge] Error:', err);
  process.exit(1);
});
