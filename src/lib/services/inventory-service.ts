import { prisma } from '@/lib/db';
import { ServiceError } from '@/lib/utils/service-errors';
import { inventoryRetry } from '@/lib/utils/retry';

export interface InventoryItem {
  id: string;
  productId: string;
  vendorId: string;
  quantity: number;
  reservedQuantity: number;
  lowStockThreshold: number;
  reorderPoint: number;
  reorderQuantity: number;
  lastSyncedAt: Date;
}

export interface InventoryUpdate {
  productId: string;
  quantity?: number;
  reservedQuantity?: number;
  lowStockThreshold?: number;
  reorderPoint?: number;
  reorderQuantity?: number;
}

export interface LowStockAlert {
  productId: string;
  vendorId: string;
  productName: string;
  currentQuantity: number;
  threshold: number;
  reorderRecommended: boolean;
}

export interface SyncResult {
  success: boolean;
  itemsSynced: number;
  errors: string[];
  timestamp: Date;
}

class InventoryService {
  async getVendorInventory(vendorId: string): Promise<InventoryItem[]> {
    const inventory = await prisma.inventory.findMany({
      where: { vendorId },
      include: {
        product: {
          select: { name: true, sku: true },
        },
      },
    });

    return inventory.map((item) => ({
      id: item.id,
      productId: item.productId,
      vendorId: item.vendorId,
      quantity: item.quantity,
      reservedQuantity: item.reservedQuantity,
      lowStockThreshold: item.lowStockThreshold,
      reorderPoint: item.reorderPoint,
      reorderQuantity: item.reorderQuantity,
      lastSyncedAt: item.lastSyncedAt,
    }));
  }

  async updateInventory(
    vendorId: string,
    updates: InventoryUpdate[]
  ): Promise<InventoryItem[]> {
    return inventoryRetry(async () => {
      const results = await prisma.$transaction(async (tx) => {
        const updatedItems: InventoryItem[] = [];

        for (const update of updates) {
          const existing = await tx.inventory.findFirst({
            where: {
              vendorId,
              productId: update.productId,
            },
          });

          if (!existing) {
            throw new ServiceError(
              `Inventory item not found for product ${update.productId}`,
              'NOT_FOUND'
            );
          }

          const updated = await tx.inventory.update({
            where: { id: existing.id },
            data: {
              ...(update.quantity !== undefined && { quantity: update.quantity }),
              ...(update.reservedQuantity !== undefined && {
                reservedQuantity: update.reservedQuantity,
              }),
              ...(update.lowStockThreshold !== undefined && {
                lowStockThreshold: update.lowStockThreshold,
              }),
              ...(update.reorderPoint !== undefined && {
                reorderPoint: update.reorderPoint,
              }),
              ...(update.reorderQuantity !== undefined && {
                reorderQuantity: update.reorderQuantity,
              }),
              lastSyncedAt: new Date(),
            },
          });

          updatedItems.push({
            id: updated.id,
            productId: updated.productId,
            vendorId: updated.vendorId,
            quantity: updated.quantity,
            reservedQuantity: updated.reservedQuantity,
            lowStockThreshold: updated.lowStockThreshold,
            reorderPoint: updated.reorderPoint,
            reorderQuantity: updated.reorderQuantity,
            lastSyncedAt: updated.lastSyncedAt,
          });
        }

        return updatedItems;
      });

      // Check for low stock alerts after update
      await this.checkAndCreateAlerts(vendorId, results);

      return results;
    });
  }

  async reserveInventory(
    vendorId: string,
    productId: string,
    quantity: number
  ): Promise<boolean> {
    return inventoryRetry(async () => {
      const result = await prisma.$transaction(async (tx) => {
        const inventory = await tx.inventory.findFirst({
          where: { vendorId, productId },
        });

        if (!inventory) {
          throw new ServiceError('Inventory item not found', 'NOT_FOUND');
        }

        const availableQuantity = inventory.quantity - inventory.reservedQuantity;

        if (availableQuantity < quantity) {
          throw new ServiceError(
            `Insufficient inventory. Available: ${availableQuantity}, Requested: ${quantity}`,
            'INSUFFICIENT_INVENTORY'
          );
        }

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            reservedQuantity: inventory.reservedQuantity + quantity,
            lastSyncedAt: new Date(),
          },
        });

        return true;
      });

      return result;
    });
  }

  async releaseReservation(
    vendorId: string,
    productId: string,
    quantity: number
  ): Promise<boolean> {
    return inventoryRetry(async () => {
      const result = await prisma.$transaction(async (tx) => {
        const inventory = await tx.inventory.findFirst({
          where: { vendorId, productId },
        });

        if (!inventory) {
          throw new ServiceError('Inventory item not found', 'NOT_FOUND');
        }

        const newReservedQuantity = Math.max(
          0,
          inventory.reservedQuantity - quantity
        );

        await tx.inventory.update({
          where: { id: inventory.id },
          data: {
            reservedQuantity: newReservedQuantity,
            lastSyncedAt: new Date(),
          },
        });

        return true;
      });

      return result;
    });
  }

  async getLowStockAlerts(vendorId?: string): Promise<LowStockAlert[]> {
    const whereClause = vendorId ? { vendorId } : {};

    const lowStockItems = await prisma.inventory.findMany({
      where: {
        ...whereClause,
        quantity: {
          lte: prisma.inventory.fields.lowStockThreshold,
        },
      },
      include: {
        product: {
          select: { name: true },
        },
      },
    });

    // Fallback query if the above doesn't work with field comparison
    const allInventory = await prisma.inventory.findMany({
      where: whereClause,
      include: {
        product: {
          select: { name: true },
        },
      },
    });

    return allInventory
      .filter((item) => item.quantity <= item.lowStockThreshold)
      .map((item) => ({
        productId: item.productId,
        vendorId: item.vendorId,
        productName: item.product.name,
        currentQuantity: item.quantity,
        threshold: item.lowStockThreshold,
        reorderRecommended: item.quantity <= item.reorderPoint,
      }));
  }

  async syncInventory(vendorId: string): Promise<SyncResult> {
    const errors: string[] = [];
    let itemsSynced = 0;

    try {
      const inventory = await this.getVendorInventory(vendorId);

      for (const item of inventory) {
        try {
          await inventoryRetry(async () => {
            await prisma.inventory.update({
              where: { id: item.id },
              data: { lastSyncedAt: new Date() },
            });
          });
          itemsSynced++;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Failed to sync item ${item.productId}: ${message}`);
        }
      }

      return {
        success: errors.length === 0,
        itemsSynced,
        errors,
        timestamp: new Date(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        itemsSynced,
        errors: [...errors, `Sync failed: ${message}`],
        timestamp: new Date(),
      };
    }
  }

  private async checkAndCreateAlerts(
    vendorId: string,
    items: InventoryItem[]
  ): Promise<void> {
    for (const item of items) {
      if (item.quantity <= item.lowStockThreshold) {
        await prisma.inventoryAlert.upsert({
          where: {
            vendorId_productId: {
              vendorId: item.vendorId,
              productId: item.productId,
            },
          },
          create: {
            vendorId: item.vendorId,
            productId: item.productId,
            alertType: item.quantity <= item.reorderPoint ? 'REORDER' : 'LOW_STOCK',
            currentQuantity: item.quantity,
            threshold: item.lowStockThreshold,
            acknowledged: false,
          },
          update: {
            alertType: item.quantity <= item.reorderPoint ? 'REORDER' : 'LOW_STOCK',
            currentQuantity: item.quantity,
            acknowledged: false,
            updatedAt: new Date(),
          },
        });
      }
    }
  }
}

export const inventoryService = new InventoryService();
