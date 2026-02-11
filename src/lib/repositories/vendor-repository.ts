import { BaseRepository, QueryFilters, PaginationOptions } from './base-repository';

export interface Vendor {
  id: string;
  userId: string;
  storeName: string;
  storeSlug: string;
  description: string | null;
  logo: string | null;
  banner: string | null;
  stripeAccountId: string | null;
  stripeOnboardingComplete: boolean;
  commissionRate: number;
  status: VendorStatus;
  settings: VendorSettings;
  reputationScore: number;
  totalSales: number;
  totalOrders: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export enum VendorStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  INACTIVE = 'INACTIVE',
}

export interface VendorSettings {
  notifications: {
    orderReceived: boolean;
    lowStock: boolean;
    disputeOpened: boolean;
  };
  autoReorder: boolean;
  minStockThreshold: number;
}

export interface CreateVendorInput {
  userId: string;
  storeName: string;
  storeSlug: string;
  description?: string;
  logo?: string;
  banner?: string;
  commissionRate?: number;
  settings?: Partial<VendorSettings>;
}

export interface UpdateVendorInput {
  storeName?: string;
  storeSlug?: string;
  description?: string;
  logo?: string;
  banner?: string;
  stripeAccountId?: string;
  stripeOnboardingComplete?: boolean;
  commissionRate?: number;
  status?: VendorStatus;
  settings?: Partial<VendorSettings>;
  reputationScore?: number;
  totalSales?: number;
  totalOrders?: number;
  deletedAt?: Date | null;
}

export interface VendorFilters extends QueryFilters {
  status?: VendorStatus;
  userId?: string;
  storeName_contains?: string;
  reputationScore_gte?: number;
  stripeOnboardingComplete?: boolean;
}

export class VendorRepository extends BaseRepository<Vendor, CreateVendorInput, UpdateVendorInput> {
  protected readonly modelName = 'vendor';

  async findByUserId(userId: string): Promise<Vendor | null> {
    return this.model.findFirst({
      where: { userId, deletedAt: null },
    });
  }

  async findBySlug(storeSlug: string): Promise<Vendor | null> {
    return this.model.findFirst({
      where: { storeSlug, deletedAt: null },
    });
  }

  async findByStripeAccountId(stripeAccountId: string): Promise<Vendor | null> {
    return this.model.findFirst({
      where: { stripeAccountId, deletedAt: null },
    });
  }

  async findActiveVendors(options?: PaginationOptions) {
    return this.findMany(
      { status: VendorStatus.ACTIVE, deletedAt: null },
      options
    );
  }

  async findTopVendors(limit: number = 10): Promise<Vendor[]> {
    return this.model.findMany({
      where: { status: VendorStatus.ACTIVE, deletedAt: null },
      orderBy: { reputationScore: 'desc' },
      take: limit,
    });
  }

  async updateReputationScore(vendorId: string, score: number): Promise<Vendor> {
    return this.update(vendorId, { reputationScore: score });
  }

  async incrementSales(vendorId: string, amount: number): Promise<Vendor> {
    return this.model.update({
      where: { id: vendorId },
      data: {
        totalSales: { increment: amount },
        totalOrders: { increment: 1 },
      },
    });
  }

  async updateStripeOnboarding(
    vendorId: string,
    stripeAccountId: string,
    complete: boolean
  ): Promise<Vendor> {
    return this.update(vendorId, {
      stripeAccountId,
      stripeOnboardingComplete: complete,
    });
  }

  async suspend(vendorId: string): Promise<Vendor> {
    return this.update(vendorId, { status: VendorStatus.SUSPENDED });
  }

  async activate(vendorId: string): Promise<Vendor> {
    return this.update(vendorId, { status: VendorStatus.ACTIVE });
  }

  async getVendorStats(vendorId: string): Promise<{
    totalProducts: number;
    activeProducts: number;
    totalOrders: number;
    totalRevenue: number;
    averageRating: number;
  }> {
    const [productStats, orderStats, reviewStats] = await Promise.all([
      this.db.product.aggregate({
        where: { vendorId },
        _count: { id: true },
      }),
      this.db.order.aggregate({
        where: { vendorId },
        _count: { id: true },
        _sum: { total: true },
      }),
      this.db.review.aggregate({
        where: { vendorId },
        _avg: { rating: true },
      }),
    ]);

    const activeProducts = await this.db.product.count({
      where: { vendorId, status: 'ACTIVE' },
    });

    return {
      totalProducts: productStats._count.id,
      activeProducts,
      totalOrders: orderStats._count.id,
      totalRevenue: orderStats._sum.total || 0,
      averageRating: reviewStats._avg.rating || 0,
    };
  }

  protected buildWhereClause(filters: VendorFilters): Record<string, unknown> {
    const baseWhere = super.buildWhereClause(filters);
    
    // Always exclude soft-deleted vendors unless explicitly requested
    if (!('deletedAt' in filters)) {
      baseWhere.deletedAt = null;
    }

    return baseWhere;
  }
}

export const vendorRepository = new VendorRepository();
