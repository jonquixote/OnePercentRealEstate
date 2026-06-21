'use client';

import { ArrowLeft, Download, Loader2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

interface PropertyHeaderProps {
    address: string;
    status: string;
    listingUrl?: string | null;
    onExportPdf: () => void;
    exporting: boolean;
}

export function PropertyHeader({ address, status, listingUrl, onExportPdf, exporting }: PropertyHeaderProps) {
    return (
        <header className="bg-ink/90 border-b border-line sticky top-0 z-10 backdrop-blur">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="flex h-16 items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                        <Link href="/" className="p-2 -ml-2 text-muted-foreground hover:text-white rounded-full hover:bg-white/[0.06]" aria-label="Back to results">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <h1 className="text-lg font-semibold text-white truncate max-w-md">{address}</h1>
                        <Badge variant={status === 'watch' ? 'default' : 'secondary'} className="capitalize">
                            {status.replace('_', ' ')}
                        </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                        {listingUrl && (
                            <a
                                href={listingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center rounded-md border border-line bg-white/[0.03] px-3 py-1.5 text-sm font-medium text-haze hover:bg-white/[0.08] hover:text-white"
                            >
                                <ExternalLink className="mr-2 h-4 w-4" />
                                View Original
                            </a>
                        )}
                        <button
                            onClick={onExportPdf}
                            disabled={exporting}
                            className="flex items-center rounded-md border border-line bg-white/[0.03] px-3 py-1.5 text-sm font-medium text-haze hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                        >
                            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            Export PDF
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
}
