'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PropertyCard } from '@/components/ui/card';
import { Loader2, TrendingUp, Search, BarChart3, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface Property {
  id: string;
  address: string;
  listing_price: number;
  estimated_rent: number;
  financial_snapshot: any;
  status: string;
}

export default function Dashboard() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());

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
    <div className="min-h-screen bg-gray-50 font-sans text-slate-900">
      {/* Hero Section */}
      <div className="relative bg-slate-900 text-white overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-10"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/0 to-slate-900/80"></div>

        <div className="relative mx-auto max-w-7xl px-8 pt-20 pb-24 sm:px-12 lg:px-16">
          <div className="max-w-2xl">
            <div className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20 mb-6">
              <TrendingUp className="mr-2 h-4 w-4" />
              Real-time Market Analysis
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl mb-6">
              Investment <br className="hidden sm:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
                Dashboard
              </span>
            </h1>
            <p className="mt-4 text-lg leading-8 text-slate-300">
              Identify high-yield "Zero-Capital" real estate opportunities. Analyze listing prices vs. HUD Fair Market Rents instantly.
            </p>

            <div className="mt-10 flex items-center gap-x-6">
              <Link href="/search" className="group rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-900 shadow-sm hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white transition-all flex items-center">
                <Search className="mr-2 h-4 w-4 transition-transform group-hover:scale-110" />
                Acquire New Data
              </Link>
              <Link href="/analytics" className="text-sm font-semibold leading-6 text-white hover:text-emerald-400 transition-colors flex items-center group">
                View Deep Analytics <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link href="/pricing" className="ml-4 text-sm font-semibold leading-6 text-amber-400 hover:text-amber-300 transition-colors flex items-center group">
                Upgrade to Pro
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-8 -mt-16 relative z-10 pb-20">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-white flex items-center">
            <BarChart3 className="mr-3 h-6 w-6 text-slate-500" />
            Recent Opportunities
            <span className="ml-4 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {properties.length} Properties
            </span>
          </h2>

          {/* Filter/Sort controls could go here */}
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
          {properties.map((property, idx) => {
            return (
              <div key={property.id} className="animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-backwards" style={{ animationDelay: `${idx * 100}ms` }}>
                <PropertyCard
                  property={property}
                  isSelected={selectedProperties.has(property.id)}
                  onSelect={toggleSelection}
                />
              </div>
            );
          })}
        </div>

        {properties.length === 0 && !loading && (
          <div className="mt-12 rounded-2xl border-2 border-dashed border-gray-300 p-12 text-center bg-white/50">
            <Search className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-semibold text-gray-900">No properties found</h3>
            <p className="mt-1 text-sm text-gray-500">Get started by acquiring some market data.</p>
            <div className="mt-6">
              <Link
                href="/search"
                className="inline-flex items-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600"
              >
                <Search className="-ml-0.5 mr-1.5 h-5 w-5" aria-hidden="true" />
                Go to Scraper
              </Link>
            </div>
          </div>
        )}

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
    </div>
  );
}
