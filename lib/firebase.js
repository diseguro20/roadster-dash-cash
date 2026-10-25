import admin from 'firebase-admin';

let db = null;
let firebaseInitialized = false;

const projectId = process.env.FIREBASE_PROJECT_ID || 'blockerino-standalone-2026';
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || 'firebase-adminsdk-fbsvc@blockerino-standalone-2026.iam.gserviceaccount.com';
let privateKey = process.env.FIREBASE_PRIVATE_KEY || `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDA3MNSU+K0Gh43\nCjL3yoSSUdjm3DZy3Y0GViHk+6XU83kOUK2Oc9iwp0S7pAMdhmd2O5udDqEHz0Mf\nyfDU8jT8Iwq6A/+vhLziyqN26eqA2eJMr2nXo4vDEWNKPR8uttIa12oRAPVUJiK2\njG2S9oj/2jP/VjHP/gsjKhenKQEpLFMQ2Am9I7+MCKlwHnKL/32A2AC0s4f9Os0a\nL9/io/PjP6AkY7UhOM7T5NIBW1Az3NDyLSZXwG46odzEWHCplDRUaEMO0vlk9eBL\n/0rD177U02KH2clVsTDIhBmfM0uyS8HiNJ2o/+4a5giOBdFXtrGqREpJbPXNvpSM\nwR9q4VxPAgMBAAECggEAXAxBkNaGmezpRN2yS7+1nFxCCJVLy3DgcQjE7pQIpuV5\nfpKU8ytpXY7H6EK0VfAjCzQR5ljoFGEgqVhpgEkFbt2Org9ghjX1LM0ITaYBDXRw\nZKdH/eqJtxVibTlU26fYCYWMkwcBECOPZ88IMR9Hbc2ICbLq3VljmWnqlhak/i/c\nOdjgMlkVZENA/7RNmOXUJHmbUVqsHm2Us5pB5bAQEE9Y64CL17iUuHubJ6GMBVwp\nFUA+XBfoRcM7XuO7YYZsK1JFFanNdGnQa2BBWtbyUEgpeUnjEI0vIiUtAdS0cgKx\nDDVPyaDwhSPTku9MYZn8NFIm1rbjrk3dp8uuAZVHgQKBgQDoQh10a1cv+7P8DKyj\nX1U4vNPuoORpSvTAs9YO5hx3iP3LGt3TGfDC5J1eqWqoyFbiN9Kh8w0Wh6qfFJPv\nSg+T2HRiniSbViT8f34m4HnZy8AnMr2z6hSEzhyToMvhPF+bfpASHS+nYxYkvZWz\na/Q7ivyvBakdYANpSwsAqU0GDwKBgQDUk7XT6Xp0/HdNqfvFdTuVF9e2fGwVsVW6\ni8t6Lt8xHlPcTEmcMmjnRJ1/BU33nJAJYZU18W3g57fkgAkKEzubrpoyZjsGDJiG\ndENK98jOaXFOKT0Dy7YUKbUtATJ8LIxTk354phqnp0jwiOQUQYd4Ra2TH1BcOHRR\nIPJNO7aFwQKBgQCyzTtJxd0gNoDwOH2rZBgCjvQFEF3nZWoY9BmF7Mbbi13+v1co\nTh8YmtE/7+MJvvmMO/du7+MShiznPPtKS1TEt+2Zgi+iWmYs8KWYnlWQQxhR1PFQ\nEZPsTZSYXkC2zDi6R2v4Vfm6vkBs1nrp3uDt+ejfgNcZozHdHIWC49NFJwKBgClI\n5q9ZUOcXgTQcJ0GaGxBBqStPzs4HutaX/9Si9cXcVf0a89DaGXWQ5eWdah8E0RSB\nVzE6ylQ7rIM8OoUyZwk9R8UyBZSPLbAvNEKDDQTJha/gYnEyRxJzZzRuXxeurzIs\nGwvjdpnI62mLrIAimeTJ44QHONwwOqbm9yf4yOIBAoGAfajmpIJtTNW1V4W0OxCX\neoeXCI2auc/fN78ZREVuBnn13bcWUuzKnlMSD4TVQOthUmwECjfVzIjAAVyfpYa+\nJteY7XtVxTJULijYzi3oWx3qvKP4j5uus/iptkhWdp7Kef5AVBEGSgAdqWepMrGY\nJledU+bJLNU6jlc/nA0FmRs=\n-----END PRIVATE KEY-----\n`;

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
