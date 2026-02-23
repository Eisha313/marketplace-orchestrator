import {
  PricingContext,
  PricingResult,
  PricingStrategy,
  PriceAdjustment,
  InventoryBasedStrategy,
  DemandBasedStrategy,
  CompetitorBasedStrategy,
  TimeBasedStrategy,
  SeasonalStrategy,
  VendorTierStrategy,
} from './pricing-strategy';
import { logger } from '@/lib/utils/logger';

export interface PricingEngineConfig {
  minPrice?: number;
  maxPriceMultiplier?: number;
  enabledStrategies?: string[];
  customStrategies?: PricingStrategy[];
}

export class PricingEngineV2 {
  private strategies: PricingStrategy[] = [];
  private readonly minPrice: number;
  private readonly maxPriceMultiplier: number;

  constructor(config: PricingEngineConfig = {}) {
    this.minPrice = config.minPrice ?? 0.01;
    this.maxPriceMultiplier = config.maxPriceMultiplier ?? 3.0;

    this.initializeStrategies(config);
  }

  private initializeStrategies(config: PricingEngineConfig): void {
    const defaultStrategies: PricingStrategy[] = [
      new VendorTierStrategy(),
      new InventoryBasedStrategy(),
      new DemandBasedStrategy(),
      new CompetitorBasedStrategy(),
      new TimeBasedStrategy(),
      new SeasonalStrategy(),
    ];

    const enabledSet = config.enabledStrategies
      ? new Set(config.enabledStrategies)
      : null;

    this.strategies = defaultStrategies.filter(
      (s) => !enabledSet || enabledSet.has(s.name)
    );

    if (config.customStrategies) {
      this.strategies.push(...config.customStrategies);
    }

    this.strategies.sort((a, b) => a.priority - b.priority);

    logger.info('Pricing engine initialized', {
      strategies: this.strategies.map((s) => s.name),
    });
  }

  addStrategy(strategy: PricingStrategy): void {
    this.strategies.push(strategy);
    this.strategies.sort((a, b) => a.priority - b.priority);
    logger.info('Strategy added to pricing engine', { strategy: strategy.name });
  }

  removeStrategy(strategyName: string): boolean {
    const index = this.strategies.findIndex((s) => s.name === strategyName);
    if (index !== -1) {
      this.strategies.splice(index, 1);
      logger.info('Strategy removed from pricing engine', { strategy: strategyName });
      return true;
    }
    return false;
  }

  calculatePrice(context: PricingContext): PricingResult {
    let currentPrice = context.basePrice;
    const adjustments: PriceAdjustment[] = [];
    let confidenceFactors: number[] = [];

    for (const strategy of this.strategies) {
      try {
        const adjustment = strategy.apply(context, currentPrice);
        if (adjustment) {
          adjustments.push(adjustment);
          currentPrice += adjustment.adjustment;

          const adjustmentMagnitude = Math.abs(adjustment.adjustment / context.basePrice);
          confidenceFactors.push(1 - adjustmentMagnitude * 0.5);
        }
      } catch (error) {
        logger.error('Strategy execution failed', {
          strategy: strategy.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const finalPrice = this.applyBounds(currentPrice, context.basePrice);

    if (finalPrice !== currentPrice) {
      adjustments.push({
        ruleName: 'bounds-enforcement',
        adjustment: finalPrice - currentPrice,
        reason: `Price bounded to allowed range`,
      });
    }

    const confidence = confidenceFactors.length > 0
      ? confidenceFactors.reduce((a, b) => a * b, 1)
      : 1.0;

    logger.debug('Price calculated', {
      basePrice: context.basePrice,
      finalPrice,
      adjustmentsCount: adjustments.length,
      confidence,
    });

    return {
      finalPrice: Math.round(finalPrice * 100) / 100,
      adjustments,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  private applyBounds(price: number, basePrice: number): number {
    const maxPrice = basePrice * this.maxPriceMultiplier;
    return Math.max(this.minPrice, Math.min(maxPrice, price));
  }

  async calculateBatchPrices(
    contexts: PricingContext[]
  ): Promise<Map<number, PricingResult>> {
    const results = new Map<number, PricingResult>();

    for (let i = 0; i < contexts.length; i++) {
      results.set(i, this.calculatePrice(contexts[i]));
    }

    return results;
  }

  simulatePriceChanges(
    context: PricingContext,
    scenarios: Partial<PricingContext>[]
  ): Array<{ scenario: Partial<PricingContext>; result: PricingResult }> {
    return scenarios.map((scenario) => {
      const mergedContext = { ...context, ...scenario };
      return {
        scenario,
        result: this.calculatePrice(mergedContext),
      };
    });
  }

  getStrategies(): string[] {
    return this.strategies.map((s) => s.name);
  }
}

export function createPricingEngine(config?: PricingEngineConfig): PricingEngineV2 {
  return new PricingEngineV2(config);
}
