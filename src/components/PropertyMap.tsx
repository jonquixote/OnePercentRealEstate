'use client';

import * as React from 'react';
import Map, { Source, Layer, type MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

interface Property {
    id: string;
    address: string;
    listing_price: number;
    estimated_rent: number;
    raw_data: {
        lat: number;
        lon: number;
        beds?: number;
        baths?: number;
        sqft?: number;
    };
    status: string;
}

interface PropertyMapProps {
    properties: Property[];
    onMarkerClick?: (property: Property) => void;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Cluster layer styles
const clusterLayer: any = {
    id: 'clusters',
    type: 'circle',
    source: 'properties',
    filter: ['has', 'point_count'],
    paint: {
        'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 100, '#f1f075', 750, '#f28cb1'],
        'circle-radius': ['step', ['get', 'point_count'], 20, 100, 30, 750, 40]
    }
};

const clusterCountLayer: any = {
    id: 'cluster-count',
    type: 'symbol',
    source: 'properties',
    filter: ['has', 'point_count'],
    layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12
    }
};

const unclusteredPointLayer: any = {
    id: 'unclustered-point',
    type: 'circle',
    source: 'properties',
    filter: ['!', ['has', 'point_count']],
    paint: {
        'circle-color': '#4264fb',
        'circle-radius': 8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff'
    }
};

export function PropertyMap({ properties, onMarkerClick }: PropertyMapProps) {
    const mapRef = React.useRef<MapRef>(null);

    // Initial viewport - centered on US
    const [viewState, setViewState] = React.useState({
        latitude: 39.8283,
        longitude: -98.5795,
        zoom: 4
    });

    // Filter properties with valid coordinates
    const validProperties = React.useMemo(() => {
        return properties.filter(p =>
            p.raw_data?.lat &&
            p.raw_data?.lon &&
            !isNaN(p.raw_data.lat) &&
            !isNaN(p.raw_data.lon)
        );
    }, [properties]);

    // Convert to GeoJSON
    const geojsonData = React.useMemo(() => ({
        type: 'FeatureCollection' as const,
        features: validProperties.map(p => ({
            type: 'Feature' as const,
            properties: {
                id: p.id,
                price: p.listing_price,
                rent: p.estimated_rent,
                address: p.address
            },
            geometry: {
                type: 'Point' as const,
                coordinates: [p.raw_data.lon, p.raw_data.lat]
            }
        }))
    }), [validProperties]);

    // Handle cluster click to zoom in
    const handleClick = React.useCallback((event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;

        const clusterId = feature.properties?.cluster_id;
        if (clusterId && mapRef.current) {
            const source = mapRef.current.getSource('properties') as any;
            source?.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
                if (err) return;
                mapRef.current?.easeTo({
                    center: feature.geometry.coordinates,
                    zoom,
                    duration: 500
                });
            });
        }
    }, []);

    // Check for token
    if (!MAPBOX_TOKEN) {
        return (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 p-4">
                <div className="text-center">
                    <p className="text-sm font-medium text-gray-600">Map Unavailable</p>
                    <p className="text-xs text-gray-400 mt-1">NEXT_PUBLIC_MAPBOX_TOKEN not configured</p>
                </div>
            </div>
        );
    }

    return (
        <div className="absolute inset-0">
            <Map
                {...viewState}
                onMove={evt => setViewState(evt.viewState)}
                ref={mapRef}
                mapStyle="mapbox://styles/mapbox/light-v11"
                mapboxAccessToken={MAPBOX_TOKEN}
                interactiveLayerIds={['clusters', 'unclustered-point']}
                onClick={handleClick}
                style={{ width: '100%', height: '100%' }}
                reuseMaps
            >
                <Source
                    id="properties"
                    type="geojson"
                    data={geojsonData}
                    cluster={true}
                    clusterMaxZoom={14}
                    clusterRadius={50}
                >
                    <Layer {...clusterLayer} />
                    <Layer {...clusterCountLayer} />
                    <Layer {...unclusteredPointLayer} />
                </Source>
            </Map>
        </div>
    );
}
