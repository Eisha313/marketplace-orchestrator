import { NextRequest, NextResponse } from 'next/server';
import { vendorService } from '@/lib/services/vendor-service';

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

    // TODO: Add authentication check to verify user owns this vendor
    // const session = await getServerSession();
    // if (!session) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

    const dashboardData = await vendorService.getVendorDashboardData(vendorId);

    if (!dashboardData) {
      return NextResponse.json(
        { error: 'Vendor not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(dashboardData);
  } catch (error) {
    console.error('Error fetching vendor dashboard:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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

    // TODO: Add authentication check
    // TODO: Validate input data

    const updatedVendor = await vendorService.updateVendorSettings(vendorId, {
      name: body.name,
      description: body.description,
      logo: body.logo,
      banner: body.banner,
      settings: body.settings,
    });

    return NextResponse.json(updatedVendor);
  } catch (error) {
    console.error('Error updating vendor settings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}