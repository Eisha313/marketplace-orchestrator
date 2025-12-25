import { NextRequest, NextResponse } from 'next/server';
import { comparisonService } from '@/lib/services/comparison-service';

export async function GET(
  request: NextRequest,
  { params }: { params: { vendorId: string } }
) {
  try {
    const { vendorId } = params;

    if (!vendorId) {
      return NextResponse.json(
        { error: 'Vendor ID is required' },
        { status: 400 }
      );
    }

    const reputation = await comparisonService.getVendorReputation(vendorId);

    // Calculate grade based on overall score
    let grade: string;
    if (reputation.overallScore >= 0.9) {
      grade = 'A+';
    } else if (reputation.overallScore >= 0.8) {
      grade = 'A';
    } else if (reputation.overallScore >= 0.7) {
      grade = 'B+';
    } else if (reputation.overallScore >= 0.6) {
      grade = 'B';
    } else if (reputation.overallScore >= 0.5) {
      grade = 'C';
    } else {
      grade = 'D';
    }

    return NextResponse.json({
      ...reputation,
      grade,
      breakdown: {
        reviewsWeight: '30%',
        responseRateWeight: '15%',
        fulfillmentRateWeight: '25%',
        shippingSpeedWeight: '15%',
        disputeRateWeight: '15%',
      },
    });
  } catch (error) {
    console.error('Error fetching vendor reputation:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vendor reputation' },
      { status: 500 }
    );
  }
}