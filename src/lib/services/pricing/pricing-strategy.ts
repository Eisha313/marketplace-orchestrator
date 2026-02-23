export interface PricingContext {
  basePrice: number;
  inventoryLevel: number;
  demandScore: number;
  competitorPrices: number[];
  vendorTier: 'standard' | 'premium' | 'enterprise';
  productCategory: string;
  timeOfDay: number;
  dayOfWeek: number;
  seasonalFactor: number;
}

export interface PricingResult {
  finalPrice: number;
  adjustments: PriceAdjustment[];
  confidence: number;
}

export interface PriceAdjustment {
  ruleName: string;
  adjustment: number;
  reason: string;
}

export interface PricingStrategy {
  name: string;
  priority: number;
  apply(context: PricingContext, currentPrice: number): PriceAdjustment | null;
}

export class InventoryBasedStrategy implements PricingStrategy {
  name = 'inventory-based';
  priority = 10;

  constructor(
    private readonly lowStockThreshold: number = 10,
    private readonly highStockThreshold: number = 100,
    private readonly maxIncrease: number = 0.2,
    private readonly maxDecrease: number = 0.15
  ) {}

  apply(context: PricingContext, currentPrice: number): PriceAdjustment | null {
    const { inventoryLevel } = context;

    if (inventoryLevel <= this.lowStockThreshold) {
      const scarcityFactor = 1 - (inventoryLevel / this.lowStockThreshold);
      const increase = currentPrice * this.maxIncrease * scarcityFactor;
      return {
        ruleName: this.name,
        adjustment: increase,
        reason: `Low stock (${inventoryLevel} units) - scarcity pricing applied`,
      };
    }

    if (inventoryLevel >= this.highStockThreshold) {
      const excessFactor = Math.min(
        (inventoryLevel - this.highStockThreshold) / this.highStockThreshold,
        1
      );
      const decrease = currentPrice * this.maxDecrease * excessFactor;
      return {
        ruleName: this.name,
        adjustment: -decrease,
        reason: `High stock (${inventoryLevel} units) - clearance pricing applied`,
      };
    }

    return null;
  }
}

export class DemandBasedStrategy implements PricingStrategy {
  name = 'demand-based';
  priority = 20;

  constructor(
    private readonly highDemandThreshold: number = 0.7,
    private readonly lowDemandThreshold: number = 0.3,
    private readonly maxAdjustment: number = 0.15
  ) {}

  apply(context: PricingContext, currentPrice: number): PriceAdjustment | null {
    const { demandScore } = context;

    if (demandScore >= this.highDemandThreshold) {
      const demandFactor = (demandScore - this.highDemandThreshold) / (1 - this.highDemandThreshold);
      const increase = currentPrice * this.maxAdjustment * demandFactor;
      return {
        ruleName: this.name,
        adjustment: increase,
        reason: `High demand (score: ${demandScore.toFixed(2)}) - premium pricing`,
      };
    }

    if (demandScore <= this.lowDemandThreshold) {
      const demandFactor = (this.lowDemandThreshold - demandScore) / this.lowDemandThreshold;
      const decrease = currentPrice * this.maxAdjustment * demandFactor;
      return {
        ruleName: this.name,
        adjustment: -decrease,
        reason: `Low demand (score: ${demandScore.toFixed(2)}) - promotional pricing`,
      };
    }

    return null;
  }
}

export class CompetitorBasedStrategy implements PricingStrategy {
  name = 'competitor-based';
  priority = 30;

  constructor(
    private readonly targetPercentile: number = 0.3,
    private readonly maxDeviation: number = 0.1
  ) {}

  apply(context: PricingContext, currentPrice: number): PriceAdjustment | null {
    const { competitorPrices } = context;

    if (competitorPrices.length === 0) {
      return null;
    }

    const sortedPrices = [...competitorPrices].sort((a, b) => a - b);
    const targetIndex = Math.floor(sortedPrices.length * this.targetPercentile);
    const targetPrice = sortedPrices[targetIndex];

    const deviation = (targetPrice - currentPrice) / currentPrice;

    if (Math.abs(deviation) > this.maxDeviation) {
      const adjustment = deviation > 0
        ? currentPrice * this.maxDeviation
        : -currentPrice * this.maxDeviation;
      
      return {
        ruleName: this.name,
        adjustment,
        reason: `Competitive adjustment toward ${this.targetPercentile * 100}th percentile`,
      };
    }

    return null;
  }
}

export class TimeBasedStrategy implements PricingStrategy {
  name = 'time-based';
  priority = 40;

  private readonly peakHours = [10, 11, 12, 13, 14, 19, 20, 21];
  private readonly weekendDays = [0, 6];

  constructor(
    private readonly peakHourAdjustment: number = 0.05,
    private readonly weekendAdjustment: number = 0.03
  ) {}

  apply(context: PricingContext, currentPrice: number): PriceAdjustment | null {
    const { timeOfDay, dayOfWeek } = context;
    let totalAdjustment = 0;
    const reasons: string[] = [];

    if (this.peakHours.includes(timeOfDay)) {
      totalAdjustment += currentPrice * this.peakHourAdjustment;
      reasons.push(`peak hour (${timeOfDay}:00)`);
    }

    if (this.weekendDays.includes(dayOfWeek)) {
      totalAdjustment += currentPrice * this.weekendAdjustment;
      reasons.push('weekend');
    }

    if (totalAdjustment > 0) {
      return {
        ruleName: this.name,
        adjustment: totalAdjustment,
        reason: `Time-based adjustment: ${reasons.join(', ')}`,
      };
    }

    return null;
  }
}

export class SeasonalStrategy implements PricingStrategy {
  name = 'seasonal';
  priority = 50;

  constructor(private readonly maxAdjustment: number = 0.2) {}

  apply(context: PricingContext, currentPrice: number): PriceAdjustment | null {
    const { seasonalFactor } = context;

    if (seasonalFactor !== 1) {
      const adjustment = currentPrice * (seasonalFactor - 1) * this.maxAdjustment;
      return {
        ruleName: this.name,
        adjustment,
        reason: `Seasonal factor: ${seasonalFactor.toFixed(2)}`,
      };
    }

    return null;
  }
}

export class VendorTierStrategy implements PricingStrategy {
  name = 'vendor-tier';
  priority = 5;

  private readonly tierMultipliers: Record<string, number> = {
    standard: 1.0,
    premium: 1.05,
    enterprise: 1.1,
  };

  apply(context: PricingContext, currentPrice: number): PriceAdjustment | null {
    const { vendorTier } = context;
    const multiplier = this.tierMultipliers[vendorTier] || 1.0;

    if (multiplier !== 1.0) {
      const adjustment = currentPrice * (multiplier - 1);
      return {
        ruleName: this.name,
        adjustment,
        reason: `${vendorTier} vendor tier pricing`,
      };
    }

    return null;
  }
}
