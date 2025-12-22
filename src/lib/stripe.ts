import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  typescript: true,
});

export const STRIPE_CONFIG = {
  platformFeePercent: Number(process.env.STRIPE_PLATFORM_FEE_PERCENT) || 10,
  currency: process.env.STRIPE_CURRENCY || 'usd',
  paymentMethods: ['card', 'us_bank_account'] as const,
  webhookEndpoint: '/api/webhooks/stripe',
  connectAccountType: 'express' as const,
  refreshUrl: `${process.env.NEXT_PUBLIC_APP_URL}/vendor/onboarding/refresh`,
  returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/vendor/onboarding/complete`,
};

export interface StripeConnectAccount {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export async function createConnectAccount(vendorEmail: string, vendorId: string): Promise<string> {
  const account = await stripe.accounts.create({
    type: STRIPE_CONFIG.connectAccountType,
    email: vendorEmail,
    metadata: {
      vendorId,
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });

  return account.id;
}

export async function createAccountLink(accountId: string): Promise<string> {
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: STRIPE_CONFIG.refreshUrl,
    return_url: STRIPE_CONFIG.returnUrl,
    type: 'account_onboarding',
  });

  return accountLink.url;
}

export async function getConnectAccountStatus(accountId: string): Promise<StripeConnectAccount> {
  const account = await stripe.accounts.retrieve(accountId);

  return {
    accountId: account.id,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
  };
}

export async function createPaymentIntent(
  amount: number,
  vendorStripeAccountId: string,
  metadata: Record<string, string>
): Promise<Stripe.PaymentIntent> {
  const platformFee = Math.round(amount * (STRIPE_CONFIG.platformFeePercent / 100));

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: STRIPE_CONFIG.currency,
    payment_method_types: [...STRIPE_CONFIG.paymentMethods],
    application_fee_amount: platformFee,
    transfer_data: {
      destination: vendorStripeAccountId,
    },
    metadata,
  });

  return paymentIntent;
}

export async function createTransfer(
  amount: number,
  vendorStripeAccountId: string,
  metadata: Record<string, string>
): Promise<Stripe.Transfer> {
  const transfer = await stripe.transfers.create({
    amount,
    currency: STRIPE_CONFIG.currency,
    destination: vendorStripeAccountId,
    metadata,
  });

  return transfer;
}

export async function createRefund(
  paymentIntentId: string,
  amount?: number,
  reason?: Stripe.RefundCreateParams.Reason
): Promise<Stripe.Refund> {
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount,
    reason,
  });

  return refund;
}
