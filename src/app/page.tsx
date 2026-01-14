'use client';

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
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
  created_at?: string;
}

export default function Dashboard() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());

  // View State (for Mobile primarily, or specific toggle)
  const [showMap, setShowMap] = useState(true);

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
    async function fetchProperties() {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching properties:', error);
      } else {
        setProperties(data || []);
      }
      setLoading(false);
    }

    fetchProperties();
  }, []);

  // Filter Logic
  const filteredProperties = useMemo(() => {
    return properties.filter(p => {
      // 1. Status (Hide Sold)
      if (!filters.showSold && (p.status === 'sold' || p.listing_price === null)) return false;

      // 2. Price
      // If sold, maybe check sold_price? For now assume listing_price or raw_data.sold_price if available?
      // Use listing_price for consistency for now
      if (p.listing_price > filters.maxPrice) return false;
      if (p.listing_price < filters.minPrice) return false;

      // 3. Beds/Baths
      const beds = p.raw_data?.beds || 0;
      const baths = p.raw_data?.baths || 0;
      if (beds < filters.minBeds) return false;
      if (baths < filters.minBaths) return false;

      // 4. 1% Rule
      if (filters.onlyOnePercentRule) {
        if (!p.listing_price || !p.estimated_rent) return false;
        if ((p.estimated_rent / p.listing_price) < 0.01) return false;
      }

      return true;
    });
  }, [properties, filters]);

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

  if (loading) {
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
        <div className={`flex-1 overflow-y-auto p-6 ${showMap ? 'lg:w-[55%]' : 'w-full'} transition-all duration-300`}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center">
              <BarChart3 className="mr-2 h-5 w-5 text-slate-500" />
              Opportunities
              <span className="ml-3 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {filteredProperties.length} Found
              </span>
            </h2>

            {/* Mobile Toggle */}
            <div className="lg:hidden">
              <Button variant="outline" size="sm" onClick={() => setShowMap(!showMap)}>
                {showMap ? <ListIcon className="h-4 w-4 mr-2" /> : <MapIcon className="h-4 w-4 mr-2" />}
                {showMap ? 'List' : 'Map'}
              </Button>
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
        </div>

        {/* Map View (Sticky/Fixed) */}
        <div className={`lg:block ${showMap ? 'block h-[50vh] lg:h-auto lg:w-[45%]' : 'hidden'} relative border-l border-gray-200`}>
          <PropertyMap properties={filteredProperties} />
          {/* Toggle for Desktop */}
          <button
            onClick={() => setShowMap(!showMap)}
            className="absolute top-4 left-4 z-10 bg-white p-2 rounded-md shadow-md border border-gray-200 hover:bg-gray-50 hidden lg:block"
            title={showMap ? "Hide Map" : "Show Map"}
          >
            {showMap ? <ArrowRight className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
          </button>
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
