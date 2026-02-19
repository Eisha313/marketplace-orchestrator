import { db } from '@/lib/db';
import { stripe } from '@/lib/stripe';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/utils/service-errors';
import { logger, measureTime } from '@/lib/utils/logger';

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'escalated' | 'closed';
export type DisputeReason = 'item_not_received' | 'item_not_as_described' | 'unauthorized_charge' | 'duplicate_charge' | 'other';
export type Resolution = 'full_refund' | 'partial_refund' | 'replacement' | 'no_action' | 'vendor_favor' | 'buyer_favor';

export interface CreateDisputeInput {
  orderId: string;
  buyerId: string;
  vendorId: string;
  reason: DisputeReason;
  description: string;
  amount: number;
  evidence?: string[];
}

export interface DisputeResponse {
  responderId: string;
  responderType: 'vendor' | 'buyer' | 'admin';
  message: string;
  attachments?: string[];
}

export interface ResolveDisputeInput {
  resolution: Resolution;
  refundAmount?: number;
  adminNotes?: string;
}

const disputeLogger = logger.child({ service: 'dispute' });

export async function createDispute(input: CreateDisputeInput) {
  return measureTime('createDispute', async () => {
    disputeLogger.info('Creating dispute', { orderId: input.orderId, reason: input.reason });

    const order = await db.order.findUnique({
      where: { id: input.orderId },
      include: { payment: true },
    });

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    if (order.buyerId !== input.buyerId) {
      throw new ValidationError('You can only dispute your own orders');
    }

    const existingDispute = await db.dispute.findFirst({
      where: {
        orderId: input.orderId,
        status: { in: ['open', 'under_review', 'escalated'] },
      },
    });

    if (existingDispute) {
      throw new ConflictError('An active dispute already exists for this order');
    }

    // Create escrow hold on payment if Stripe transfer exists
    let escrowId: string | undefined;
    if (order.payment?.stripeTransferId) {
      try {
        const reversal = await stripe.transfers.createReversal(
          order.payment.stripeTransferId,
          { amount: Math.round(input.amount * 100) }
        );
        escrowId = reversal.id;
        disputeLogger.info('Created escrow hold', { escrowId, amount: input.amount });
      } catch (error) {
        disputeLogger.warn('Failed to create escrow hold', { error });
      }
    }

    const dispute = await db.dispute.create({
      data: {
        orderId: input.orderId,
        buyerId: input.buyerId,
        vendorId: input.vendorId,
        reason: input.reason,
        description: input.description,
        amount: input.amount,
        status: 'open',
        escrowId,
        evidence: input.evidence || [],
        responses: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    disputeLogger.info('Dispute created successfully', { disputeId: dispute.id });
    return dispute;
  }, { orderId: input.orderId });
}

export async function getDispute(disputeId: string) {
  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    include: {
      order: true,
      buyer: { select: { id: true, name: true, email: true } },
      vendor: { select: { id: true, businessName: true, email: true } },
    },
  });

  if (!dispute) {
    throw new NotFoundError('Dispute not found');
  }

  return dispute;
}

export async function addDisputeResponse(disputeId: string, response: DisputeResponse) {
  disputeLogger.info('Adding dispute response', { disputeId, responderType: response.responderType });

  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    throw new NotFoundError('Dispute not found');
  }

  if (['resolved', 'closed'].includes(dispute.status)) {
    throw new ConflictError('Cannot respond to a closed dispute');
  }

  const updatedResponses = [
    ...(dispute.responses as DisputeResponse[]),
    {
      ...response,
      createdAt: new Date().toISOString(),
    },
  ];

  const updatedDispute = await db.dispute.update({
    where: { id: disputeId },
    data: {
      responses: updatedResponses,
      status: dispute.status === 'open' ? 'under_review' : dispute.status,
      updatedAt: new Date(),
    },
  });

  return updatedDispute;
}

export async function resolveDispute(disputeId: string, input: ResolveDisputeInput, adminId: string) {
  return measureTime('resolveDispute', async () => {
    disputeLogger.info('Resolving dispute', { disputeId, resolution: input.resolution });

    const dispute = await db.dispute.findUnique({
      where: { id: disputeId },
      include: { order: { include: { payment: true } } },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute not found');
    }

    if (['resolved', 'closed'].includes(dispute.status)) {
      throw new ConflictError('Dispute is already resolved');
    }

    let refundId: string | undefined;

    // Process refund if applicable
    if (['full_refund', 'partial_refund', 'buyer_favor'].includes(input.resolution)) {
      const refundAmount = input.resolution === 'full_refund' 
        ? dispute.amount 
        : (input.refundAmount || 0);

      if (dispute.order.payment?.stripePaymentIntentId) {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: dispute.order.payment.stripePaymentIntentId,
            amount: Math.round(refundAmount * 100),
            reason: 'requested_by_customer',
          });
          refundId = refund.id;
          disputeLogger.info('Refund processed', { refundId, amount: refundAmount });
        } catch (error) {
          disputeLogger.error('Failed to process refund', error as Error, { disputeId });
          throw new Error('Failed to process refund');
        }
      }
    }

    const resolvedDispute = await db.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'resolved',
        resolution: input.resolution,
        refundAmount: input.refundAmount,
        refundId,
        resolvedBy: adminId,
        resolvedAt: new Date(),
        adminNotes: input.adminNotes,
        updatedAt: new Date(),
      },
    });

    disputeLogger.info('Dispute resolved successfully', { 
      disputeId, 
      resolution: input.resolution,
      refundId 
    });

    return resolvedDispute;
  }, { disputeId });
}

export async function escalateDispute(disputeId: string, reason: string) {
  disputeLogger.warn('Escalating dispute', { disputeId, reason });

  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    throw new NotFoundError('Dispute not found');
  }

  if (dispute.status === 'escalated') {
    throw new ConflictError('Dispute is already escalated');
  }

  return db.dispute.update({
    where: { id: disputeId },
    data: {
      status: 'escalated',
      escalationReason: reason,
      escalatedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function listDisputes(filters: {
  vendorId?: string;
  buyerId?: string;
  status?: DisputeStatus;
  page?: number;
  limit?: number;
}) {
  const { vendorId, buyerId, status, page = 1, limit = 20 } = filters;

  const where: Record<string, unknown> = {};
  if (vendorId) where.vendorId = vendorId;
  if (buyerId) where.buyerId = buyerId;
  if (status) where.status = status;

  const [disputes, total] = await Promise.all([
    db.dispute.findMany({
      where,
      include: {
        order: { select: { id: true, orderNumber: true } },
        buyer: { select: { id: true, name: true } },
        vendor: { select: { id: true, businessName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.dispute.count({ where }),
  ]);

  return {
    disputes,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}