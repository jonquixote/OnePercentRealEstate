'use client';

import * as React from 'react';
import Map, { Marker, Popup, Source, Layer, MapRef } from 'react-map-gl';
import { Pin } from 'lucide-react';
import 'mapbox-gl/dist/mapbox-gl.css';

// Interface if not global
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

const clusterLayer = {
    id: 'clusters',
    type: 'circle',
    source: 'properties',
    filter: ['has', 'point_count'],
    paint: {
        'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 100, '#f1f075', 750, '#f28cb1'],
        'circle-radius': ['step', ['get', 'point_count'], 20, 100, 30, 750, 40]
    }
};

const clusterCountLayer = {
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

const unclusteredPointLayer = {
    id: 'unclustered-point',
    type: 'circle',
    source: 'properties',
    filter: ['!', ['has', 'point_count']],
    paint: {
        'circle-color': '#4264fb', // Blue by default
        'circle-radius': 6,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff'
    }
};

export function PropertyMap({ properties, onMarkerClick }: PropertyMapProps) {
    const mapRef = React.useRef<MapRef>(null);
    const [popupInfo, setPopupInfo] = React.useState<Property | null>(null);

    // Filter properties strictly to those with valid lat/lon
    const validProperties = React.useMemo(() => {
        return properties.filter(p => p.raw_data?.lat && p.raw_data?.lon);
    }, [properties]);

    // Convert to GeoJSON for Clustering
    const points = React.useMemo(() => ({
        type: 'FeatureCollection',
        features: validProperties.map(p => ({
            type: 'Feature',
            properties: {
                cluster: false,
                propertyId: p.id,
                price: p.listing_price,
                rent: p.estimated_rent
            },
            geometry: {
                type: 'Point',
                coordinates: [p.raw_data.lon, p.raw_data.lat]
            }
        }))
    }), [validProperties]);

    const onClick = (event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;

        const clusterId = feature.properties.cluster_id;
        const mapboxSource = mapRef.current?.getSource('properties') as any;

        if (clusterId) {
            mapboxSource.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
                if (err) return;
                mapRef.current?.easeTo({
                    center: feature.geometry.coordinates,
                    zoom,
                    duration: 500
                });
            });
        }
    };

    // Initial Viewport State - default to US view
    const [viewState, setViewState] = React.useState({
        latitude: 39.8283,
        longitude: -98.5795,
        zoom: 3
    });

    if (!MAPBOX_TOKEN) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-100 p-4 text-center text-sm text-gray-500">
                Mapbox Token Missing in .env.local
            </div>
        );
    }

    return (
        <Map
            {...viewState}
            onMove={evt => setViewState(evt.viewState)}
            ref={mapRef}
            mapStyle="mapbox://styles/mapbox/light-v11"
            mapboxAccessToken={MAPBOX_TOKEN}
            interactiveLayerIds={[clusterLayer.id]} // Only clusters are clickable currently via this method
            onClick={onClick}
            style={{ width: '100%', height: '100%' }}
        >
            <Source
                id="properties"
                type="geojson"
                data={points as any}
                cluster={true}
                clusterMaxZoom={14}
                clusterRadius={50}
            >
                {/* Cluster Layers */}
                <Layer {...clusterLayer as any} />
                <Layer {...clusterCountLayer as any} />

                {/* Unclustered Points - using custom Markers instead? 
                    Actually, mixing Layers and Markers is tricky. 
                    If we use Source/Layer, we get performance. 
                    Let's use Markers for unclustered points if possible, 
                    OR just color the dots. 
                    For now, simple dots are fine, but user wanted "pins". 
                    
                    Implementation detail: To use react components as markers for unclustered points, 
                    we iterate validProperties and return Marker if NOT clustered? 
                    But supercluster happens inside the Source. 
                    
                    Better approach for "Pins":
                    We can just iterate properties and render Markers if we don't care about clustering 
                    OR we use the Source/Layer approach for clustering and unclustered points are just circles. 
                    User asked for grouping when zoomed out.
                    Using Source/Layer is best for performance. 
                    I'll stick to circle layers for now.
                 */}
                <Layer {...unclusteredPointLayer as any} />
            </Source>

            {/* Helper to show popup on click of unclustered point? 
                The onClick handler above handles clusters. 
                For unclustered points, we need another interactive layer or event.
            */}
        </Map>
    );
}
