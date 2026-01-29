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

interface PropertyMapProps {
    properties: Property[]; // Fallback or initial data
    onMarkerClick?: (property: Property) => void;
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

export function PropertyMap({ properties, onMarkerClick }: PropertyMapProps) {
    const mapRef = React.useRef<MapRef>(null);
    const router = useRouter();

    // Default to US View
    const [viewState, setViewState] = React.useState({
        latitude: 39.8283,
        longitude: -98.5795,
        zoom: 3.5
    });

    const [mapLoaded, setMapLoaded] = React.useState(false);
    const [clusters, setClusters] = React.useState<any>({ type: 'FeatureCollection', features: [] });
    const [isLoading, setIsLoading] = React.useState(false);

    // Fetch Clusters Logic
    const fetchClusters = React.useCallback(async (bounds: any, zoom: number) => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/clusters?min_lat=${bounds.getSouth()}&max_lat=${bounds.getNorth()}&min_lon=${bounds.getWest()}&max_lon=${bounds.getEast()}&zoom=${Math.round(zoom)}`);
            const data = await res.json();
            const features = Array.isArray(data) ? data : (data.features || []);
            setClusters({
                type: 'FeatureCollection',
                features: features
            });
        } catch (err) {
            console.error('Failed to fetch clusters:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Handle Map Move
    const onMoveEnd = React.useCallback((evt: ViewStateChangeEvent) => {
        const bounds = evt.target.getBounds();
        if (bounds) {
            fetchClusters(bounds, evt.viewState.zoom);
        }
    }, [fetchClusters]);

    // Initial Load - Fetch for whole US
    React.useEffect(() => {
        if (mapLoaded && mapRef.current) {
            const bounds = mapRef.current.getBounds();
            if (bounds) {
                fetchClusters(bounds, viewState.zoom);
            }
        }
    }, [mapLoaded]); // Run once when map is ready


    // Handle Click
    const handleClick = React.useCallback((event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;

        const cluster = feature.properties?.count > 1;

        if (cluster) {
            const coordinates = feature.geometry.coordinates;
            mapRef.current?.easeTo({
                center: coordinates,
                zoom: viewState.zoom + 2,
                duration: 500
            });
        } else {
            // It's a single point
            // The property ID might be in feature.properties.id if we returned it, but our SQL aggregation might verify that.
            // Our SQL returns 'id' as min(id)
            const propertyId = feature.properties?.id;
            if (propertyId) {
                router.push(`/property/${propertyId}`);
            }
        }
    }, [viewState.zoom, router]);

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
                    data={clusters}
                    cluster={false} // Server side clustering
                >
                    <Layer {...clusterLayer} />
                    <Layer {...clusterCountLayer} />
                    <Layer {...unclusteredPointLayer} filter={['==', ['get', 'count'], 1]} />
                    <Layer {...unclusteredLabelLayer} filter={['==', ['get', 'count'], 1]} />
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
