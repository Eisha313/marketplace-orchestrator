import { prisma } from '@/lib/db';
import { EventEmitter } from 'events';

export interface InventoryItem {
  id: string;
  productId: string;
  vendorId: string;
  sku: string;
  quantity: number;
  reservedQuantity: number;
  lowStockThreshold: number;
  reorderPoint: number;
  reorderQuantity: number;
  lastSyncedAt: Date;
  warehouseLocation?: string;
}

export interface InventoryUpdate {
  productId: string;
  vendorId: string;
  quantityChange: number;
  reason: 'sale' | 'restock' | 'adjustment' | 'return' | 'reservation';
  referenceId?: string;
}

export interface LowStockAlert {
  productId: string;
  vendorId: string;
  currentQuantity: number;
  threshold: number;
  sku: string;
  productName: string;
}

class InventoryEventEmitter extends EventEmitter {
  emitLowStock(alert: LowStockAlert) {
    this.emit('lowStock', alert);
  }

  emitInventoryUpdate(update: InventoryItem) {
    this.emit('inventoryUpdate', update);
  }

  emitReorderTriggered(item: InventoryItem) {
    this.emit('reorderTriggered', item);
  }
}

export const inventoryEvents = new InventoryEventEmitter();

export class InventoryService {
  private syncInProgress: Map<string, boolean> = new Map();

  async getInventory(productId: string, vendorId: string): Promise<InventoryItem | null> {
    const inventory = await prisma.inventory.findUnique({
      where: {
        productId_vendorId: {
          productId,
          vendorId,
        },
      },
    });

    return inventory;
  }

  async getVendorInventory(vendorId: string): Promise<InventoryItem[]> {
    const inventory = await prisma.inventory.findMany({
      where: { vendorId },
      include: {
        product: {
          select: {
            name: true,
            category: true,
          },
        },
      },
    });

    return inventory;
  }

  async getAvailableQuantity(productId: string, vendorId: string): Promise<number> {
    const inventory = await this.getInventory(productId, vendorId);
    if (!inventory) return 0;
    return Math.max(0, inventory.quantity - inventory.reservedQuantity);
  }

  async updateInventory(update: InventoryUpdate): Promise<InventoryItem> {
    const { productId, vendorId, quantityChange, reason, referenceId } = update;

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.inventory.findUnique({
        where: {
          productId_vendorId: { productId, vendorId },
        },
      });

      if (!current) {
        throw new Error(`Inventory not found for product ${productId} and vendor ${vendorId}`);
      }

      const newQuantity = current.quantity + quantityChange;
      if (newQuantity < 0) {
        throw new Error('Insufficient inventory');
      }

      const updated = await tx.inventory.update({
        where: {
          productId_vendorId: { productId, vendorId },
        },
        data: {
          quantity: newQuantity,
          lastSyncedAt: new Date(),
        },
      });

      await tx.inventoryLog.create({
        data: {
          inventoryId: updated.id,
          previousQuantity: current.quantity,
          newQuantity,
          quantityChange,
          reason,
          referenceId,
        },
      });

      return updated;
    });

    inventoryEvents.emitInventoryUpdate(result);

    if (result.quantity <= result.lowStockThreshold) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { name: true },
      });

      inventoryEvents.emitLowStock({
        productId,
        vendorId,
        currentQuantity: result.quantity,
        threshold: result.lowStockThreshold,
        sku: result.sku,
        productName: product?.name || 'Unknown',
      });
    }

    if (result.quantity <= result.reorderPoint) {
      await this.triggerReorder(result);
    }

    return result;
  }

  async reserveInventory(
    productId: string,
    vendorId: string,
    quantity: number,
    orderId: string
  ): Promise<boolean> {
    const available = await this.getAvailableQuantity(productId, vendorId);
    if (available < quantity) {
      return false;
    }

    await prisma.$transaction(async (tx) => {
      await tx.inventory.update({
        where: {
          productId_vendorId: { productId, vendorId },
        },
        data: {
          reservedQuantity: { increment: quantity },
        },
      });

      await tx.inventoryReservation.create({
        data: {
          productId,
          vendorId,
          orderId,
          quantity,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
        },
      });
    });

    return true;
  }

  async releaseReservation(orderId: string): Promise<void> {
    const reservations = await prisma.inventoryReservation.findMany({
      where: { orderId, status: 'active' },
    });

    await prisma.$transaction(async (tx) => {
      for (const reservation of reservations) {
        await tx.inventory.update({
          where: {
            productId_vendorId: {
              productId: reservation.productId,
              vendorId: reservation.vendorId,
            },
          },
          data: {
            reservedQuantity: { decrement: reservation.quantity },
          },
        });

        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: { status: 'released' },
        });
      }
    });
  }

  async confirmReservation(orderId: string): Promise<void> {
    const reservations = await prisma.inventoryReservation.findMany({
      where: { orderId, status: 'active' },
    });

    await prisma.$transaction(async (tx) => {
      for (const reservation of reservations) {
        await tx.inventory.update({
          where: {
            productId_vendorId: {
              productId: reservation.productId,
              vendorId: reservation.vendorId,
            },
          },
          data: {
            quantity: { decrement: reservation.quantity },
            reservedQuantity: { decrement: reservation.quantity },
          },
        });

        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: { status: 'confirmed' },
        });

        await tx.inventoryLog.create({
          data: {
            inventoryId: reservation.id,
            previousQuantity: 0,
            newQuantity: 0,
            quantityChange: -reservation.quantity,
            reason: 'sale',
            referenceId: orderId,
          },
        });
      }
    });
  }

  async syncVendorInventory(vendorId: string, externalInventory: InventoryItem[]): Promise<void> {
    const syncKey = `sync_${vendorId}`;
    if (this.syncInProgress.get(syncKey)) {
      throw new Error('Sync already in progress for this vendor');
    }

    this.syncInProgress.set(syncKey, true);

    try {
      for (const item of externalInventory) {
        await prisma.inventory.upsert({
          where: {
            productId_vendorId: {
              productId: item.productId,
              vendorId: item.vendorId,
            },
          },
          update: {
            quantity: item.quantity,
            lastSyncedAt: new Date(),
          },
          create: {
            ...item,
            lastSyncedAt: new Date(),
          },
        });
      }
    } finally {
      this.syncInProgress.set(syncKey, false);
    }
  }

  async getLowStockItems(vendorId?: string): Promise<LowStockAlert[]> {
    const where: any = {};
    if (vendorId) {
      where.vendorId = vendorId;
    }

    const items = await prisma.inventory.findMany({
      where: {
        ...where,
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

    return items.map((item) => ({
      productId: item.productId,
      vendorId: item.vendorId,
      currentQuantity: item.quantity,
      threshold: item.lowStockThreshold,
      sku: item.sku,
      productName: item.product?.name || 'Unknown',
    }));
  }

  private async triggerReorder(item: InventoryItem): Promise<void> {
    const existingReorder = await prisma.reorderRequest.findFirst({
      where: {
        inventoryId: item.id,
        status: 'pending',
      },
    });

    if (existingReorder) {
      return;
    }

    await prisma.reorderRequest.create({
      data: {
        inventoryId: item.id,
        vendorId: item.vendorId,
        quantity: item.reorderQuantity,
        status: 'pending',
      },
    });

    inventoryEvents.emitReorderTriggered(item);
  }

  async cleanupExpiredReservations(): Promise<number> {
    const expired = await prisma.inventoryReservation.findMany({
      where: {
        status: 'active',
        expiresAt: { lt: new Date() },
      },
    });

    for (const reservation of expired) {
      await this.releaseReservation(reservation.orderId);
    }

    return expired.length;
  }
}

export const inventoryService = new InventoryService();