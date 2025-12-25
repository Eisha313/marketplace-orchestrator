import { NextRequest, NextResponse } from 'next/server';
import { comparisonService, ComparisonFilter } from '@/lib/services/comparison-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const categoryId = searchParams.get('categoryId');
    const filtersParam = searchParams.get('filters');

    if (!categoryId) {
      return NextResponse.json(
        { error: 'Category ID is required' },
        { status: 400 }
      );
    }

    let filters: ComparisonFilter[] | undefined;
    if (filtersParam) {
      try {
        filters = JSON.parse(filtersParam);
      } catch {
        return NextResponse.json(
          { error: 'Invalid filters format' },
          { status: 400 }
        );
      }
    }

    const products = await comparisonService.getComparableProducts(
      categoryId,
      filters
    );

    return NextResponse.json({
      products,
      total: products.length,
    });
  } catch (error) {
    console.error('Error fetching comparable products:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comparable products' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productIds } = body;

    if (!productIds || !Array.isArray(productIds)) {
      return NextResponse.json(
        { error: 'Product IDs array is required' },
        { status: 400 }
      );
    }

    if (productIds.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 products are required for comparison' },
        { status: 400 }
      );
    }

    if (productIds.length > 5) {
      return NextResponse.json(
        { error: 'Cannot compare more than 5 products' },
        { status: 400 }
      );
    }

    const comparison = await comparisonService.compareProducts(productIds);

    return NextResponse.json(comparison);
  } catch (error) {
    console.error('Error comparing products:', error);
    return NextResponse.json(
      { error: 'Failed to compare products' },
      { status: 500 }
    );
  }
}