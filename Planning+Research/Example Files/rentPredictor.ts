import type { Property } from "@shared/schema";

// Types for ML model parameters
export interface RentPredictionParams {
  historicalMonths: number;       
  marketTrendWeight: number;     
  comparableRadius: number;
  locationWeight: number;
  propertyTypeWeight: number;
  seasonalityWeight: number;
  sizeFactor: number;      
}

export const DEFAULT_PREDICTION_PARAMS: RentPredictionParams = {
  historicalMonths: 24,
  marketTrendWeight: 0.05,
  comparableRadius: 10,
  locationWeight: 0.3,
  propertyTypeWeight: 0.2,
  seasonalityWeight: 0.1,
  sizeFactor: 0.2
};

interface PropertyZillowData {
  yearBuilt?: number;
  schools?: Array<{ name: string; rating?: number }>;
}

interface PropertyWithZillowData extends Omit<Property, 'zillowData'> {
  zillowData?: PropertyZillowData;
}

interface CachedPrediction {
  propertyId: number;
  prediction: number;
  confidence: number;
  timestamp: number;
  params: RentPredictionParams;
}

export class RentPredictor {
  private params: RentPredictionParams;
  private predictionCache: Map<number, CachedPrediction>;
  private static instance: RentPredictor | null = null;
  private static initializationPromise: Promise<RentPredictor> | null = null;

  private constructor() {
    this.params = DEFAULT_PREDICTION_PARAMS;
    this.predictionCache = new Map();
  }

  public updateParams(newParams: Partial<RentPredictionParams>) {
    this.params = { ...this.params, ...newParams };
  }

  public static async getInstance(): Promise<RentPredictor> {
    if (!RentPredictor.initializationPromise) {
      RentPredictor.initializationPromise = new Promise<RentPredictor>((resolve) => {
        if (!RentPredictor.instance) {
          RentPredictor.instance = new RentPredictor();
        }
        resolve(RentPredictor.instance);
      });
    }
    return RentPredictor.initializationPromise;
  }

  async predictRent(property: PropertyWithZillowData): Promise<number> {
    if (!property || !property.price) {
      console.error('Invalid property data or missing price:', property);
      return 0;
    }

    try {
      console.log(`Starting rent prediction for property: ${property.address}`);
      const propertyValue = parseFloat(property.price);
      if (isNaN(propertyValue) || propertyValue <= 0) {
        console.error('Invalid price value:', property.price);
        return 0;
      }

      // Step 1: Calculate base monthly rent using cap rate approach
      const targetCapRate = 0.065; // 6.5% cap rate
      const targetAnnualNOI = propertyValue * targetCapRate;
      let baseMonthlyRent = (targetAnnualNOI * 2) / 12; // Account for 50% expense ratio

      // Step 2: Apply property-specific adjustments
      let adjustedRent = baseMonthlyRent;

      // Square footage adjustment
      if (property.squareFeet) {
        const sqft = parseFloat(property.squareFeet);
        if (!isNaN(sqft) && sqft > 0) {
          const pricePerSqft = propertyValue / sqft;
          if (pricePerSqft > 200) { // Higher-end properties tend to have lower rent/price ratios
            adjustedRent *= 0.9;
          } else if (pricePerSqft < 100) { // Lower-end properties tend to have higher rent/price ratios
            adjustedRent *= 1.1;
          }
        }
      }

      // Bedrooms adjustment
      if (property.bedrooms) {
        const beds = parseFloat(property.bedrooms);
        if (!isNaN(beds)) {
          // Larger homes typically have lower rent/price ratios
          if (beds > 3) {
            adjustedRent *= (1 - ((beds - 3) * 0.05)); // 5% reduction per additional bedroom
          }
        }
      }

      // Property type adjustment
      if (property.propertyType) {
        const typeMultipliers: Record<string, number> = {
          'SINGLE_FAMILY': 1.0,
          'APARTMENT': 1.15, // Apartments typically have higher rent/price ratios
          'CONDO': 1.1,
          'TOWNHOUSE': 1.05,
          'MULTI_FAMILY': 1.2, // Multi-family typically has higher rent/price ratios
          'MOBILE': 1.25 // Mobile homes typically have higher rent/price ratios
        };
        const multiplier = typeMultipliers[property.propertyType] || 1.0;
        adjustedRent *= multiplier;
      }

      // Year built adjustment
      if (property.zillowData?.yearBuilt) {
        const age = 2025 - property.zillowData.yearBuilt;
        if (age > 30) {
          adjustedRent *= 0.95; // 5% reduction for older properties
        } else if (age < 5) {
          adjustedRent *= 1.05; // 5% premium for newer properties
        }
      }

      // Step 3: Apply vacancy rate (5%)
      const vacancyRate = 0.05;
      const effectiveMonthlyRent = adjustedRent * (1 - vacancyRate);

      // Step 4: Calculate annual figures
      const annualGrossRental = effectiveMonthlyRent * 12;
      const operatingExpenses = annualGrossRental * 0.5; // 50% rule
      const noi = annualGrossRental - operatingExpenses;

      // Step 5: Validate final cap rate
      const actualCapRate = noi / propertyValue;
      console.log(`Final Cap Rate: ${(actualCapRate * 100).toFixed(2)}%`);

      // Step 6: Only apply downward adjustments if cap rate is too high
      let finalMonthlyRent = effectiveMonthlyRent;
      if (actualCapRate > 0.07) { // Only adjust if cap rate is too high
        const adjustment = 0.065 / actualCapRate; // Target 6.5% cap rate
        if (adjustment < 1) { // Only apply downward adjustments
          finalMonthlyRent *= adjustment;
        }
      }

      // Step 7: Apply final market adjustment
      finalMonthlyRent *= 0.85; // Reduce by 15% to match market rates

      // Round to nearest whole number
      finalMonthlyRent = Math.round(finalMonthlyRent);
      console.log(`Final monthly rent prediction: $${finalMonthlyRent}`);

      // Save prediction if we have a valid property ID
      if (property.id) {
        const prediction: CachedPrediction = {
          propertyId: property.id,
          prediction: finalMonthlyRent,
          confidence: 85, // Higher confidence due to property-specific factors
          timestamp: Date.now(),
          params: { ...this.params }
        };

        this.predictionCache.set(property.id, prediction);
        await this.savePrediction(prediction);
      }

      return finalMonthlyRent;

    } catch (error) {
      console.error('Error in rent prediction:', error);
      // Use a conservative cap rate-based estimate as fallback
      const fallbackCapRate = 0.055; // 5.5% cap rate
      const fallbackNOI = propertyValue * fallbackCapRate;
      const fallbackMonthlyRent = Math.round((fallbackNOI * 2) / 12 * 0.85); // Apply same 15% reduction
      console.log(`Using fallback rent estimate: $${fallbackMonthlyRent}`);
      return fallbackMonthlyRent;
    }
  }

  private async savePrediction(prediction: CachedPrediction): Promise<void> {
    if (!prediction || !prediction.propertyId || prediction.prediction <= 0) {
      console.error('Invalid prediction data:', prediction);
      return;
    }

    try {
      const response = await fetch('/api/rent-predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: prediction.propertyId,
          prediction: prediction.prediction,
          confidence: prediction.confidence,
          predictionParams: {
            marketTrendWeight: this.params.marketTrendWeight,
            historicalMonths: this.params.historicalMonths,
            comparableRadius: this.params.comparableRadius
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to save prediction: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error saving prediction:', error);
    }
  }
}

// Export a function to get the predictor instance
export async function getRentPredictor(): Promise<RentPredictor> {
  return RentPredictor.getInstance();
}