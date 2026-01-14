import { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  getRentPredictor,
  type RentPredictionParams, 
  DEFAULT_PREDICTION_PARAMS 
} from "@/lib/ml/rentPredictor";

interface RentPredictionSettingsProps {
  onUpdate: () => void;
}

export function RentPredictionSettings({ onUpdate }: RentPredictionSettingsProps) {
  const [params, setParams] = useState<RentPredictionParams>(DEFAULT_PREDICTION_PARAMS);
  const [marketFactors, setMarketFactors] = useState<Array<{
    factor: string;
    impact: number;
    description: string;
  }>>([]);
  const [confidence, setConfidence] = useState(0);
  const [predictor, setPredictor] = useState<Awaited<ReturnType<typeof getRentPredictor>> | null>(null);

  useEffect(() => {
    // Initialize the predictor
    getRentPredictor().then(setPredictor);
  }, []);

  const handleParamChange = async (param: keyof RentPredictionParams, value: number) => {
    if (!predictor) return;

    const newParams = { ...params, [param]: value };
    setParams(newParams);
    predictor.updateParams(newParams);
    onUpdate(); // Trigger a new prediction
  };

  const resetToDefaults = async () => {
    if (!predictor) return;

    setParams(DEFAULT_PREDICTION_PARAMS);
    predictor.updateParams(DEFAULT_PREDICTION_PARAMS);
    onUpdate(); // Trigger a new prediction
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Market Analysis Confidence</CardTitle>
          <CardDescription>
            Overall confidence in the prediction based on available data quality and quantity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Progress value={confidence} className="w-full" />
            <p className="text-sm text-muted-foreground">
              {confidence.toFixed(1)}% confidence in prediction based on available data
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Market Factors</CardTitle>
          <CardDescription>
            Current impact of different market factors on the rent prediction
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {marketFactors.map((factor, index) => (
              <div key={index} className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>{factor.factor}</Label>
                  <span className="text-sm font-medium">{factor.impact.toFixed(1)}%</span>
                </div>
                <Progress value={factor.impact} className="w-full" />
                <p className="text-sm text-muted-foreground">{factor.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Prediction Settings</CardTitle>
          <CardDescription>
            Adjust the weights of different factors in the prediction model
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Location Impact</Label>
                <span className="text-sm font-medium">{(params.locationWeight * 100).toFixed(1)}%</span>
              </div>
              <Slider
                value={[params.locationWeight * 100]}
                onValueChange={([value]) => handleParamChange('locationWeight', value / 100)}
                max={100}
                step={1}
              />
              <p className="text-sm text-muted-foreground">
                Weight given to location-based factors (0-100%). Higher values mean location has more influence on rent.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Property Type Impact</Label>
                <span className="text-sm font-medium">{(params.propertyTypeWeight * 100).toFixed(1)}%</span>
              </div>
              <Slider
                value={[params.propertyTypeWeight * 100]}
                onValueChange={([value]) => handleParamChange('propertyTypeWeight', value / 100)}
                max={100}
                step={1}
              />
              <p className="text-sm text-muted-foreground">
                Importance of property type in prediction (0-100%). Higher values give more weight to property type differences.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Seasonal Factors</Label>
                <span className="text-sm font-medium">{(params.seasonalityWeight * 100).toFixed(1)}%</span>
              </div>
              <Slider
                value={[params.seasonalityWeight * 100]}
                onValueChange={([value]) => handleParamChange('seasonalityWeight', value / 100)}
                max={100}
                step={1}
              />
              <p className="text-sm text-muted-foreground">
                Influence of seasonal market trends (0-100%). Higher values mean stronger seasonal adjustments.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Size Impact</Label>
                <span className="text-sm font-medium">{(params.sizeFactor * 100).toFixed(1)}%</span>
              </div>
              <Slider
                value={[params.sizeFactor * 100]}
                onValueChange={([value]) => handleParamChange('sizeFactor', value / 100)}
                max={100}
                step={1}
              />
              <p className="text-sm text-muted-foreground">
                Weight given to property size (0-100%). Higher values mean square footage has more influence on rent.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Comparable Properties Radius</Label>
                <span className="text-sm font-medium">{params.comparableRadius.toFixed(1)} miles</span>
              </div>
              <Slider
                value={[params.comparableRadius]}
                onValueChange={([value]) => handleParamChange('comparableRadius', value)}
                min={1}
                max={10}
                step={0.5}
              />
              <p className="text-sm text-muted-foreground">
                Search radius for comparable properties (1-10 miles). Larger radius includes more properties but may be less relevant.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Historical Data Period</Label>
                <span className="text-sm font-medium">{params.historicalMonths} months</span>
              </div>
              <Slider
                value={[params.historicalMonths]}
                onValueChange={([value]) => handleParamChange('historicalMonths', value)}
                min={3}
                max={24}
                step={1}
              />
              <p className="text-sm text-muted-foreground">
                Months of historical data to consider (3-24 months). More history may provide better trends but could include outdated data.
              </p>
            </div>
          </div>

          <Button 
            variant="outline" 
            onClick={resetToDefaults}
            className="w-full"
          >
            Reset to Defaults
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}