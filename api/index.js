import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { store } from '../lib/database.js';
import authRoutes from '../routes/auth.js';
import walletRoutes from '../routes/wallet.js';
import gameRoutes from '../routes/game.js';
import webhookRoutes from '../routes/webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();

// Middlewares essenciais
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Normalizador de rotas Vercel Serverless
app.use((req, res, next) => {
  const matchParam = req.query?.match || req.query?.path;
  if (matchParam && (req.url.startsWith('/api/index.js') || req.url.startsWith('/index.js') || req.path === '/' || req.path === '/api' || req.path === '/api/index.js')) {
    const cleanPath = Array.isArray(matchParam) ? matchParam.join('/') : matchParam;
    req.url = `/api/${cleanPath.replace(/^\/+/, '')}`;
  }
  next();
});

// Rotas de API
app.use(['/api/auth', '/auth'], authRoutes);
app.use(['/api/wallet', '/wallet'], walletRoutes);
app.use(['/api/game', '/game'], gameRoutes);
app.use(['/api/webhook', '/webhook'], webhookRoutes);

// Health check & configurações públicas
app.get(['/api/health', '/health'], (req, res) => {
  res.json({
    status: 'online',
    platform: 'Roadster Dash Cash',
    time: new Date().toISOString()
  });
});

app.get(['/api/settings/public', '/settings/public'], (req, res) => {
  res.json({
    platformName: store.settings.platformName || 'Roadster Dash Cash',
    minBet: store.settings.minBet,
    maxBet: store.settings.maxBet,
    minDeposit: store.settings.minDeposit,
    minWithdrawal: store.settings.minWithdrawal,
    bonusPercent: store.settings.bonusPercent,
    maintenance: store.settings.maintenance
  });
});

// Arquivos estáticos
app.use(express.static(rootDir));
app.use('/assets', express.static(path.join(rootDir, 'assets')));
app.use('/icons', express.static(path.join(rootDir, 'icons')));
app.use('/items', express.static(path.join(rootDir, 'items')));

// Fallback para rota principal / SPA
app.use((req, res) => {
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/auth') ||
    req.path.startsWith('/wallet') ||
    req.path.startsWith('/game') ||
    req.path.startsWith('/webhook')
  ) {
    return res.status(404).json({ error: 'Endpoint não encontrado.' });
  }
  res.sendFile(path.join(rootDir, 'index.html'));
});

// Inicialização local (se não for ambiente serverless da Vercel)
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT || 3005);
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(` 🏎️💨 Roadster Dash Cash rodando com sucesso!`);
    console.log(` 🌐 URL Local: http://localhost:${PORT}/`);
    console.log(` 💰 PIX VizzionPay: ATIVO`);
    console.log(` 🔥 Firebase Firestore: ATIVO`);
    console.log(`======================================================\n`);
  });
}

export default app;
