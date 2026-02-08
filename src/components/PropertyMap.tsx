'use client';

import * as React from 'react';
import Map, { Source, Layer, type MapRef, type ViewStateChangeEvent } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useRouter } from 'next/navigation';

interface Property {
    id: string;
    address: string;
    listing_price: number;
    estimated_rent: number;
    latitude: number;
    longitude: number;
    status: string;
}



const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Layer Styles
const clusterLayer: any = {
    id: 'clusters',
    type: 'circle',
    source: 'properties',
    filter: ['>', ['get', 'count'], 1],
    paint: {
        'circle-color': ['step', ['get', 'count'], '#51bbd6', 10, '#f1f075', 100, '#f28cb1'],
        'circle-radius': ['step', ['get', 'count'], 15, 10, 20, 100, 30]
    }
};

const clusterCountLayer: any = {
    id: 'cluster-count',
    type: 'symbol',
    source: 'properties',
    filter: ['>', ['get', 'count'], 1],
    layout: {
        'text-field': '{count}',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12
    }
};

const unclusteredPointLayer: any = {
    id: 'unclustered-point',
    type: 'circle',
    source: 'properties',
    filter: ['==', ['get', 'count'], 1],
    paint: {
        'circle-color': '#11b4da',
        'circle-radius': 8,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff'
    }
};

const unclusteredLabelLayer: any = {
    id: 'unclustered-label',
    type: 'symbol',
    source: 'properties',
    filter: ['==', ['get', 'count'], 1],
    layout: {
        'text-field': [
            'format',
            ['concat', '$', ['to-string', ['get', 'avg_price']]],
            { 'font-scale': 0.8 },
            '\n',
            ['concat', ['number-format', ['*', ['/', ['get', 'avg_rent'], ['get', 'avg_price']], 100], { 'min-fraction-digits': 2, 'max-fraction-digits': 2 }], '%'],
            { 'font-scale': 0.7, 'text-color': '#10b981' }
        ],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12,
        'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.8,
        'text-justify': 'auto'
    },
    paint: {
        'text-color': '#000000',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2
    }
};

export interface PropertyMapProps {
    filters?: {
        minPrice?: number;
        maxPrice?: number;
        minBeds?: number;
        minBaths?: number;
        status?: string; // 'for_sale' | 'sold'
    };
    onMarkerClick?: (propertyId: string) => void;
}

export function PropertyMap({ filters, onMarkerClick }: PropertyMapProps) {
    const mapRef = React.useRef<MapRef>(null);
    const router = useRouter();

    // Default to US View
    const [viewState, setViewState] = React.useState({
        latitude: 39.8283,
        longitude: -98.5795,
        zoom: 3.5
    });

    const [mapLoaded, setMapLoaded] = React.useState(false);
    const [geoJsonData, setGeoJsonData] = React.useState<any>({ type: 'FeatureCollection', features: [] });
    const [isLoading, setIsLoading] = React.useState(false);

    // Fetch Properties/Clusters Logic
    const fetchProperties = React.useCallback(async (bounds: any, zoom: number, currentFilters: any) => {
        setIsLoading(true);
        try {
            const query = new URLSearchParams({
                north: bounds.getNorth().toString(),
                south: bounds.getSouth().toString(),
                east: bounds.getEast().toString(),
                west: bounds.getWest().toString(),
                zoom: Math.round(zoom).toString(),
            });

            if (currentFilters?.minPrice) query.append('minPrice', currentFilters.minPrice.toString());
            if (currentFilters?.maxPrice) query.append('maxPrice', currentFilters.maxPrice.toString());
            if (currentFilters?.minBeds) query.append('beds', currentFilters.minBeds.toString());
            if (currentFilters?.minBaths) query.append('baths', currentFilters.minBaths.toString());
            // Map filter 'showSold' to status if needed, or assume 'for_sale' default
            // The API expects 'status'
            if (currentFilters?.status) query.append('status', currentFilters.status);

            const res = await fetch(`/api/properties/viewport?${query.toString()}`);
            if (!res.ok) throw new Error('API request failed');

            const result = await res.json();

            // Normalize to GeoJSON
            const features = result.data.map((item: any) => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [item.longitude, item.latitude]
                },
                properties: {
                    ...item,
                    // If clustering, 'count' is in item. If individual property, force count=1
                    count: item.count || 1,
                    // Format price for display if needed
                    formatted_price: item.price ? `$${item.price.toLocaleString()}` : 'N/A'
                }
            }));

            setGeoJsonData({
                type: 'FeatureCollection',
                features
            });
        } catch (err) {
            console.error('Failed to fetch map data:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Handle Map Move
    const onMoveEnd = React.useCallback((evt: ViewStateChangeEvent) => {
        const bounds = evt.target.getBounds();
        if (bounds) {
            fetchProperties(bounds, evt.viewState.zoom, filters);
        }
    }, [fetchProperties, filters]);

    // Initial Load & Filter Change
    React.useEffect(() => {
        if (mapLoaded && mapRef.current) {
            const bounds = mapRef.current.getBounds();
            if (bounds) {
                fetchProperties(bounds, viewState.zoom, filters);
            }
        }
    }, [mapLoaded, filters, fetchProperties]); // Re-fetch when filters change

    // Handle Click
    const handleClick = React.useCallback((event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;

        const isCluster = feature.properties?.count > 1;

        if (isCluster) {
            const coordinates = feature.geometry.coordinates.slice();
            // Zoom in
            mapRef.current?.easeTo({
                center: coordinates,
                zoom: viewState.zoom + 2,
                duration: 500
            });
        } else {
            // Individual property
            const propertyId = feature.properties?.id;
            if (propertyId) {
                if (onMarkerClick) {
                    onMarkerClick(propertyId);
                } else {
                    router.push(`/property/${propertyId}`);
                }
            }
        }
    }, [viewState.zoom, router, onMarkerClick]);

    // Check for token
    if (!MAPBOX_TOKEN) {
        return <div className="p-4 text-red-500">Mapbox Token Missing</div>;
    }

    return (
        <div className="absolute inset-0">
            <Map
                {...viewState}
                onMove={evt => setViewState(evt.viewState)}
                onMoveEnd={onMoveEnd}
                ref={mapRef}
                mapStyle="mapbox://styles/mapbox/streets-v12"
                mapboxAccessToken={MAPBOX_TOKEN}
                interactiveLayerIds={['clusters', 'unclustered-point']}
                onClick={handleClick}
                style={{ width: '100%', height: '100%' }}
                reuseMaps
                onLoad={() => setMapLoaded(true)}
            >
                <Source
                    id="properties"
                    type="geojson"
                    data={geoJsonData}
                    cluster={false} // Server side clustering
                >
                    <Layer {...clusterLayer} />
                    <Layer {...clusterCountLayer} />
                    {/* Reuse existing layers, they use 'count' property logic which we preserved */}
                    <Layer {...unclusteredPointLayer} />
                    <Layer {...unclusteredLabelLayer} />
                </Source>
            </Map>
            {isLoading && (
                <div className="absolute top-4 right-4 bg-white/80 backdrop-blur px-3 py-1 rounded-full text-xs font-medium shadow-sm z-10 transition-opacity duration-200">
                    Updating...
                </div>
            )}
        </div>
    );
}
