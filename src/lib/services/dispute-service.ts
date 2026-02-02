import { prisma } from '@/lib/db';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';

export type DisputeStatus = 'open' | 'under_review' | 'resolved_buyer' | 'resolved_seller' | 'escalated' | 'closed';
export type DisputeReason = 'not_received' | 'not_as_described' | 'damaged' | 'wrong_item' | 'unauthorized' | 'other';

export interface Dispute {
  id: string;
  orderId: string;
  buyerId: string;
  vendorId: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  escrowAmount: number;
  evidence: DisputeEvidence[];
  resolution?: DisputeResolution;
  createdAt: Date;
  updatedAt: Date;
  escalatedAt?: Date;
  resolvedAt?: Date;
}

export interface DisputeEvidence {
  id: string;
  disputeId: string;
  submittedBy: 'buyer' | 'seller' | 'admin';
  type: 'text' | 'image' | 'document' | 'tracking';
  content: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface DisputeResolution {
  id: string;
  disputeId: string;
  outcome: 'full_refund' | 'partial_refund' | 'no_refund' | 'replacement';
  refundAmount?: number;
  refundPercentage?: number;
  resolvedBy: string;
  notes: string;
  createdAt: Date;
}

export interface EscrowAccount {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'held' | 'released_to_seller' | 'refunded_to_buyer' | 'split';
  stripePaymentIntentId: string;
  heldAt: Date;
  releasedAt?: Date;
}

export class DisputeService {
  private static instance: DisputeService;
  
  // Auto-escalation threshold in days
  private readonly autoEscalationDays = 7;
  
  // Deadline for evidence submission in days
  private readonly evidenceDeadlineDays = 5;

  private constructor() {}

  static getInstance(): DisputeService {
    if (!DisputeService.instance) {
      DisputeService.instance = new DisputeService();
    }
    return DisputeService.instance;
  }

  async createDispute(params: {
    orderId: string;
    buyerId: string;
    vendorId: string;
    reason: DisputeReason;
    description: string;
    initialEvidence?: string;
  }): Promise<Dispute> {
    // Verify order exists and is eligible for dispute
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: { payment: true }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.buyerId !== params.buyerId) {
      throw new Error('Unauthorized: You can only dispute your own orders');
    }

    // Check if dispute already exists for this order
    const existingDispute = await prisma.dispute.findFirst({
      where: {
        orderId: params.orderId,
        status: { notIn: ['closed', 'resolved_buyer', 'resolved_seller'] }
      }
    });

    if (existingDispute) {
      throw new Error('An active dispute already exists for this order');
    }

    // Calculate escrow amount (order total)
    const escrowAmount = order.total;

    // Create dispute with escrow
    const dispute = await prisma.$transaction(async (tx) => {
      // Create the dispute
      const newDispute = await tx.dispute.create({
        data: {
          orderId: params.orderId,
          buyerId: params.buyerId,
          vendorId: params.vendorId,
          reason: params.reason,
          description: params.description,
          status: 'open',
          escrowAmount,
          evidenceDeadline: new Date(Date.now() + this.evidenceDeadlineDays * 24 * 60 * 60 * 1000)
        }
      });

      // Create escrow hold
      await tx.escrowAccount.create({
        data: {
          disputeId: newDispute.id,
          orderId: params.orderId,
          amount: escrowAmount,
          currency: 'usd',
          status: 'held',
          stripePaymentIntentId: order.payment?.stripePaymentIntentId || '',
          heldAt: new Date()
        }
      });

      // Add initial evidence if provided
      if (params.initialEvidence) {
        await tx.disputeEvidence.create({
          data: {
            disputeId: newDispute.id,
            submittedBy: 'buyer',
            type: 'text',
            content: params.initialEvidence
          }
        });
      }

      return newDispute;
    });

    // Notify vendor
    await this.notifyDisputeCreated(dispute as unknown as Dispute);

    return dispute as unknown as Dispute;
  }

  async submitEvidence(params: {
    disputeId: string;
    submittedBy: 'buyer' | 'seller';
    userId: string;
    type: DisputeEvidence['type'];
    content: string;
    metadata?: Record<string, any>;
  }): Promise<DisputeEvidence> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: params.disputeId }
    });

    if (!dispute) {
      throw new Error('Dispute not found');
    }

    // Verify user is authorized
    if (params.submittedBy === 'buyer' && dispute.buyerId !== params.userId) {
      throw new Error('Unauthorized');
    }
    if (params.submittedBy === 'seller' && dispute.vendorId !== params.userId) {
      throw new Error('Unauthorized');
    }

    // Check if dispute is still accepting evidence
    if (!['open', 'under_review'].includes(dispute.status)) {
      throw new Error('Dispute is no longer accepting evidence');
    }

    // Check evidence deadline
    if (dispute.evidenceDeadline && new Date() > dispute.evidenceDeadline) {
      throw new Error('Evidence submission deadline has passed');
    }

    const evidence = await prisma.disputeEvidence.create({
      data: {
        disputeId: params.disputeId,
        submittedBy: params.submittedBy,
        type: params.type,
        content: params.content,
        metadata: params.metadata || {}
      }
    });

    // If this is the first seller response, move to under_review
    if (params.submittedBy === 'seller' && dispute.status === 'open') {
      await prisma.dispute.update({
        where: { id: params.disputeId },
        data: { status: 'under_review' }
      });
    }

    return evidence as unknown as DisputeEvidence;
  }

  async resolveDispute(params: {
    disputeId: string;
    resolvedBy: string;
    outcome: DisputeResolution['outcome'];
    refundPercentage?: number;
    notes: string;
  }): Promise<DisputeResolution> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: params.disputeId },
      include: { escrowAccount: true }
    });

    if (!dispute) {
      throw new Error('Dispute not found');
    }

    if (['closed', 'resolved_buyer', 'resolved_seller'].includes(dispute.status)) {
      throw new Error('Dispute is already resolved');
    }

    const escrow = dispute.escrowAccount;
    if (!escrow) {
      throw new Error('Escrow account not found');
    }

    let refundAmount = 0;
    let newStatus: DisputeStatus;

    switch (params.outcome) {
      case 'full_refund':
        refundAmount = escrow.amount;
        newStatus = 'resolved_buyer';
        break;
      case 'partial_refund':
        refundAmount = Math.round(escrow.amount * (params.refundPercentage || 50) / 100);
        newStatus = 'resolved_buyer';
        break;
      case 'no_refund':
        refundAmount = 0;
        newStatus = 'resolved_seller';
        break;
      case 'replacement':
        refundAmount = 0;
        newStatus = 'resolved_buyer';
        break;
      default:
        throw new Error('Invalid outcome');
    }

    // Process the resolution
    const resolution = await prisma.$transaction(async (tx) => {
      // Create resolution record
      const res = await tx.disputeResolution.create({
        data: {
          disputeId: params.disputeId,
          outcome: params.outcome,
          refundAmount,
          refundPercentage: params.refundPercentage,
          resolvedBy: params.resolvedBy,
          notes: params.notes
        }
      });

      // Update dispute status
      await tx.dispute.update({
        where: { id: params.disputeId },
        data: {
          status: newStatus,
          resolvedAt: new Date()
        }
      });

      // Update escrow based on outcome
      if (refundAmount > 0) {
        if (refundAmount === escrow.amount) {
          await tx.escrowAccount.update({
            where: { id: escrow.id },
            data: {
              status: 'refunded_to_buyer',
              releasedAt: new Date()
            }
          });
        } else {
          await tx.escrowAccount.update({
            where: { id: escrow.id },
            data: {
              status: 'split',
              releasedAt: new Date()
            }
          });
        }
      } else {
        await tx.escrowAccount.update({
          where: { id: escrow.id },
          data: {
            status: 'released_to_seller',
            releasedAt: new Date()
          }
        });
      }

      return res;
    });

    // Process Stripe refund if needed
    if (refundAmount > 0 && escrow.stripePaymentIntentId) {
      await this.processStripeRefund(escrow.stripePaymentIntentId, refundAmount);
    }

    // Notify parties
    await this.notifyDisputeResolved(dispute as unknown as Dispute, resolution as unknown as DisputeResolution);

    return resolution as unknown as DisputeResolution;
  }

  async escalateDispute(disputeId: string, reason: string): Promise<Dispute> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId }
    });

    if (!dispute) {
      throw new Error('Dispute not found');
    }

    if (dispute.status !== 'under_review') {
      throw new Error('Only disputes under review can be escalated');
    }

    const updated = await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'escalated',
        escalatedAt: new Date(),
        escalationReason: reason
      }
    });

    // Notify admin team
    await this.notifyDisputeEscalated(updated as unknown as Dispute);

    return updated as unknown as Dispute;
  }

  async getDispute(disputeId: string): Promise<Dispute & { evidence: DisputeEvidence[]; resolution?: DisputeResolution }> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        evidence: {
          orderBy: { createdAt: 'asc' }
        },
        resolution: true,
        escrowAccount: true
      }
    });

    if (!dispute) {
      throw new Error('Dispute not found');
    }

    return dispute as unknown as Dispute & { evidence: DisputeEvidence[]; resolution?: DisputeResolution };
  }

  async getDisputesByUser(userId: string, role: 'buyer' | 'vendor'): Promise<Dispute[]> {
    const whereClause = role === 'buyer' 
      ? { buyerId: userId }
      : { vendorId: userId };

    const disputes = await prisma.dispute.findMany({
      where: whereClause,
      include: {
        evidence: true,
        resolution: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return disputes as unknown as Dispute[];
  }

  async checkAutoEscalation(): Promise<void> {
    const escalationThreshold = new Date(
      Date.now() - this.autoEscalationDays * 24 * 60 * 60 * 1000
    );

    const disputesToEscalate = await prisma.dispute.findMany({
      where: {
        status: 'under_review',
        createdAt: { lt: escalationThreshold },
        escalatedAt: null
      }
    });

    for (const dispute of disputesToEscalate) {
      await this.escalateDispute(
        dispute.id,
        `Auto-escalated: No resolution after ${this.autoEscalationDays} days`
      );
    }
  }

  private async processStripeRefund(paymentIntentId: string, amount: number): Promise<Stripe.Refund> {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: amount, // Amount in cents
        reason: 'requested_by_customer'
      });
      return refund;
    } catch (error) {
      console.error('Stripe refund failed:', error);
      throw new Error('Failed to process refund');
    }
  }

  private async notifyDisputeCreated(dispute: Dispute): Promise<void> {
    // TODO: Implement notification service integration
    console.log(`Dispute created: ${dispute.id} for order ${dispute.orderId}`);
  }

  private async notifyDisputeResolved(dispute: Dispute, resolution: DisputeResolution): Promise<void> {
    // TODO: Implement notification service integration
    console.log(`Dispute ${dispute.id} resolved with outcome: ${resolution.outcome}`);
  }

  private async notifyDisputeEscalated(dispute: Dispute): Promise<void> {
    // TODO: Implement notification service integration
    console.log(`Dispute ${dispute.id} escalated for admin review`);
  }
}

export const disputeService = DisputeService.getInstance();