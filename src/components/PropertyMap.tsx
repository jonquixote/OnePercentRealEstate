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

    // Construct Tile URL with filters
    const tileServerUrl = process.env.NEXT_PUBLIC_TILE_SERVER_URL || 'http://localhost:7800';
    const tileUrl = React.useMemo(() => {
        const params = new URLSearchParams();
        if (filters?.minPrice) params.append('min_price', filters.minPrice.toString());
        if (filters?.maxPrice) params.append('max_price', filters.maxPrice.toString());
        if (filters?.minBeds) params.append('min_beds', filters.minBeds.toString());
        if (filters?.minBaths) params.append('min_baths', filters.minBaths.toString());
        if (filters?.status) params.append('listing_status', filters.status);

        return `${tileServerUrl}/public.listings_mvt/{z}/{x}/{y}.pbf?${params.toString()}`;
    }, [filters, tileServerUrl]);

    // Handle Click
    const handleClick = React.useCallback((event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;

        const propertyId = feature.properties?.id;
        if (propertyId) {
            if (onMarkerClick) {
                onMarkerClick(propertyId);
            } else {
                router.push(`/property/${propertyId}`);
            }
        }
    }, [router, onMarkerClick]);

    // Check for token
    if (!MAPBOX_TOKEN) {
        return <div className="p-4 text-red-500">Mapbox Token Missing</div>;
    }

    return (
        <div className="absolute inset-0">
            <Map
                {...viewState}
                onMove={evt => setViewState(evt.viewState)}
                ref={mapRef}
                mapStyle="mapbox://styles/mapbox/streets-v12"
                mapboxAccessToken={MAPBOX_TOKEN}
                interactiveLayerIds={['listings-circle']}
                onClick={handleClick}
                style={{ width: '100%', height: '100%' }}
                reuseMaps
                onLoad={() => setMapLoaded(true)}
            >
                <Source
                    id="listings-source"
                    type="vector"
                    tiles={[tileUrl]}
                >
                    <Layer
                        id="listings-heatmap"
                        type="heatmap"
                        source-layer="listings"
                        maxzoom={13}
                        paint={{
                            'heatmap-weight': 0.5,
                            'heatmap-intensity': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                0, 0.5,
                                13, 3
                            ],
                            'heatmap-color': [
                                'interpolate',
                                ['linear'],
                                ['heatmap-density'],
                                0, 'rgba(33,102,172,0)',
                                0.2, 'rgb(103,169,207)',
                                0.4, 'rgb(209,229,240)',
                                0.6, 'rgb(253,219,199)',
                                0.8, 'rgb(239,138,98)',
                                1, 'rgb(178,24,43)'
                            ],
                            'heatmap-radius': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                0, 2,
                                13, 20
                            ],
                            'heatmap-opacity': 0.7
                        }}
                    />
                    <Layer
                        id="listings-circle"
                        type="circle"
                        source-layer="listings"
                        minzoom={12}
                        paint={{
                            'circle-color': [
                                'interpolate',
                                ['linear'],
                                ['get', 'price'],
                                100000, '#51bbd6',
                                500000, '#f1f075',
                                1000000, '#f28cb1'
                            ],
                            'circle-radius': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                12, 4,
                                16, 8
                            ],
                            'circle-opacity': 0.8,
                            'circle-stroke-width': 1,
                            'circle-stroke-color': '#fff'
                        }}
                    />
                </Source>
            </Map>
        </div>
    );
}
