import { NextRequest, NextResponse } from 'next/server';
import { disputeService } from '@/lib/services/dispute-service';
import { apiResponse, apiError } from '@/lib/utils/api-response';

export async function GET(
  request: NextRequest,
  { params }: { params: { disputeId: string } }
) {
  try {
    const { disputeId } = params;

    if (!disputeId) {
      return apiError('Dispute ID is required', 400);
    }

    const dispute = await disputeService.getDispute(disputeId);

    return apiResponse(dispute);
  } catch (error) {
    console.error('Error fetching dispute:', error);
    return apiError(
      error instanceof Error ? error.message : 'Failed to fetch dispute',
      error instanceof Error && error.message === 'Dispute not found' ? 404 : 500
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { disputeId: string } }
) {
  try {
    const { disputeId } = params;
    const body = await request.json();
    const { action } = body;

    if (!disputeId) {
      return apiError('Dispute ID is required', 400);
    }

    switch (action) {
      case 'submit_evidence': {
        const { submittedBy, userId, type, content, metadata } = body;
        
        if (!submittedBy || !userId || !type || !content) {
          return apiError('Missing required fields for evidence submission', 400);
        }

        const evidence = await disputeService.submitEvidence({
          disputeId,
          submittedBy,
          userId,
          type,
          content,
          metadata
        });

        return apiResponse(evidence, 201);
      }

      case 'resolve': {
        const { resolvedBy, outcome, refundPercentage, notes } = body;
        
        if (!resolvedBy || !outcome || !notes) {
          return apiError('Missing required fields for resolution', 400);
        }

        const resolution = await disputeService.resolveDispute({
          disputeId,
          resolvedBy,
          outcome,
          refundPercentage,
          notes
        });

        return apiResponse(resolution);
      }

      case 'escalate': {
        const { reason } = body;
        
        if (!reason) {
          return apiError('Escalation reason is required', 400);
        }

        const escalated = await disputeService.escalateDispute(disputeId, reason);

        return apiResponse(escalated);
      }

      default:
        return apiError('Invalid action', 400);
    }
  } catch (error) {
    console.error('Error processing dispute action:', error);
    return apiError(
      error instanceof Error ? error.message : 'Failed to process dispute action',
      500
    );
  }
}