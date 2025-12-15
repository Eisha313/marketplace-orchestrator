import { z } from 'zod';

/**
 * Dynamic Pricing Engine
 * Calculates optimal prices based on inventory levels, demand patterns,
 * competitor analysis, and configurable business rules.
 */

// Validation schema for pricing rules
export const PricingRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  priority: z.number().min(1).max(100),
  conditions: z.object({
    inventoryThreshold: z.number().optional(),
    demandMultiplier: z.number().optional(),
    timeRange: z.object({
      start: z.string(),
      end: z.string(),
    }).optional(),
    competitorPriceGap: z.number().optional(),
  }),
  adjustment: z.object({
    type: z.enum(['percentage', 'fixed']),
    value: z.number(),
    minPrice: z.number().optional(),
    maxPrice: z.number().optional(),
  }),
  enabled: z.boolean(),
});

export type PricingRule = z.infer<typeof PricingRuleSchema>;

export interface PricingContext {
  basePrice: number;
  currentInventory: number;
  averageDailySales: number;
  competitorPrices: number[];
  vendorId: string;
  productId: string;
  categoryId: string;
}

export interface PricingResult {
  recommendedPrice: number;
  appliedRules: string[];
  priceChange: number;
  changePercentage: number;
  confidence: number;
  reasoning: string[];
}

/**
 * Main pricing engine class that orchestrates price calculations
 */
export class DynamicPricingEngine {
  private rules: PricingRule[] = [];
  private readonly DEFAULT_MIN_MARGIN = 0.1; // 10% minimum margin
  private readonly MAX_PRICE_CHANGE = 0.3; // 30% max change per calculation

  constructor(rules: PricingRule[] = []) {
    this.rules = rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Calculate optimal price based on context and rules
   */
  calculatePrice(context: PricingContext): PricingResult {
    const { basePrice } = context;
    let adjustedPrice = basePrice;
    const appliedRules: string[] = [];
    const reasoning: string[] = [];

    // Calculate demand score (0-1)
    const demandScore = this.calculateDemandScore(context);
    reasoning.push(`Demand score: ${(demandScore * 100).toFixed(1)}%`);

    // Calculate inventory pressure
    const inventoryPressure = this.calculateInventoryPressure(context);
    reasoning.push(`Inventory pressure: ${inventoryPressure > 0 ? 'Low stock' : 'Adequate'}`);

    // Calculate competitive position
    const competitiveAdjustment = this.calculateCompetitivePosition(context);
    reasoning.push(`Competitive adjustment: ${(competitiveAdjustment * 100).toFixed(1)}%`);

    // Apply enabled rules in priority order
    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      const ruleResult = this.evaluateRule(rule, context, adjustedPrice);
      if (ruleResult.applies) {
        adjustedPrice = ruleResult.newPrice;
        appliedRules.push(rule.id);
        reasoning.push(`Rule "${rule.name}": ${ruleResult.reason}`);
      }
    }

    // Apply demand-based adjustment
    const demandAdjustment = (demandScore - 0.5) * 0.2; // ±10% based on demand
    adjustedPrice *= (1 + demandAdjustment);

    // Apply inventory pressure adjustment
    adjustedPrice *= (1 + inventoryPressure * 0.15);

    // Apply competitive adjustment
    adjustedPrice *= (1 + competitiveAdjustment);

    // Enforce price change limits
    const maxPrice = basePrice * (1 + this.MAX_PRICE_CHANGE);
    const minPrice = basePrice * (1 - this.MAX_PRICE_CHANGE);
    adjustedPrice = Math.max(minPrice, Math.min(maxPrice, adjustedPrice));

    // Round to 2 decimal places
    adjustedPrice = Math.round(adjustedPrice * 100) / 100;

    const priceChange = adjustedPrice - basePrice;
    const changePercentage = (priceChange / basePrice) * 100;

    // Calculate confidence based on data quality
    const confidence = this.calculateConfidence(context);

    return {
      recommendedPrice: adjustedPrice,
      appliedRules,
      priceChange,
      changePercentage: Math.round(changePercentage * 100) / 100,
      confidence,
      reasoning,
    };
  }

  /**
   * Calculate demand score based on recent sales velocity
   */
  private calculateDemandScore(context: PricingContext): number {
    const { averageDailySales, currentInventory } = context;
    
    if (currentInventory === 0) return 1; // Max demand if out of stock
    
    const daysOfInventory = currentInventory / Math.max(averageDailySales, 0.1);
    
    // Score from 0 (>30 days inventory) to 1 (<3 days inventory)
    if (daysOfInventory <= 3) return 1;
    if (daysOfInventory >= 30) return 0;
    
    return 1 - ((daysOfInventory - 3) / 27);
  }

  /**
   * Calculate inventory pressure (-1 to 1)
   * Negative = overstock, Positive = low stock
   */
  private calculateInventoryPressure(context: PricingContext): number {
    const { currentInventory, averageDailySales } = context;
    const daysOfInventory = currentInventory / Math.max(averageDailySales, 0.1);
    
    if (daysOfInventory <= 7) return 1; // Critical low
    if (daysOfInventory <= 14) return 0.5; // Low
    if (daysOfInventory >= 60) return -0.5; // Overstock
    if (daysOfInventory >= 90) return -1; // Critical overstock
    
    return 0; // Normal
  }

  /**
   * Calculate competitive position adjustment
   */
  private calculateCompetitivePosition(context: PricingContext): number {
    const { basePrice, competitorPrices } = context;
    
    if (competitorPrices.length === 0) return 0;
    
    const avgCompetitorPrice = competitorPrices.reduce((a, b) => a + b, 0) / competitorPrices.length;
    const priceDiff = (avgCompetitorPrice - basePrice) / basePrice;
    
    // Adjust towards competitor average, but only up to 5%
    return Math.max(-0.05, Math.min(0.05, priceDiff * 0.5));
  }

  /**
   * Evaluate a single pricing rule
   */
  private evaluateRule(
    rule: PricingRule,
    context: PricingContext,
    currentPrice: number
  ): { applies: boolean; newPrice: number; reason: string } {
    const { conditions, adjustment } = rule;
    let applies = true;
    const reasons: string[] = [];

    // Check inventory threshold
    if (conditions.inventoryThreshold !== undefined) {
      if (context.currentInventory > conditions.inventoryThreshold) {
        applies = false;
      } else {
        reasons.push(`Inventory (${context.currentInventory}) below threshold (${conditions.inventoryThreshold})`);
      }
    }

    // Check demand multiplier
    if (conditions.demandMultiplier !== undefined) {
      const demandScore = this.calculateDemandScore(context);
      if (demandScore < conditions.demandMultiplier) {
        applies = false;
      } else {
        reasons.push(`High demand detected`);
      }
    }

    if (!applies) {
      return { applies: false, newPrice: currentPrice, reason: '' };
    }

    // Calculate new price
    let newPrice = currentPrice;
    if (adjustment.type === 'percentage') {
      newPrice = currentPrice * (1 + adjustment.value / 100);
    } else {
      newPrice = currentPrice + adjustment.value;
    }

    // Apply min/max constraints
    if (adjustment.minPrice !== undefined) {
      newPrice = Math.max(adjustment.minPrice, newPrice);
    }
    if (adjustment.maxPrice !== undefined) {
      newPrice = Math.min(adjustment.maxPrice, newPrice);
    }

    return {
      applies: true,
      newPrice,
      reason: reasons.join(', '),
    };
  }

  /**
   * Calculate confidence score based on data quality
   */
  private calculateConfidence(context: PricingContext): number {
    let confidence = 0.5; // Base confidence

    // More competitor data = higher confidence
    if (context.competitorPrices.length >= 5) confidence += 0.2;
    else if (context.competitorPrices.length >= 2) confidence += 0.1;

    // Higher sales velocity = more reliable data
    if (context.averageDailySales >= 10) confidence += 0.2;
    else if (context.averageDailySales >= 3) confidence += 0.1;

    // Active rules increase confidence
    const activeRules = this.rules.filter(r => r.enabled).length;
    if (activeRules >= 3) confidence += 0.1;

    return Math.min(1, confidence);
  }

  /**
   * Add or update a pricing rule
   */
  addRule(rule: PricingRule): void {
    const validated = PricingRuleSchema.parse(rule);
    const existingIndex = this.rules.findIndex(r => r.id === validated.id);
    
    if (existingIndex >= 0) {
      this.rules[existingIndex] = validated;
    } else {
      this.rules.push(validated);
    }
    
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a pricing rule
   */
  removeRule(ruleId: string): boolean {
    const index = this.rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }
}