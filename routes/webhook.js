import express from 'express';
import { approveDepositAndCreditUser, store } from '../lib/database.js';

const router = express.Router();

router.post(['/vizzionpay', '/vizzionpay/callback', '/pix'], async (req, res) => {
  try {
    const body = req.body || {};
    console.log('[Webhook VizzionPay] Notificação recebida:', JSON.stringify(body));

    const identifier = (
      body.identifier ||
      body.clientIdentifier ||
      body.referenceId ||
      body.transactionId ||
      body.id ||
      body.order?.id ||
      body.data?.identifier ||
      body.data?.clientIdentifier ||
      body.data?.referenceId ||
      body.data?.transactionId ||
      body.data?.id
    );

    const status = String(
      body.status ||
      body.order?.status ||
      body.payment_status ||
      body.data?.status ||
      ''
    ).toLowerCase();

    const isPaid = [
      'approved',
      'paid',
      'pago',
      'completed',
      'liquidado',
      'sucesso',
      'success'
    ].includes(status);

    if (identifier && (isPaid || !status)) {
      const dep = await approveDepositAndCreditUser(identifier);
      if (dep) {
        console.log(`[Webhook VizzionPay] Depósito ${identifier} APROVADO e creditado via Webhook!`);
        return res.json({ success: true, message: 'Depósito aprovado com sucesso' });
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[Webhook VizzionPay] Erro no processamento:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Webhook Amplo Pay
router.post(['/amplopay', '/amplopay/callback', '/amplo'], async (req, res) => {
  try {
    const body = req.body || {};
    console.log('[Webhook AmploPay] Notificação recebida:', JSON.stringify(body));

    const identifier = (
      body.identifier ||
      body.clientIdentifier ||
      body.referenceId ||
      body.transactionId ||
      body.id ||
      body.order?.id ||
      body.data?.identifier ||
      body.data?.clientIdentifier ||
      body.data?.referenceId ||
      body.data?.transactionId ||
      body.data?.id
    );

    const status = String(
      body.status ||
      body.order?.status ||
      body.payment_status ||
      body.data?.status ||
      body.event ||
      ''
    ).toLowerCase();

    const isPaid = [
      'approved',
      'paid',
      'pago',
      'completed',
      'liquidado',
      'sucesso',
      'success',
      'transaction_paid'
    ].includes(status);

    if (identifier && (isPaid || !status)) {
      const dep = await approveDepositAndCreditUser(identifier);
      if (dep) {
        console.log(`[Webhook AmploPay] Depósito ${identifier} APROVADO e creditado via Webhook!`);
        return res.json({ success: true, message: 'Depósito aprovado com sucesso via Amplo Pay' });
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[Webhook AmploPay] Erro no processamento:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
