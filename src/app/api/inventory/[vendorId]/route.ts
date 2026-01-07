import { NextRequest, NextResponse } from 'next/server';
import {
  getInventoryByVendor,
  updateInventoryQuantity,
  reserveInventory,
  releaseReservation,
  syncVendorInventory,
} from '@/lib/services/inventory-service';

interface RouteParams {
  params: { vendorId: string };
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { vendorId } = params;

    if (!vendorId) {
      return NextResponse.json(
        { error: 'Vendor ID is required' },
        { status: 400 }
      );
    }

    const inventory = await getInventoryByVendor(vendorId);

    return NextResponse.json({
      success: true,
      data: inventory,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    
    const isRetryable = error instanceof Error && 
      'retryable' in error && 
      (error as any).retryable;

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch inventory',
        retryable: isRetryable,
      },
      { status: isRetryable ? 503 : 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { vendorId } = params;
    const body = await request.json();
    const { inventoryId, quantityChange, expectedVersion, action } = body;

    if (!vendorId) {
      return NextResponse.json(
        { error: 'Vendor ID is required' },
        { status: 400 }
      );
    }

    if (action === 'reserve') {
      if (!inventoryId || typeof body.quantity !== 'number') {
        return NextResponse.json(
          { error: 'Inventory ID and quantity are required for reservation' },
          { status: 400 }
        );
      }

      const result = await reserveInventory(inventoryId, body.quantity);
      return NextResponse.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    }

    if (action === 'release') {
      if (!body.reservationId) {
        return NextResponse.json(
          { error: 'Reservation ID is required' },
          { status: 400 }
        );
      }

      await releaseReservation(body.reservationId);
      return NextResponse.json({
        success: true,
        message: 'Reservation released successfully',
        timestamp: new Date().toISOString(),
      });
    }

    if (action === 'update') {
      if (!inventoryId || typeof quantityChange !== 'number') {
        return NextResponse.json(
          { error: 'Inventory ID and quantity change are required' },
          { status: 400 }
        );
      }

      const updated = await updateInventoryQuantity(
        inventoryId,
        quantityChange,
        expectedVersion
      );

      return NextResponse.json({
        success: true,
        data: updated,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use: update, reserve, or release' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error updating inventory:', error);

    const errorCode = error instanceof Error && 'code' in error 
      ? (error as any).code 
      : 'UNKNOWN';
    
    const isRetryable = error instanceof Error && 
      'retryable' in error && 
      (error as any).retryable;

    const statusCodes: Record<string, number> = {
      NOT_FOUND: 404,
      INSUFFICIENT_STOCK: 409,
      VERSION_CONFLICT: 409,
      UNKNOWN: 500,
    };

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update inventory',
        code: errorCode,
        retryable: isRetryable,
      },
      { status: statusCodes[errorCode] || (isRetryable ? 503 : 500) }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { vendorId } = params;
    const body = await request.json();
    const { action } = body;

    if (!vendorId) {
      return NextResponse.json(
        { error: 'Vendor ID is required' },
        { status: 400 }
      );
    }

    if (action === 'sync') {
      const result = await syncVendorInventory(vendorId);
      
      return NextResponse.json({
        success: result.success,
        data: result,
        timestamp: new Date().toISOString(),
      }, { status: result.success ? 200 : 207 }); // 207 Multi-Status for partial success
    }

    return NextResponse.json(
      { error: 'Invalid action. Use: sync' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error in inventory POST:', error);

    const isRetryable = error instanceof Error && 
      'retryable' in error && 
      (error as any).retryable;

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Operation failed',
        retryable: isRetryable,
      },
      { status: isRetryable ? 503 : 500 }
    );
  }
}
