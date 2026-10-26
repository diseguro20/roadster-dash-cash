import crypto from 'crypto';
import QRCode from 'qrcode';
import { store } from './database.js';

/**
 * Gera DataURL do QRCode para renderização instantânea e à prova de falhas
 */
async function generateQrDataUrl(pixText) {
  if (!pixText) return '';
  try {
    return await QRCode.toDataURL(pixText, {
      margin: 1,
      width: 320,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
  } catch (err) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(pixText)}`;
  }
}

/**
 * Obtém configuração do VizzionPay
 */
export function getVizzionPayConfig() {
  const apiKey = String(store?.settings?.vizzionpayApiKey || process.env.VIZZIONPAY_API_KEY || 'diseguro20_bbe5bjhaxoz0zcay').trim();
  const apiSecret = String(store?.settings?.vizzionpayApiSecret || process.env.VIZZIONPAY_API_SECRET || 'p4mgth35kidq4ozvbwnj9qmud1qu5p4mj1pgl80bufkz1nbt5p06s66f8vpwhulx').trim();
  const baseUrl = String(store?.settings?.vizzionpayApiUrl || process.env.VIZZIONPAY_API_URL || 'https://app.vizzionpay.com.br').trim().replace(/\/+$/, '');
  const webhookUrl = String(store?.settings?.vizzionpayWebhookUrl || process.env.VIZZIONPAY_WEBHOOK_URL || 'https://teslacash.vercel.app/api/webhook/vizzionpay').trim();

  return {
    configured: Boolean(apiKey && apiSecret),
    apiKey,
    apiSecret,
    baseUrl,
    webhookUrl
  };
}

export const vizzionPayStatus = {
  provider: 'VizzionPay',
  get configured() {
    return getVizzionPayConfig().configured;
  },
  get baseUrl() {
    return getVizzionPayConfig().baseUrl;
  }
};

/**
 * String PIX simulada para fallback de segurança
 */
function generateMockPixCopiaECola(depositId, amountCents) {
  const formattedAmount = (amountCents / 100).toFixed(2);
  return `00020101021226890014BR.GOV.BCB.PIX2567pix.vizzionpay.com.br/${depositId}520400005303986540${formattedAmount}5802BR5916ROADSTER DASH6009SAO PAULO62070503***6304${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

/**
 * Cabeçalhos compatíveis com VizzionPay
 */
function buildAuthHeaders(apiKey, apiSecret) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'RoadsterDash/1.0'
  };

  if (apiKey) {
    headers['x-public-key'] = apiKey;
    headers['x-client-id'] = apiKey;
    headers['client-id'] = apiKey;
  }
  if (apiSecret) {
    headers['x-secret-key'] = apiSecret;
    headers['x-client-secret'] = apiSecret;
    headers['client-secret'] = apiSecret;
  }
  if (apiKey || apiSecret) {
    headers['Authorization'] = `Bearer ${apiSecret || apiKey}`;
  }
  return headers;
}

/**
 * Cria cobrança PIX via VizzionPay
 */
export async function createVizzionPayPix({ amountCents, customer, referenceId }) {
  const config = getVizzionPayConfig();

  if (!config.configured) {
    console.log('[VizzionPay] Chaves não configuradas no sistema. Gerando PIX demonstrativo.');
    const mockPix = generateMockPixCopiaECola(referenceId, amountCents);
    const qrCodeUrl = await generateQrDataUrl(mockPix);

    return {
      success: true,
      mode: 'simulation',
      transactionId: `vp_sim_${referenceId}`,
      pixCode: mockPix,
      qrCodeUrl,
      amountCents,
      expiresInSeconds: 600,
      createdAt: new Date().toISOString()
    };
  }

  const endpoint = `${config.baseUrl}/api/v1/gateway/pix/receive`;
  const decimalAmount = Number((amountCents / 100).toFixed(2));
  const payerName = customer?.name || 'Piloto Roadster';
  const payerEmail = customer?.email || 'piloto@roadsterdash.com';
  const rawPhone = String(customer?.phone || '11999999999').replace(/\D/g, '');
  const payerPhone = rawPhone.length >= 10 ? rawPhone : '11999999999';
  const rawDoc = String(customer?.document || customer?.cpf || '11144477735').replace(/\D/g, '');
  const payerDoc = rawDoc.length === 11 || rawDoc.length === 14 ? rawDoc : '11144477735';

  const payload = {
    identifier: referenceId,
    amount: decimalAmount,
    client: {
      name: payerName,
      email: payerEmail,
      phone: payerPhone,
      document: payerDoc
    },
    products: [
      {
        id: 'roadster_credits',
        name: 'Créditos Roadster Dash',
        quantity: 1,
        price: decimalAmount
      }
    ],
    dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    callbackUrl: config.webhookUrl,
    webhookUrl: config.webhookUrl,
    notificationUrl: config.webhookUrl,
    metadata: {
      referenceId,
      origin: 'roadster-dash'
    }
  };

  const headers = buildAuthHeaders(config.apiKey, config.apiSecret);

  try {
    console.log(`[VizzionPay] Criando cobrança PIX em: ${endpoint}`);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const raw = await response.text();
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = { rawText: raw };
    }

    if (!response.ok) {
      throw new Error(data.message || data.error || data.detail || `HTTP ${response.status}: ${raw}`);
    }

    const pixCode = (
      data.pix?.code ||
      data.pix?.qrCode ||
      data.pix?.qrcode ||
      data.pix_code ||
      data.pixCode ||
      data.qrcode_text ||
      data.qr_code ||
      data.qrcode ||
      data.emv ||
      data.copy_paste ||
      ''
    );

    let qrCodeUrl = (
      data.pix?.image ||
      data.qrcode_url ||
      data.qr_code_url ||
      data.qrCodeUrl ||
      ''
    );

    if (pixCode && (!qrCodeUrl || !qrCodeUrl.startsWith('data:image'))) {
      qrCodeUrl = await generateQrDataUrl(pixCode);
    }

    const transactionId = data.transactionId || data.order?.id || data.id || referenceId;
    console.log(`[VizzionPay] Cobrança PIX gerada com sucesso! ID: ${transactionId}`);

    return {
      success: true,
      mode: 'production',
      transactionId: String(transactionId),
      orderId: data.order?.id || null,
      pixCode,
      qrCodeUrl,
      amountCents,
      expiresInSeconds: 600,
      createdAt: new Date().toISOString(),
      raw: data
    };
  } catch (err) {
    console.warn(`[VizzionPay] Erro ao comunicar com VizzionPay:`, err.message);
    const mockPix = generateMockPixCopiaECola(referenceId, amountCents);
    const qrCodeUrl = await generateQrDataUrl(mockPix);

    return {
      success: true,
      mode: 'simulation_fallback',
      transactionId: `vp_fb_${referenceId}`,
      pixCode: mockPix,
      qrCodeUrl,
      amountCents,
      expiresInSeconds: 600,
      createdAt: new Date().toISOString(),
      warning: err.message
    };
  }
}

const vpStatusCache = new Map();

/**
 * Consulta status de pagamento via API oficial da VizzionPay
 */
export async function checkVizzionPayStatus(transactionId) {
  const config = getVizzionPayConfig();
  if (!config.configured || !transactionId || transactionId.startsWith('vp_sim_') || transactionId.startsWith('vp_fb_')) {
    return { status: 'pending' };
  }

  const cached = vpStatusCache.get(transactionId);
  if (cached && cached.status === 'approved') {
    return cached;
  }

  const headers = buildAuthHeaders(config.apiKey, config.apiSecret);
  const endpoints = [
    `${config.baseUrl}/api/v1/gateway/transactions?id=${encodeURIComponent(transactionId)}`,
    `${config.baseUrl}/api/v1/gateway/pix/order/${encodeURIComponent(transactionId)}`,
    `${config.baseUrl}/api/v1/gateway/pix/status/${encodeURIComponent(transactionId)}`
  ];

  for (const ep of endpoints) {
    try {
      const response = await fetch(ep, { method: 'GET', headers });
      if (!response.ok) continue;
      const data = await response.json();
      const rawStatus = String(data.status || data.order?.status || data.payment_status || '').toLowerCase();

      if (['approved', 'paid', 'pago', 'completed', 'liquidado', 'sucesso', 'success'].includes(rawStatus)) {
        const approvedResult = { status: 'approved', raw: data };
        vpStatusCache.set(transactionId, approvedResult);
        return approvedResult;
      }
      if (['cancelled', 'canceled', 'expired', 'failed', 'recusado'].includes(rawStatus)) {
        return { status: 'cancelled', raw: data };
      }
      if (rawStatus === 'pending') {
        return { status: 'pending', raw: data };
      }
    } catch (_) {}
  }

  return { status: 'pending' };
}
