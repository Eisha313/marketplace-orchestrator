import { NextRequest, NextResponse } from 'next/server';
import { disputeService, DisputeReason } from '@/lib/services/dispute-service';
import { apiResponse, apiError } from '@/lib/utils/api-response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, buyerId, vendorId, reason, description, initialEvidence } = body;

    if (!orderId || !buyerId || !vendorId || !reason || !description) {
      return apiError('Missing required fields', 400);
    }

    const validReasons: DisputeReason[] = [
      'not_received',
      'not_as_described',
      'damaged',
      'wrong_item',
      'unauthorized',
      'other'
    ];

    if (!validReasons.includes(reason)) {
      return apiError('Invalid dispute reason', 400);
    }

    const dispute = await disputeService.createDispute({
      orderId,
      buyerId,
      vendorId,
      reason,
      description,
      initialEvidence
    });

    return apiResponse(dispute, 201);
  } catch (error) {
    console.error('Error creating dispute:', error);
    return apiError(
      error instanceof Error ? error.message : 'Failed to create dispute',
      500
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const role = searchParams.get('role') as 'buyer' | 'vendor';

    if (!userId || !role) {
      return apiError('Missing userId or role parameter', 400);
    }

    if (!['buyer', 'vendor'].includes(role)) {
      return apiError('Invalid role. Must be "buyer" or "vendor"', 400);
    }

    const disputes = await disputeService.getDisputesByUser(userId, role);

    return apiResponse({
      disputes,
      total: disputes.length
    });
  } catch (error) {
    console.error('Error fetching disputes:', error);
    return apiError('Failed to fetch disputes', 500);
  }
}