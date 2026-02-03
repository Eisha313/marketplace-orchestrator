import { z } from 'zod';

// Common validation schemas
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const dateRangeSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return data.startDate <= data.endDate;
    }
    return true;
  },
  { message: 'Start date must be before or equal to end date' }
);

export const uuidSchema = z.string().uuid('Invalid UUID format');

export const emailSchema = z.string().email('Invalid email format').toLowerCase();

export const phoneSchema = z.string().regex(
  /^\+?[1-9]\d{1,14}$/,
  'Invalid phone number format'
);

export const currencyAmountSchema = z.number()
  .positive('Amount must be positive')
  .multipleOf(0.01, 'Amount must have at most 2 decimal places');

export const percentageSchema = z.number()
  .min(0, 'Percentage must be at least 0')
  .max(100, 'Percentage must be at most 100');

// Vendor-specific schemas
export const vendorIdSchema = z.object({
  vendorId: uuidSchema,
});

export const productIdSchema = z.object({
  productId: uuidSchema,
});

export const disputeIdSchema = z.object({
  disputeId: uuidSchema,
});

// Common input schemas
export const searchQuerySchema = z.object({
  query: z.string().min(1).max(200),
  ...paginationSchema.shape,
});

export const inventoryUpdateSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().min(0),
  operation: z.enum(['set', 'increment', 'decrement']).default('set'),
  reason: z.string().max(500).optional(),
});

export const priceUpdateSchema = z.object({
  productId: uuidSchema,
  basePrice: currencyAmountSchema,
  minPrice: currencyAmountSchema.optional(),
  maxPrice: currencyAmountSchema.optional(),
}).refine(
  (data) => {
    if (data.minPrice && data.maxPrice) {
      return data.minPrice <= data.maxPrice;
    }
    if (data.minPrice && data.basePrice < data.minPrice) {
      return false;
    }
    if (data.maxPrice && data.basePrice > data.maxPrice) {
      return false;
    }
    return true;
  },
  { message: 'Price constraints are invalid' }
);

// Validation helper functions
export function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: z.ZodIssue[] } {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  return { success: false, errors: result.error.issues };
}

export function formatValidationErrors(errors: z.ZodIssue[]): string[] {
  return errors.map((error) => {
    const path = error.path.join('.');
    return path ? `${path}: ${error.message}` : error.message;
  });
}

export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '')
    .slice(0, 10000);
}

export function normalizeSearchQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

// Type exports
export type PaginationParams = z.infer<typeof paginationSchema>;
export type DateRangeParams = z.infer<typeof dateRangeSchema>;
export type SearchQueryParams = z.infer<typeof searchQuerySchema>;
export type InventoryUpdateInput = z.infer<typeof inventoryUpdateSchema>;
export type PriceUpdateInput = z.infer<typeof priceUpdateSchema>;
