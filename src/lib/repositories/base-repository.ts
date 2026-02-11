import { prisma } from '@/lib/db';
import { ServiceError, ErrorCode } from '@/lib/utils/service-errors';

export interface PaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface QueryFilters {
  [key: string]: unknown;
}

export abstract class BaseRepository<T, CreateInput, UpdateInput> {
  protected abstract readonly modelName: string;
  protected readonly db = prisma;

  protected get model(): any {
    return (this.db as any)[this.modelName];
  }

  async findById(id: string): Promise<T | null> {
    try {
      return await this.model.findUnique({
        where: { id },
      });
    } catch (error) {
      this.handleError(error, 'findById');
    }
  }

  async findByIdOrThrow(id: string): Promise<T> {
    const result = await this.findById(id);
    if (!result) {
      throw new ServiceError(
        ErrorCode.NOT_FOUND,
        `${this.modelName} with id ${id} not found`
      );
    }
    return result;
  }

  async findMany(
    filters: QueryFilters = {},
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<T>> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = options;

    const skip = (page - 1) * limit;
    const where = this.buildWhereClause(filters);

    try {
      const [data, total] = await Promise.all([
        this.model.findMany({
          where,
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
        }),
        this.model.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      this.handleError(error, 'findMany');
    }
  }

  async findAll(filters: QueryFilters = {}): Promise<T[]> {
    const where = this.buildWhereClause(filters);

    try {
      return await this.model.findMany({ where });
    } catch (error) {
      this.handleError(error, 'findAll');
    }
  }

  async create(data: CreateInput): Promise<T> {
    try {
      return await this.model.create({ data });
    } catch (error) {
      this.handleError(error, 'create');
    }
  }

  async createMany(data: CreateInput[]): Promise<{ count: number }> {
    try {
      return await this.model.createMany({ data });
    } catch (error) {
      this.handleError(error, 'createMany');
    }
  }

  async update(id: string, data: UpdateInput): Promise<T> {
    await this.findByIdOrThrow(id);

    try {
      return await this.model.update({
        where: { id },
        data,
      });
    } catch (error) {
      this.handleError(error, 'update');
    }
  }

  async delete(id: string): Promise<T> {
    await this.findByIdOrThrow(id);

    try {
      return await this.model.delete({
        where: { id },
      });
    } catch (error) {
      this.handleError(error, 'delete');
    }
  }

  async softDelete(id: string): Promise<T> {
    return this.update(id, { deletedAt: new Date() } as unknown as UpdateInput);
  }

  async count(filters: QueryFilters = {}): Promise<number> {
    const where = this.buildWhereClause(filters);

    try {
      return await this.model.count({ where });
    } catch (error) {
      this.handleError(error, 'count');
    }
  }

  async exists(id: string): Promise<boolean> {
    const result = await this.findById(id);
    return result !== null;
  }

  async existsWhere(filters: QueryFilters): Promise<boolean> {
    const count = await this.count(filters);
    return count > 0;
  }

  async transaction<R>(fn: (tx: typeof prisma) => Promise<R>): Promise<R> {
    return this.db.$transaction(fn);
  }

  protected buildWhereClause(filters: QueryFilters): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;

      if (key.endsWith('_contains')) {
        const field = key.replace('_contains', '');
        where[field] = { contains: value, mode: 'insensitive' };
      } else if (key.endsWith('_gte')) {
        const field = key.replace('_gte', '');
        where[field] = { ...(where[field] as object || {}), gte: value };
      } else if (key.endsWith('_lte')) {
        const field = key.replace('_lte', '');
        where[field] = { ...(where[field] as object || {}), lte: value };
      } else if (key.endsWith('_in')) {
        const field = key.replace('_in', '');
        where[field] = { in: value };
      } else if (key.endsWith('_not')) {
        const field = key.replace('_not', '');
        where[field] = { not: value };
      } else {
        where[key] = value;
      }
    }

    return where;
  }

  protected handleError(error: unknown, operation: string): never {
    console.error(`Repository error in ${this.modelName}.${operation}:`, error);

    if (error instanceof ServiceError) {
      throw error;
    }

    const prismaError = error as { code?: string; meta?: { target?: string[] } };

    if (prismaError.code === 'P2002') {
      const fields = prismaError.meta?.target?.join(', ') || 'field';
      throw new ServiceError(
        ErrorCode.CONFLICT,
        `A record with this ${fields} already exists`
      );
    }

    if (prismaError.code === 'P2025') {
      throw new ServiceError(
        ErrorCode.NOT_FOUND,
        `${this.modelName} not found`
      );
    }

    throw new ServiceError(
      ErrorCode.INTERNAL_ERROR,
      `Database operation failed: ${operation}`
    );
  }
}

export type { BaseRepository };
