'use client';

import { useEffect, useState, useMemo } from 'react';
import { PropertyCard } from '@/components/ui/card';
import Header from '@/components/Header';
import { Loader2, TrendingUp, Search, BarChart3, ArrowRight, Map as MapIcon, List as ListIcon } from 'lucide-react';
import Link from 'next/link';
import { PropertyMap } from '@/components/PropertyMap';
import { PropertyFilters, FilterState } from '@/components/PropertyFilters';
import { Button } from '@/components/ui/button';

interface Property {
  id: string;
  address: string;
  listing_price: number;
  estimated_rent: number;
  financial_snapshot: any;
  status: string;
  raw_data: any;
  latitude: number;
  longitude: number;
  created_at?: string;
}

import { getProperties } from '@/app/actions';

export default function Dashboard() {
  // State
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());

  // View State (for Mobile primarily, or specific toggle)
  const [showMap, setShowMap] = useState(true);
  const [sortBy, setSortBy] = useState('newest');

  // Filter State
  const [filters, setFilters] = useState<FilterState>({
    showSold: false,
    minPrice: 0,
    maxPrice: 2000000,
    minBeds: 0,
    minBaths: 0,
    onlyOnePercentRule: false
  });

  useEffect(() => {
    loadProperties(1);
  }, [sortBy, filters]); // Reload when sort OR filters change

  async function loadProperties(pageNum: number) {
    try {
      if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);

      const data = await getProperties(pageNum, 100, sortBy, {
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        minBeds: filters.minBeds,
        minBaths: filters.minBaths,
        onlyOnePercentRule: filters.onlyOnePercentRule
      });

      // @ts-ignore
      if (data.length < 100) setHasMore(false);
      else setHasMore(true);

      if (pageNum === 1) {
        // @ts-ignore
        setProperties(data);
      } else {
        // @ts-ignore
        setProperties(prev => [...prev, ...data]);
      }

      setPage(pageNum);
    } catch (error) {
      console.error('Failed to fetch properties:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  const handleLoadMore = () => {
    loadProperties(page + 1);
  };

  // Client-side filtering is now minimal - server handles price/beds/baths/1% rule
  // We only filter showSold client-side (status check)
  const filteredProperties = useMemo(() => {
    return properties.filter(p => {
      // Status (Hide Sold) - only client-side filter remaining
      if (!filters.showSold && (p.status === 'sold' || p.listing_price === null)) return false;
      return true;
    });
  }, [properties, filters.showSold]);

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedProperties);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      if (newSelected.size >= 3) {
        alert("You can compare up to 3 properties at a time.");
        return;
      }
      newSelected.add(id);
    }
    setSelectedProperties(newSelected);
  };

  if (loading && page === 1) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-slate-900" />
          <p className="text-sm font-medium text-gray-500 animate-pulse">Loading market data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-slate-900 flex flex-col">
      <Header />

      {/* Sticky Filters */}
      <div className="sticky top-0 z-20 bg-white shadow-sm">
        <PropertyFilters filters={filters} setFilters={setFilters} />
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden h-[calc(100vh-140px)]">
        {/* Use fixed height for map layout, subtract header/filter height approx */}

        {/* List View (Scrollable) */}
        <div className={`flex-1 overflow-y-auto p-6 transition-all duration-300
          ${showMap ? 'hidden lg:block lg:w-[55%]' : 'w-full'} 
        `}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
            <h2 className="text-xl font-bold flex items-center">
              <BarChart3 className="mr-2 h-5 w-5 text-slate-500" />
              Opportunities
              <span className="ml-3 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {filteredProperties.length} Found
              </span>
            </h2>

            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="h-9 rounded-md border border-slate-200 text-sm px-3 py-1 bg-white"
              >
                <option value="newest">Newest Listed</option>
                <option value="one_percent_high">1% Rule: Best First</option>
                <option value="one_percent_low">1% Rule: Worst First</option>
                <option value="price_high">Price: High to Low</option>
                <option value="price_low">Price: Low to High</option>
              </select>

              {/* Mobile Toggle */}
              <div className="lg:hidden">
                <Button variant="outline" size="sm" onClick={() => setShowMap(!showMap)}>
                  {showMap ? <ListIcon className="h-4 w-4 mr-2" /> : <MapIcon className="h-4 w-4 mr-2" />}
                  {showMap ? 'List' : 'Map'}
                </Button>
              </div>
            </div>
          </div>

          {/* Grid */}
          <div className={`grid gap-6 ${showMap ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
            {filteredProperties.map((property, idx) => (
              <div key={property.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: `${idx * 50}ms` }}>
                <PropertyCard
                  property={property}
                  isSelected={selectedProperties.has(property.id)}
                  onSelect={toggleSelection}
                />
              </div>
            ))}
          </div>

          {filteredProperties.length === 0 && (
            <div className="mt-12 rounded-2xl border-2 border-dashed border-gray-300 p-12 text-center bg-white/50">
              <Search className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-semibold text-gray-900">No properties match your filters</h3>
              <p className="mt-1 text-sm text-gray-500">Try adjusting your price range or criteria.</p>
            </div>
          )}

          {/* Load More */}
          {hasMore && !loading && (
            <div className="mt-8 text-center">
              <Button
                onClick={handleLoadMore}
                disabled={loadingMore}
                variant="outline"
                className="w-full md:w-auto min-w-[200px]"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load More Properties'
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Map View */}
        <div className={`
          ${showMap ? 'block h-full w-full' : 'hidden'} 
          lg:block lg:h-[calc(100vh-140px)] lg:w-[45%] lg:sticky lg:top-[140px]
          relative border-l border-gray-200
        `}>
          <PropertyMap
            filters={{
              minPrice: filters.minPrice,
              maxPrice: filters.maxPrice,
              minBeds: filters.minBeds,
              minBaths: filters.minBaths,
              status: filters.showSold ? 'sold' : 'for_sale'
            }}
          />
          {/* Toggle for Desktop */}
          <button
            onClick={() => setShowMap(!showMap)}
            className="absolute top-4 left-4 z-10 bg-white p-2 rounded-md shadow-md border border-gray-200 hover:bg-gray-50 hidden lg:block"
            title={showMap ? "Hide Map" : "Show Map"}
          >
            {showMap ? <ArrowRight className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
          </button>

          {/* Mobile Floating Toggle (Visible only when Map is open) */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 lg:hidden">
            <Button variant="default" size="default" className="shadow-lg rounded-full px-6" onClick={() => setShowMap(false)}>
              <ListIcon className="h-4 w-4 mr-2" />
              Show List
            </Button>
          </div>
        </div>
      </div>

      {/* Floating Compare Button */}
      {selectedProperties.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 transform z-50 animate-in slide-in-from-bottom-8 fade-in duration-300">
          <Link
            href={`/compare?ids=${Array.from(selectedProperties).join(',')}`}
            className="group flex items-center rounded-full bg-slate-900 pl-4 pr-6 py-3 text-white shadow-2xl hover:bg-slate-800 transition-all hover:scale-105 ring-4 ring-white"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold mr-3 shadow-inner group-hover:scale-110 transition-transform">
              {selectedProperties.size}
            </span>
            <span className="font-medium">Compare Selected</span>
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      )}
    </div>
  );
}
