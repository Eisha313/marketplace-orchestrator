import { prisma } from '@/lib/db';

export interface ProductAttribute {
  name: string;
  value: string | number | boolean;
  unit?: string;
}

export interface ComparisonProduct {
  id: string;
  name: string;
  vendorId: string;
  vendorName: string;
  vendorRating: number;
  price: number;
  originalPrice?: number;
  attributes: ProductAttribute[];
  imageUrl: string;
  inStock: boolean;
  stockQuantity: number;
  categoryId: string;
}

export interface ComparisonFilter {
  attributeName: string;
  operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'in';
  value: string | number | boolean | (string | number)[];
}

export interface ComparisonResult {
  products: ComparisonProduct[];
  attributeMatrix: AttributeMatrix;
  recommendations: ComparisonRecommendation[];
}

export interface AttributeMatrix {
  attributes: string[];
  values: Record<string, Record<string, string | number | boolean | null>>;
}

export interface ComparisonRecommendation {
  type: 'best-value' | 'highest-rated' | 'lowest-price' | 'best-availability';
  productId: string;
  reason: string;
}

export interface VendorReputation {
  vendorId: string;
  overallScore: number;
  totalReviews: number;
  responseRate: number;
  fulfillmentRate: number;
  averageShippingDays: number;
  disputeRate: number;
}

export class ComparisonService {
  private static readonly MAX_COMPARISON_ITEMS = 5;
  private static readonly REPUTATION_WEIGHTS = {
    reviews: 0.3,
    responseRate: 0.15,
    fulfillmentRate: 0.25,
    shippingSpeed: 0.15,
    disputeRate: 0.15,
  };

  async getComparableProducts(
    categoryId: string,
    filters?: ComparisonFilter[]
  ): Promise<ComparisonProduct[]> {
    const products = await prisma.product.findMany({
      where: {
        categoryId,
        status: 'ACTIVE',
      },
      include: {
        vendor: true,
        inventory: true,
        attributes: true,
        prices: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    let comparableProducts = products.map((product) =>
      this.mapToComparisonProduct(product)
    );

    if (filters && filters.length > 0) {
      comparableProducts = this.applyFilters(comparableProducts, filters);
    }

    return comparableProducts;
  }

  async compareProducts(productIds: string[]): Promise<ComparisonResult> {
    if (productIds.length > ComparisonService.MAX_COMPARISON_ITEMS) {
      throw new Error(
        `Cannot compare more than ${ComparisonService.MAX_COMPARISON_ITEMS} products`
      );
    }

    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
      },
      include: {
        vendor: true,
        inventory: true,
        attributes: true,
        prices: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const comparisonProducts = await Promise.all(
      products.map(async (product) => {
        const baseProduct = this.mapToComparisonProduct(product);
        const reputation = await this.getVendorReputation(product.vendorId);
        return {
          ...baseProduct,
          vendorRating: reputation.overallScore,
        };
      })
    );

    const attributeMatrix = this.buildAttributeMatrix(comparisonProducts);
    const recommendations = this.generateRecommendations(comparisonProducts);

    return {
      products: comparisonProducts,
      attributeMatrix,
      recommendations,
    };
  }

  async getVendorReputation(vendorId: string): Promise<VendorReputation> {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        reviews: true,
        orders: {
          where: {
            createdAt: {
              gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // Last 90 days
            },
          },
        },
        disputes: {
          where: {
            createdAt: {
              gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
            },
          },
        },
      },
    });

    if (!vendor) {
      return {
        vendorId,
        overallScore: 0,
        totalReviews: 0,
        responseRate: 0,
        fulfillmentRate: 0,
        averageShippingDays: 0,
        disputeRate: 0,
      };
    }

    const totalReviews = vendor.reviews?.length || 0;
    const averageRating =
      totalReviews > 0
        ? vendor.reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
        : 0;

    const totalOrders = vendor.orders?.length || 0;
    const fulfilledOrders =
      vendor.orders?.filter((o) => o.status === 'DELIVERED').length || 0;
    const fulfillmentRate = totalOrders > 0 ? fulfilledOrders / totalOrders : 1;

    const respondedOrders =
      vendor.orders?.filter((o) => o.vendorResponseAt).length || 0;
    const responseRate = totalOrders > 0 ? respondedOrders / totalOrders : 1;

    const shippedOrders = vendor.orders?.filter(
      (o) => o.shippedAt && o.deliveredAt
    );
    const averageShippingDays =
      shippedOrders && shippedOrders.length > 0
        ? shippedOrders.reduce((sum, o) => {
            const days =
              (new Date(o.deliveredAt!).getTime() -
                new Date(o.shippedAt!).getTime()) /
              (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / shippedOrders.length
        : 5;

    const disputeRate =
      totalOrders > 0 ? (vendor.disputes?.length || 0) / totalOrders : 0;

    const normalizedRating = averageRating / 5;
    const normalizedShipping = Math.max(0, 1 - averageShippingDays / 14);
    const normalizedDispute = 1 - disputeRate;

    const overallScore =
      normalizedRating * ComparisonService.REPUTATION_WEIGHTS.reviews +
      responseRate * ComparisonService.REPUTATION_WEIGHTS.responseRate +
      fulfillmentRate * ComparisonService.REPUTATION_WEIGHTS.fulfillmentRate +
      normalizedShipping * ComparisonService.REPUTATION_WEIGHTS.shippingSpeed +
      normalizedDispute * ComparisonService.REPUTATION_WEIGHTS.disputeRate;

    return {
      vendorId,
      overallScore: Math.round(overallScore * 100) / 100,
      totalReviews,
      responseRate: Math.round(responseRate * 100) / 100,
      fulfillmentRate: Math.round(fulfillmentRate * 100) / 100,
      averageShippingDays: Math.round(averageShippingDays * 10) / 10,
      disputeRate: Math.round(disputeRate * 1000) / 1000,
    };
  }

  private mapToComparisonProduct(product: any): ComparisonProduct {
    const currentPrice = product.prices?.[0];
    const inventory = product.inventory?.[0];

    return {
      id: product.id,
      name: product.name,
      vendorId: product.vendorId,
      vendorName: product.vendor?.businessName || 'Unknown Vendor',
      vendorRating: 0,
      price: currentPrice?.amount || product.basePrice,
      originalPrice:
        currentPrice?.originalAmount !== currentPrice?.amount
          ? currentPrice?.originalAmount
          : undefined,
      attributes:
        product.attributes?.map((attr: any) => ({
          name: attr.name,
          value: attr.value,
          unit: attr.unit,
        })) || [],
      imageUrl: product.imageUrl || '/placeholder-product.png',
      inStock: (inventory?.quantity || 0) > 0,
      stockQuantity: inventory?.quantity || 0,
      categoryId: product.categoryId,
    };
  }

  private applyFilters(
    products: ComparisonProduct[],
    filters: ComparisonFilter[]
  ): ComparisonProduct[] {
    return products.filter((product) => {
      return filters.every((filter) => {
        const attribute = product.attributes.find(
          (attr) => attr.name.toLowerCase() === filter.attributeName.toLowerCase()
        );

        if (!attribute) return false;

        const attrValue = attribute.value;

        switch (filter.operator) {
          case 'eq':
            return attrValue === filter.value;
          case 'gt':
            return (
              typeof attrValue === 'number' &&
              typeof filter.value === 'number' &&
              attrValue > filter.value
            );
          case 'lt':
            return (
              typeof attrValue === 'number' &&
              typeof filter.value === 'number' &&
              attrValue < filter.value
            );
          case 'gte':
            return (
              typeof attrValue === 'number' &&
              typeof filter.value === 'number' &&
              attrValue >= filter.value
            );
          case 'lte':
            return (
              typeof attrValue === 'number' &&
              typeof filter.value === 'number' &&
              attrValue <= filter.value
            );
          case 'contains':
            return (
              typeof attrValue === 'string' &&
              typeof filter.value === 'string' &&
              attrValue.toLowerCase().includes(filter.value.toLowerCase())
            );
          case 'in':
            return (
              Array.isArray(filter.value) && filter.value.includes(attrValue as any)
            );
          default:
            return false;
        }
      });
    });
  }

  private buildAttributeMatrix(
    products: ComparisonProduct[]
  ): AttributeMatrix {
    const allAttributes = new Set<string>();

    products.forEach((product) => {
      product.attributes.forEach((attr) => {
        allAttributes.add(attr.name);
      });
    });

    const attributes = Array.from(allAttributes).sort();
    const values: Record<string, Record<string, string | number | boolean | null>> =
      {};

    products.forEach((product) => {
      values[product.id] = {};
      attributes.forEach((attrName) => {
        const attr = product.attributes.find((a) => a.name === attrName);
        values[product.id][attrName] = attr
          ? attr.unit
            ? `${attr.value} ${attr.unit}`
            : attr.value
          : null;
      });
    });

    return { attributes, values };
  }

  private generateRecommendations(
    products: ComparisonProduct[]
  ): ComparisonRecommendation[] {
    const recommendations: ComparisonRecommendation[] = [];

    if (products.length === 0) return recommendations;

    // Best value (price to rating ratio)
    const inStockProducts = products.filter((p) => p.inStock);
    if (inStockProducts.length > 0) {
      const bestValue = inStockProducts.reduce((best, product) => {
        const valueScore = product.vendorRating / (product.price || 1);
        const bestScore = best.vendorRating / (best.price || 1);
        return valueScore > bestScore ? product : best;
      });

      recommendations.push({
        type: 'best-value',
        productId: bestValue.id,
        reason: `Best combination of price ($${bestValue.price}) and vendor rating (${bestValue.vendorRating})`,
      });
    }

    // Highest rated vendor
    const highestRated = products.reduce((best, product) =>
      product.vendorRating > best.vendorRating ? product : best
    );
    recommendations.push({
      type: 'highest-rated',
      productId: highestRated.id,
      reason: `Highest vendor reputation score (${highestRated.vendorRating})`,
    });

    // Lowest price
    const lowestPrice = products.reduce((best, product) =>
      product.price < best.price ? product : best
    );
    recommendations.push({
      type: 'lowest-price',
      productId: lowestPrice.id,
      reason: `Lowest price at $${lowestPrice.price}`,
    });

    // Best availability
    const bestAvailability = products.reduce((best, product) =>
      product.stockQuantity > best.stockQuantity ? product : best
    );
    if (bestAvailability.stockQuantity > 0) {
      recommendations.push({
        type: 'best-availability',
        productId: bestAvailability.id,
        reason: `Highest stock availability (${bestAvailability.stockQuantity} units)`,
      });
    }

    return recommendations;
  }
}

export const comparisonService = new ComparisonService();