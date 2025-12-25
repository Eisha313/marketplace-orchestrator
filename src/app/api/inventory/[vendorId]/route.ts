import { NextRequest, NextResponse } from 'next/server';
import { inventoryService } from '@/lib/services/inventory-service';

export async function GET(
  request: NextRequest,
  { params }: { params: { vendorId: string } }
) {
  try {
    const { vendorId } = params;
    const inventory = await inventoryService.getVendorInventory(vendorId);

    return NextResponse.json({
      success: true,
      data: inventory,
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch inventory' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { vendorId: string } }
) {
  try {
    const { vendorId } = params;
    const body = await request.json();
    const { productId, quantityChange, reason, referenceId } = body;

    if (!productId || quantityChange === undefined || !reason) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const updated = await inventoryService.updateInventory({
      productId,
      vendorId,
      quantityChange,
      reason,
      referenceId,
    });

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error('Error updating inventory:', error);
    const message = error instanceof Error ? error.message : 'Failed to update inventory';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { vendorId: string } }
) {
  try {
    const { vendorId } = params;
    const body = await request.json();
    const { action, ...data } = body;

    switch (action) {
      case 'sync': {
        const { inventory } = data;
        await inventoryService.syncVendorInventory(vendorId, inventory);
        return NextResponse.json({
          success: true,
          message: 'Inventory synchronized successfully',
        });
      }

      case 'reserve': {
        const { productId, quantity, orderId } = data;
        const reserved = await inventoryService.reserveInventory(
          productId,
          vendorId,
          quantity,
          orderId
        );
        return NextResponse.json({
          success: reserved,
          message: reserved ? 'Inventory reserved' : 'Insufficient inventory',
        });
      }

      case 'release': {
        const { orderId } = data;
        await inventoryService.releaseReservation(orderId);
        return NextResponse.json({
          success: true,
          message: 'Reservation released',
        });
      }

      case 'confirm': {
        const { orderId } = data;
        await inventoryService.confirmReservation(orderId);
        return NextResponse.json({
          success: true,
          message: 'Reservation confirmed',
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Error processing inventory action:', error);
    const message = error instanceof Error ? error.message : 'Failed to process action';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}