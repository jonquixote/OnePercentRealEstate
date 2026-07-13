import { useState, useEffect, useCallback } from 'react';
import { ImageIcon, X } from 'lucide-react';
import { Photo } from '@/components/Photo';

interface PropertyHeroProps {
    images: string[];
    address: string;
}

export function PropertyHero({ images, address }: PropertyHeroProps) {
    const [showAll, setShowAll] = useState(false);
    const mainImage = images?.[0];
    const secondaryImages = images?.slice(1, 3);
    const remainingCount = Math.max(0, (images?.length || 0) - 3);

    const closeLightbox = useCallback(() => setShowAll(false), []);

    useEffect(() => {
        if (!showAll) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeLightbox();
        };
        document.addEventListener('keydown', handleKeyDown);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
        };
    }, [showAll, closeLightbox]);

    if (!images || images.length === 0) {
        return (
            <div className="w-full h-[400px] bg-gray-100 rounded-xl flex items-center justify-center text-gray-400">
                <div className="text-center">
                    <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No Images Available</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative h-[400px] w-full rounded-xl overflow-hidden bg-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-3 h-full gap-1">
                {/* Main Large Image */}
                <div className="md:col-span-2 relative h-full">
                            <Photo
                                 src={mainImage}
                        alt={`Main view of ${address}`}
                        fill
                        sizes="(max-width: 768px) 100vw, 66vw"
                        className="object-cover hover:opacity-95 transition-opacity cursor-pointer"
                        onClick={() => setShowAll(true)}
                    />
                </div>

                {/* Right Column Stack */}
                <div className="hidden md:grid grid-rows-2 gap-1 h-full">
                    {secondaryImages?.[0] ? (
                        <div className="relative h-full">
                                <Photo
                                 src={secondaryImages[0]}
                                alt="Property view"
                                fill
                                sizes="(max-width: 768px) 100vw, 33vw"
                                className="object-cover hover:opacity-95 transition-opacity cursor-pointer"
                                onClick={() => setShowAll(true)}
                            />
                        </div>
                    ) : (
                        <div className="bg-gray-200 h-full w-full" />
                    )}

                    {secondaryImages?.[1] ? (
                        <div className="relative h-full">
                                <Photo
                                 src={secondaryImages[1]}
                                alt="Property view"
                                fill
                                sizes="(max-width: 768px) 100vw, 33vw"
                                className="object-cover hover:opacity-95 transition-opacity cursor-pointer"
                                onClick={() => setShowAll(true)}
                            />
                            {remainingCount > 0 && (
                                <div
                                    className="absolute inset-0 bg-black/50 flex items-center justify-center cursor-pointer hover:bg-black/60 transition-colors"
                                    onClick={() => setShowAll(true)}
                                >
                                    <span className="text-white font-medium text-lg flex items-center gap-2">
                                        <ImageIcon className="h-5 w-5" />
                                        +{remainingCount} more
                                    </span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-gray-200 h-full w-full" />
                    )}
                </div>
            </div>

            {/* Mobile View All Button */}
            <button
                className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm hover:bg-white text-gray-900 px-4 py-2 rounded-lg text-sm font-medium shadow-sm md:hidden"
                onClick={() => setShowAll(true)}
            >
                View {images.length} Photos
            </button>

            {/* Lightbox Modal */}
            {showAll && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`All photos of ${address}`}
                    className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
                    onClick={closeLightbox}
                >
                    <div className="max-w-5xl w-full max-h-[90vh] overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 p-4" onClick={(e) => e.stopPropagation()}>
                        {images.map((img, idx) => (
                            <Photo key={idx} src={img} alt={`${address} photo ${idx + 1}`} className="w-full rounded-lg" loading="lazy" decoding="async" />
                        ))}
                    </div>
                    <button
                        aria-label="Close photo gallery (Escape key)"
                        className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full inline-flex items-center gap-2"
                        onClick={closeLightbox}
                    >
                        <X className="h-5 w-5" />
                        <span className="text-sm">Close</span>
                    </button>
                </div>
            )}
        </div>
    );
}
