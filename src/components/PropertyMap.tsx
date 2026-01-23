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
            const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
            const res = await fetch(`/api/map/clusters?bounds=${bbox}&zoom=${zoom}`);
            const data = await res.json();
            setClusters(data);
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

        const cluster = feature.properties?.cluster;

        if (cluster) {
            const clusterId = feature.id; // Or geometry to zoom
            // Since we are server-side, we don't have supercluster ID. 
            // We just zoom into the center of the cluster.
            const coordinates = feature.geometry.coordinates;
            mapRef.current?.easeTo({
                center: coordinates,
                zoom: viewState.zoom + 2,
                duration: 500
            });
        } else {
            // It's a single point
            const propertyId = feature.properties?.id;
            if (propertyId) {
                router.push(`/property/${propertyId}`);
            }
        }
    }, [viewState.zoom, router]);

    // Check for token
    if (!MAPBOX_TOKEN) {
        // ... (existing error UI)
        return null;
    }

    return (
        <div className="absolute inset-0">
            <Map
                {...viewState}
                onMove={evt => setViewState(evt.viewState)}
                onMoveEnd={onMoveEnd}
                ref={mapRef}
                mapStyle="mapbox://styles/mapbox/light-v11"
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
                    cluster={false} // We handle clustering on server, so client clustering is OFF
                >
                    <Layer {...clusterLayer} />
                    <Layer {...clusterCountLayer} />
                    <Layer {...unclusteredPointLayer} />
                </Source>
            </Map>
            {isLoading && (
                <div className="absolute top-4 right-4 bg-white/80 backdrop-blur px-3 py-1 rounded-full text-xs font-medium shadow-sm z-10">
                    Updating...
                </div>
            )}
        </div>
    );
}
