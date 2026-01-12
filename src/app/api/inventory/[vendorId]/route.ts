import { NextRequest } from 'next/server';
import { InventoryService } from '@/lib/services/inventory-service';
import {
  ApiResponseBuilder,
  handleApiError,
  validateRequiredFields,
  parseQueryParams,
} from '@/lib/utils/api-response';

const inventoryService = new InventoryService();

export async function GET(
  request: NextRequest,
  { params }: { params: { vendorId: string } }
) {
  try {
    const { vendorId } = params;

    if (!vendorId) {
      return ApiResponseBuilder.badRequest('Vendor ID is required');
    }

    const { page, limit, sortBy, sortOrder, filters } = parseQueryParams(
      request.nextUrl.searchParams
    );

    const result = await inventoryService.getVendorInventory(vendorId, {
      page,
      limit,
      sortBy: sortBy || 'updatedAt',
      sortOrder,
      lowStockOnly: filters.lowStockOnly === 'true',
      category: filters.category,
      search: filters.search,
    });

    return ApiResponseBuilder.success(result.items, {
      page,
      limit,
      total: result.total,
      hasMore: page * limit < result.total,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { vendorId: string } }
) {
  try {
    const { vendorId } = params;
    const body = await request.json();

    if (!vendorId) {
      return ApiResponseBuilder.badRequest('Vendor ID is required');
    }

    const validation = validateRequiredFields(body, ['productId', 'quantity']);
    if (!validation.valid) {
      return ApiResponseBuilder.badRequest('Missing required fields', {
        missingFields: validation.missing,
      });
    }

    const { productId, quantity, warehouseId, notes } = body;

    if (typeof quantity !== 'number' || quantity < 0) {
      return ApiResponseBuilder.badRequest('Quantity must be a non-negative number');
    }

    const inventoryItem = await inventoryService.updateStock(vendorId, productId, {
      quantity,
      warehouseId,
      notes,
      updatedBy: 'api', // In real app, get from auth context
    });

    return ApiResponseBuilder.success(inventoryItem);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { vendorId: string } }
) {
  try {
    const { vendorId } = params;
    const body = await request.json();

    if (!vendorId) {
      return ApiResponseBuilder.badRequest('Vendor ID is required');
    }

    const { updates } = body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return ApiResponseBuilder.badRequest('Updates array is required');
    }

    if (updates.length > 100) {
      return ApiResponseBuilder.badRequest('Maximum 100 items per batch update');
    }

    const results = await inventoryService.batchUpdateStock(vendorId, updates);

    return ApiResponseBuilder.success({
      successful: results.successful,
      failed: results.failed,
      totalProcessed: updates.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { vendorId: string } }
) {
  try {
    const { vendorId } = params;
    const searchParams = request.nextUrl.searchParams;
    const productId = searchParams.get('productId');

    if (!vendorId) {
      return ApiResponseBuilder.badRequest('Vendor ID is required');
    }

    if (!productId) {
      return ApiResponseBuilder.badRequest('Product ID is required');
    }

    await inventoryService.removeFromInventory(vendorId, productId);

    return ApiResponseBuilder.noContent();
  } catch (error) {
    return handleApiError(error);
  }
}
