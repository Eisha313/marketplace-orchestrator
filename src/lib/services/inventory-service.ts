import { db } from '../db';
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
  warehouseLocation?: string;
  lastSyncedAt: Date;
  version: number;
}

export interface StockAlert {
  id: string;
  inventoryId: string;
  type: 'LOW_STOCK' | 'OUT_OF_STOCK' | 'REORDER_TRIGGERED';
  message: string;
  acknowledged: boolean;
  createdAt: Date;
}

export interface SyncResult {
  success: boolean;
  itemsProcessed: number;
  errors: SyncError[];
  timestamp: Date;
}

export interface SyncError {
  inventoryId: string;
  error: string;
  retryable: boolean;
}

class InventoryServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'InventoryServiceError';
  }
}

const inventoryEvents = new EventEmitter();

// Lock management for preventing race conditions
const activeLocks = new Map<string, { timestamp: number; promise: Promise<void> }>();
const LOCK_TIMEOUT_MS = 30000; // 30 seconds

async function acquireLock(key: string): Promise<() => void> {
  const existingLock = activeLocks.get(key);
  
  if (existingLock) {
    // Check if lock is stale
    if (Date.now() - existingLock.timestamp > LOCK_TIMEOUT_MS) {
      activeLocks.delete(key);
    } else {
      // Wait for existing lock to release
      await existingLock.promise;
    }
  }
  
  let releaseFn: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  
  activeLocks.set(key, { timestamp: Date.now(), promise: lockPromise });
  
  return () => {
    activeLocks.delete(key);
    releaseFn!();
  };
}

export async function getInventoryByVendor(vendorId: string): Promise<InventoryItem[]> {
  try {
    const inventory = await db.inventory.findMany({
      where: { vendorId },
      include: {
        product: true,
      },
    });

    return inventory.map(item => ({
      id: item.id,
      productId: item.productId,
      vendorId: item.vendorId,
      sku: item.sku,
      quantity: item.quantity,
      reservedQuantity: item.reservedQuantity,
      lowStockThreshold: item.lowStockThreshold,
      reorderPoint: item.reorderPoint,
      reorderQuantity: item.reorderQuantity,
      warehouseLocation: item.warehouseLocation ?? undefined,
      lastSyncedAt: item.lastSyncedAt,
      version: item.version,
    }));
  } catch (error) {
    throw new InventoryServiceError(
      `Failed to fetch inventory for vendor ${vendorId}`,
      'FETCH_FAILED',
      true
    );
  }
}

export async function updateInventoryQuantity(
  inventoryId: string,
  quantityChange: number,
  expectedVersion?: number
): Promise<InventoryItem> {
  const lockKey = `inventory:${inventoryId}`;
  const releaseLock = await acquireLock(lockKey);
  
  try {
    // Use optimistic locking to prevent race conditions
    const currentItem = await db.inventory.findUnique({
      where: { id: inventoryId },
    });

    if (!currentItem) {
      throw new InventoryServiceError(
        `Inventory item ${inventoryId} not found`,
        'NOT_FOUND',
        false
      );
    }

    // Check version for optimistic locking
    if (expectedVersion !== undefined && currentItem.version !== expectedVersion) {
      throw new InventoryServiceError(
        `Version conflict for inventory ${inventoryId}. Expected ${expectedVersion}, got ${currentItem.version}`,
        'VERSION_CONFLICT',
        true
      );
    }

    const newQuantity = currentItem.quantity + quantityChange;

    if (newQuantity < 0) {
      throw new InventoryServiceError(
        `Insufficient stock. Available: ${currentItem.quantity}, Requested: ${Math.abs(quantityChange)}`,
        'INSUFFICIENT_STOCK',
        false
      );
    }

    const updated = await db.inventory.update({
      where: { 
        id: inventoryId,
        version: currentItem.version, // Ensure version hasn't changed
      },
      data: {
        quantity: newQuantity,
        lastSyncedAt: new Date(),
        version: { increment: 1 },
      },
    });

    // Check for low stock and trigger alerts
    if (newQuantity <= updated.lowStockThreshold) {
      await createStockAlert(inventoryId, newQuantity === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK');
    }

    // Check if reorder should be triggered
    if (newQuantity <= updated.reorderPoint) {
      await triggerReorder(updated);
    }

    inventoryEvents.emit('inventoryUpdated', {
      inventoryId,
      vendorId: updated.vendorId,
      previousQuantity: currentItem.quantity,
      newQuantity,
      timestamp: new Date(),
    });

    return {
      id: updated.id,
      productId: updated.productId,
      vendorId: updated.vendorId,
      sku: updated.sku,
      quantity: updated.quantity,
      reservedQuantity: updated.reservedQuantity,
      lowStockThreshold: updated.lowStockThreshold,
      reorderPoint: updated.reorderPoint,
      reorderQuantity: updated.reorderQuantity,
      warehouseLocation: updated.warehouseLocation ?? undefined,
      lastSyncedAt: updated.lastSyncedAt,
      version: updated.version,
    };
  } finally {
    releaseLock();
  }
}

export async function reserveInventory(
  inventoryId: string,
  quantity: number
): Promise<{ success: boolean; reservationId: string }> {
  const lockKey = `inventory:${inventoryId}`;
  const releaseLock = await acquireLock(lockKey);
  
  try {
    const item = await db.inventory.findUnique({
      where: { id: inventoryId },
    });

    if (!item) {
      throw new InventoryServiceError(
        `Inventory item ${inventoryId} not found`,
        'NOT_FOUND',
        false
      );
    }

    const availableQuantity = item.quantity - item.reservedQuantity;

    if (availableQuantity < quantity) {
      throw new InventoryServiceError(
        `Insufficient available stock. Available: ${availableQuantity}, Requested: ${quantity}`,
        'INSUFFICIENT_STOCK',
        false
      );
    }

    const reservation = await db.$transaction(async (tx) => {
      await tx.inventory.update({
        where: { id: inventoryId },
        data: {
          reservedQuantity: { increment: quantity },
          version: { increment: 1 },
        },
      });

      return tx.inventoryReservation.create({
        data: {
          inventoryId,
          quantity,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        },
      });
    });

    return {
      success: true,
      reservationId: reservation.id,
    };
  } finally {
    releaseLock();
  }
}

export async function releaseReservation(reservationId: string): Promise<void> {
  const reservation = await db.inventoryReservation.findUnique({
    where: { id: reservationId },
  });

  if (!reservation) {
    throw new InventoryServiceError(
      `Reservation ${reservationId} not found`,
      'NOT_FOUND',
      false
    );
  }

  const lockKey = `inventory:${reservation.inventoryId}`;
  const releaseLock = await acquireLock(lockKey);

  try {
    await db.$transaction(async (tx) => {
      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: {
          reservedQuantity: { decrement: reservation.quantity },
          version: { increment: 1 },
        },
      });

      await tx.inventoryReservation.update({
        where: { id: reservationId },
        data: { status: 'RELEASED' },
      });
    });
  } finally {
    releaseLock();
  }
}

async function createStockAlert(
  inventoryId: string,
  type: 'LOW_STOCK' | 'OUT_OF_STOCK' | 'REORDER_TRIGGERED'
): Promise<void> {
  const item = await db.inventory.findUnique({
    where: { id: inventoryId },
    include: { product: true },
  });

  if (!item) return;

  const messages = {
    LOW_STOCK: `Low stock alert: ${item.product.name} (SKU: ${item.sku}) has only ${item.quantity} units remaining`,
    OUT_OF_STOCK: `Out of stock: ${item.product.name} (SKU: ${item.sku}) is now out of stock`,
    REORDER_TRIGGERED: `Reorder triggered: ${item.product.name} (SKU: ${item.sku}) - ordering ${item.reorderQuantity} units`,
  };

  await db.stockAlert.create({
    data: {
      inventoryId,
      vendorId: item.vendorId,
      type,
      message: messages[type],
      acknowledged: false,
    },
  });

  inventoryEvents.emit('stockAlert', {
    inventoryId,
    vendorId: item.vendorId,
    type,
    message: messages[type],
    timestamp: new Date(),
  });
}

async function triggerReorder(item: any): Promise<void> {
  // Check if there's already a pending reorder
  const existingReorder = await db.reorderRequest.findFirst({
    where: {
      inventoryId: item.id,
      status: 'PENDING',
    },
  });

  if (existingReorder) return;

  await db.reorderRequest.create({
    data: {
      inventoryId: item.id,
      vendorId: item.vendorId,
      quantity: item.reorderQuantity,
      status: 'PENDING',
    },
  });

  await createStockAlert(item.id, 'REORDER_TRIGGERED');
}

export async function syncVendorInventory(vendorId: string): Promise<SyncResult> {
  const errors: SyncError[] = [];
  let itemsProcessed = 0;

  try {
    const inventoryItems = await db.inventory.findMany({
      where: { vendorId },
    });

    for (const item of inventoryItems) {
      try {
        await db.inventory.update({
          where: { id: item.id },
          data: {
            lastSyncedAt: new Date(),
          },
        });
        itemsProcessed++;
      } catch (error) {
        errors.push({
          inventoryId: item.id,
          error: error instanceof Error ? error.message : 'Unknown error',
          retryable: true,
        });
      }
    }

    return {
      success: errors.length === 0,
      itemsProcessed,
      errors,
      timestamp: new Date(),
    };
  } catch (error) {
    throw new InventoryServiceError(
      `Failed to sync inventory for vendor ${vendorId}`,
      'SYNC_FAILED',
      true
    );
  }
}

export function onInventoryUpdate(
  callback: (event: any) => void
): () => void {
  inventoryEvents.on('inventoryUpdated', callback);
  return () => inventoryEvents.off('inventoryUpdated', callback);
}

export function onStockAlert(
  callback: (event: any) => void
): () => void {
  inventoryEvents.on('stockAlert', callback);
  return () => inventoryEvents.off('stockAlert', callback);
}
