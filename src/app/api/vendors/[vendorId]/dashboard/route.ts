import { NextRequest } from 'next/server';
import { VendorService } from '@/lib/services/vendor-service';
import { ApiResponseBuilder, handleApiError } from '@/lib/utils/api-response';

const vendorService = new VendorService();

export async function GET(
  request: NextRequest,
  { params }: { params: { vendorId: string } }
) {
  try {
    const { vendorId } = params;

    if (!vendorId) {
      return ApiResponseBuilder.badRequest('Vendor ID is required');
    }

    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get('period') || '30d';

    const validPeriods = ['7d', '30d', '90d', '1y'];
    if (!validPeriods.includes(period)) {
      return ApiResponseBuilder.badRequest('Invalid period', {
        validPeriods,
        received: period,
      });
    }

    const dashboardData = await vendorService.getDashboardData(vendorId, period);

    if (!dashboardData) {
      return ApiResponseBuilder.notFound('Vendor');
    }

    return ApiResponseBuilder.success(dashboardData);
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

    const { action, settings } = body;

    if (!action) {
      return ApiResponseBuilder.badRequest('Action is required');
    }

    switch (action) {
      case 'update_settings':
        const updatedSettings = await vendorService.updateDashboardSettings(
          vendorId,
          settings
        );
        return ApiResponseBuilder.success(updatedSettings);

      case 'refresh_analytics':
        const analytics = await vendorService.refreshAnalytics(vendorId);
        return ApiResponseBuilder.success(analytics);

      case 'export_report':
        const report = await vendorService.generateReport(vendorId, body.reportType);
        return ApiResponseBuilder.success(report);

      default:
        return ApiResponseBuilder.badRequest('Invalid action', {
          validActions: ['update_settings', 'refresh_analytics', 'export_report'],
        });
    }
  } catch (error) {
    return handleApiError(error);
  }
}
