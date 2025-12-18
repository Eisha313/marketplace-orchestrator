import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

export interface VendorStats {
  totalRevenue: number;
  totalOrders: number;
  totalProducts: number;
  averageRating: number;
  pendingPayouts: number;
}

export interface VendorDashboardData {
  vendor: {
    id: string;
    name: string;
    slug: string;
    status: string;
    commissionRate: number;
    createdAt: Date;
  };
  stats: VendorStats;
  recentOrders: any[];
  topProducts: any[];
}

export class VendorService {
  async createVendor(data: {
    userId: string;
    name: string;
    slug: string;
    description?: string;
    commissionRate?: number;
  }) {
    const existingVendor = await prisma.vendor.findUnique({
      where: { slug: data.slug },
    });

    if (existingVendor) {
      throw new Error('Vendor with this slug already exists');
    }

    return prisma.vendor.create({
      data: {
        userId: data.userId,
        name: data.name,
        slug: data.slug,
        description: data.description,
        commissionRate: data.commissionRate ?? 0.10,
        status: 'pending',
      },
    });
  }

  async getVendorBySlug(slug: string) {
    return prisma.vendor.findUnique({
      where: { slug },
      include: {
        products: {
          where: { status: 'active' },
          take: 20,
        },
      },
    });
  }

  async getVendorById(id: string) {
    return prisma.vendor.findUnique({
      where: { id },
    });
  }

  async getVendorDashboardData(vendorId: string): Promise<VendorDashboardData | null> {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
    });

    if (!vendor) return null;

    const [totalRevenue, totalOrders, totalProducts, pendingPayouts, recentOrders, topProducts] =
      await Promise.all([
        this.calculateTotalRevenue(vendorId),
        this.countTotalOrders(vendorId),
        prisma.product.count({ where: { vendorId } }),
        this.calculatePendingPayouts(vendorId),
        this.getRecentOrders(vendorId, 10),
        this.getTopProducts(vendorId, 5),
      ]);

    const averageRating = await this.calculateAverageRating(vendorId);

    return {
      vendor: {
        id: vendor.id,
        name: vendor.name,
        slug: vendor.slug,
        status: vendor.status,
        commissionRate: vendor.commissionRate.toNumber(),
        createdAt: vendor.createdAt,
      },
      stats: {
        totalRevenue,
        totalOrders,
        totalProducts,
        averageRating,
        pendingPayouts,
      },
      recentOrders,
      topProducts,
    };
  }

  async calculateTotalRevenue(vendorId: string): Promise<number> {
    const result = await prisma.orderItem.aggregate({
      where: {
        product: { vendorId },
        order: { status: 'completed' },
      },
      _sum: {
        totalPrice: true,
      },
    });

    return result._sum.totalPrice?.toNumber() ?? 0;
  }

  async countTotalOrders(vendorId: string): Promise<number> {
    const orderItems = await prisma.orderItem.findMany({
      where: {
        product: { vendorId },
      },
      select: {
        orderId: true,
      },
      distinct: ['orderId'],
    });

    return orderItems.length;
  }

  async calculatePendingPayouts(vendorId: string): Promise<number> {
    const result = await prisma.payout.aggregate({
      where: {
        vendorId,
        status: 'pending',
      },
      _sum: {
        amount: true,
      },
    });

    return result._sum.amount?.toNumber() ?? 0;
  }

  async calculateAverageRating(vendorId: string): Promise<number> {
    const result = await prisma.review.aggregate({
      where: {
        product: { vendorId },
      },
      _avg: {
        rating: true,
      },
    });

    return result._avg.rating ?? 0;
  }

  async getRecentOrders(vendorId: string, limit: number) {
    return prisma.order.findMany({
      where: {
        items: {
          some: {
            product: { vendorId },
          },
        },
      },
      include: {
        items: {
          where: {
            product: { vendorId },
          },
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getTopProducts(vendorId: string, limit: number) {
    return prisma.product.findMany({
      where: { vendorId },
      orderBy: {
        orderItems: {
          _count: 'desc',
        },
      },
      take: limit,
    });
  }

  async updateVendorSettings(
    vendorId: string,
    settings: {
      name?: string;
      description?: string;
      logo?: string;
      banner?: string;
      settings?: Prisma.JsonValue;
    }
  ) {
    return prisma.vendor.update({
      where: { id: vendorId },
      data: settings,
    });
  }

  async listVendors(options: {
    status?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { status, page = 1, limit = 20, search } = options;

    const where: Prisma.VendorWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [vendors, total] = await Promise.all([
      prisma.vendor.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.vendor.count({ where }),
    ]);

    return {
      vendors,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async approveVendor(vendorId: string) {
    return prisma.vendor.update({
      where: { id: vendorId },
      data: { status: 'active' },
    });
  }

  async suspendVendor(vendorId: string, reason: string) {
    return prisma.vendor.update({
      where: { id: vendorId },
      data: {
        status: 'suspended',
        settings: {
          suspensionReason: reason,
          suspendedAt: new Date().toISOString(),
        },
      },
    });
  }
}

export const vendorService = new VendorService();