import admin from 'firebase-admin';

let db = null;
let firebaseInitialized = false;

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
let privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (privateKey && privateKey.includes('\\n')) {
  privateKey = privateKey.replace(/\\n/g, '\n');
}

if (projectId && clientEmail && privateKey) {
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey
        })
      });
    }
    db = admin.firestore();
    const origCollection = db.collection.bind(db);
    db.collection = function(name) {
      const collectionName = (typeof name === 'string' && !name.startsWith('roadster_'))
        ? `roadster_${name}`
        : name;
      return origCollection(collectionName);
    };
    firebaseInitialized = true;
    console.log('[Firebase] Firestore conectado com sucesso para o projeto:', projectId, '(prefixo: roadster_)');
  } catch (error) {
    console.warn('[Firebase] Falha ao inicializar Firebase Admin, operando em modo de banco local:', error.message);
  }
} else {
  console.log('[Firebase] Credenciais não fornecidas no .env. Operando com armazenamento local estruturado em .data/roadster-db.json');
}

export { admin, db, firebaseInitialized };
