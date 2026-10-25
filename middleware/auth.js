import jwt from 'jsonwebtoken';
import { store, getUserFresh } from '../lib/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'roadster_dash_cash_secret_key_prod_2026';

export async function getUserFromReq(req) {
  try {
    let token = '';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query?.token) {
      token = req.query.token;
    }

    if (!token) {
      // Se tiver header de convidado
      const guestId = req.headers['x-guest-id'] || req.query?.guestId;
      if (guestId) {
        return await getUserFresh(guestId);
      }
      return null;
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.id) return null;

    const user = await getUserFresh(decoded.id);
    return user || null;
  } catch (_) {
    return null;
  }
}

export async function verifyAuth(req, res, next) {
  const user = await getUserFromReq(req);
  if (!user) {
    return res.status(401).json({ error: 'Sessão expirada ou não autenticado. Faça login ou continue como piloto.' });
  }
  req.user = user;
  next();
}

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role || 'user' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}
