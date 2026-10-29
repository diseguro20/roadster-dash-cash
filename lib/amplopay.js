import crypto from 'crypto';
import QRCode from 'qrcode';
import { store } from './database.js';

/**
 * Gera DataURL do QRCode para renderização instantânea
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
 * Obtém configuração do Amplo Pay
 */
export function getAmploPayConfig() {
  const apiKey = String(store?.settings?.amplopayApiKey || process.env.AMPLOPAY_API_KEY || '').trim();
  const apiSecret = String(store?.settings?.amplopayApiSecret || process.env.AMPLOPAY_API_SECRET || '').trim();
  const baseUrl = String(store?.settings?.amplopayApiUrl || process.env.AMPLOPAY_API_URL || 'https://app.amplopay.com').trim().replace(/\/+$/, '');
  const webhookUrl = String(store?.settings?.amplopayWebhookUrl || process.env.AMPLOPAY_WEBHOOK_URL || 'https://teslacash.vercel.app/api/webhook/amplopay').trim();
  const amploPercent = Number(store?.settings?.amploPercent ?? process.env.AMPLO_PERCENT ?? 40);

  return {
    configured: Boolean(apiKey && apiSecret),
    apiKey,
    apiSecret,
    baseUrl,
    webhookUrl,
    amploPercent
  };
}

export const amploPayStatus = {
  provider: 'AmploPay',
  get configured() {
    return getAmploPayConfig().configured;
  },
  get baseUrl() {
    return getAmploPayConfig().baseUrl;
  },
  get webhookUrl() {
    return getAmploPayConfig().webhookUrl;
  }
};

/**
 * String PIX simulada para fallback de segurança se credenciais estiverem pendentes
 */
function generateMockPixCopiaECola(depositId, amountCents) {
  const formattedAmount = (amountCents / 100).toFixed(2);
  return `00020101021226890014BR.GOV.BCB.PIX2567pix.amplopay.com/${depositId}520400005303986540${formattedAmount}5802BR5916TESLA CASH6009SAO PAULO62070503***6304${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

/**
 * Cabeçalhos compatíveis com Amplo Pay (mesmo padrão REST de gateway de alta performance)
 */
function buildAuthHeaders(apiKey, apiSecret) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'TeslaCash-AmploPay/1.0'
  };

  if (apiKey) {
    headers['x-public-key'] = apiKey;
    headers['x-client-id'] = apiKey;
    headers['client-id'] = apiKey;
    headers['api-key'] = apiKey;
    headers['x-api-key'] = apiKey;
  }
  if (apiSecret) {
    headers['x-secret-key'] = apiSecret;
    headers['x-client-secret'] = apiSecret;
    headers['client-secret'] = apiSecret;
    headers['api-secret'] = apiSecret;
    headers['x-api-secret'] = apiSecret;
  }
  if (apiKey || apiSecret) {
    headers['Authorization'] = `Bearer ${apiSecret || apiKey}`;
  }
  return headers;
}

/**
 * Cria cobrança PIX via Amplo Pay
 */
export async function createAmploPayPix({ amountCents, customer, referenceId }) {
  const config = getAmploPayConfig();

  if (!config.configured) {
    console.log('[AmploPay] Chaves não configuradas no sistema. Operando em modo de fallback.');
    const mockPix = generateMockPixCopiaECola(referenceId, amountCents);
    const qrCodeUrl = await generateQrDataUrl(mockPix);

    return {
      success: true,
      mode: 'simulation',
      transactionId: `ap_sim_${referenceId}`,
      pixCode: mockPix,
      qrCodeUrl,
      amountCents,
      gateway: 'amplopay',
      expiresInSeconds: 600,
      createdAt: new Date().toISOString()
    };
  }

  const endpoints = [
    `${config.baseUrl}/api/v1/gateway/pix/receive`,
    `${config.baseUrl}/api/v1/pix/receive`,
    `https://api.amplopay.com/api/v1/gateway/pix/receive`
  ];

  const decimalAmount = Number((amountCents / 100).toFixed(2));
  const payerName = customer?.name || 'Piloto Tesla Cash';
  const payerEmail = customer?.email || 'piloto@teslacash.com';
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
        name: 'Créditos Tesla Cash',
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
      origin: 'teslacash',
      gateway: 'amplopay'
    }
  };

  const headers = buildAuthHeaders(config.apiKey, config.apiSecret);
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      console.log(`[AmploPay] Criando cobrança PIX em: ${endpoint}`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
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
      console.log(`[AmploPay] Cobrança PIX gerada com sucesso! ID: ${transactionId}`);

      return {
        success: true,
        mode: 'production',
        gateway: 'amplopay',
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
      lastError = err;
      console.warn(`[AmploPay] Falha no endpoint ${endpoint}:`, err.message);
    }
  }

  console.warn(`[AmploPay] Erro em todos os endpoints:`, lastError?.message);
  const mockPix = generateMockPixCopiaECola(referenceId, amountCents);
  const qrCodeUrl = await generateQrDataUrl(mockPix);

  return {
    success: true,
    mode: 'simulation_fallback',
    gateway: 'amplopay',
    transactionId: `ap_fb_${referenceId}`,
    pixCode: mockPix,
    qrCodeUrl,
    amountCents,
    expiresInSeconds: 600,
    createdAt: new Date().toISOString(),
    warning: lastError?.message || 'Falha ao conectar com AmploPay'
  };
}

const apStatusCache = new Map();

/**
 * Consulta status de pagamento via API oficial da Amplo Pay
 */
export async function checkAmploPayStatus(transactionId) {
  const config = getAmploPayConfig();
  if (!config.configured || !transactionId || transactionId.startsWith('ap_sim_') || transactionId.startsWith('ap_fb_')) {
    return { status: 'pending' };
  }

  const cached = apStatusCache.get(transactionId);
  if (cached && cached.status === 'approved') {
    return cached;
  }

  const headers = buildAuthHeaders(config.apiKey, config.apiSecret);
  const endpoints = [
    `${config.baseUrl}/api/v1/gateway/transactions?id=${encodeURIComponent(transactionId)}`,
    `${config.baseUrl}/api/v1/gateway/pix/order/${encodeURIComponent(transactionId)}`,
    `${config.baseUrl}/api/v1/gateway/pix/status/${encodeURIComponent(transactionId)}`,
    `https://api.amplopay.com/api/v1/gateway/transactions?id=${encodeURIComponent(transactionId)}`
  ];

  for (const ep of endpoints) {
    try {
      const response = await fetch(ep, { method: 'GET', headers, signal: AbortSignal.timeout(6000) });
      if (!response.ok) continue;
      const data = await response.json();
      const rawStatus = String(data.status || data.order?.status || data.payment_status || '').toLowerCase();

      if (['approved', 'paid', 'pago', 'completed', 'liquidado', 'sucesso', 'success'].includes(rawStatus)) {
        const approvedResult = { status: 'approved', raw: data };
        apStatusCache.set(transactionId, approvedResult);
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
