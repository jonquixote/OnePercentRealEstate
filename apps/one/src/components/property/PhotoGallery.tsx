'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ImageIcon } from 'lucide-react';
import { Media } from '@oper/primitives';

// SlideImage is a plain TS interface — importing the type costs nothing at runtime.
import type { SlideImage } from 'yet-another-react-lightbox';

// Lazy-load the entire lightbox shell (core + plugins + CSS) only when needed.
// Keeps yet-another-react-lightbox out of the initial page bundle.
const PhotoLightbox = dynamic(() => import('./PhotoLightbox'), {
    ssr: false,
    loading: () => null,
});

interface PhotoGalleryProps {
    images: string[];
    address: string;
}

interface TileButtonProps {
    src: string;
    alt: string;
    ariaLabel: string;
    sizes: string;
    onClick: () => void;
    priority?: boolean;
    children?: React.ReactNode;
    className?: string;
}

function TileButton({
    src,
    alt,
    ariaLabel,
    sizes,
    onClick,
    priority,
    children,
    className,
}: TileButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className={`group relative block h-full w-full overflow-hidden rounded-2xl bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${className ?? ''}`}
        >
            <Media
                media={{ primary_photo: src }}
                alt={alt}
                fill
                sizes={sizes}
                priority={priority}
                className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
            />
            {children}
        </button>
    );
}

export function PhotoGallery({ images, address }: PhotoGalleryProps) {
    const [open, setOpen] = useState(false);
    const [index, setIndex] = useState(0);

    const total = images?.length ?? 0;
    const hasImages = total > 0;

    const slides = useMemo<SlideImage[]>(
        () =>
            (images ?? []).map((src, i) => ({
                src,
                alt: `Photo ${i + 1} of ${total} for ${address}`,
            })),
        [images, total, address],
    );

    const openAt = useCallback((i: number) => {
        setIndex(i);
        setOpen(true);
    }, []);

    const handleClose = useCallback(() => setOpen(false), []);

    if (!hasImages) {
        return (
            <div
                role="status"
                className="flex h-[400px] w-full items-center justify-center rounded-2xl bg-gray-100 text-gray-400"
            >
                <div className="text-center">
                    <ImageIcon className="mx-auto mb-2 h-12 w-12 opacity-50" />
                    <p className="text-sm">No photos available</p>
                </div>
            </div>
        );
    }

    const leadImage = images[0];
    const secondaryImages = images.slice(1, 3);
    const remainingCount = Math.max(0, total - 3);
    const heroSizes = '(min-width: 1024px) 66vw, 100vw';
    const secondarySizes = '(min-width: 1024px) 33vw, 100vw';

    return (
        <>
            {/*
              Hero layout:
              - Mobile: single 16:9 lead image with a "View N photos" overlay button.
              - Desktop (lg+): 2/3 lead + two stacked 1/3 secondaries.
            */}
            <div className="relative w-full">
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-3 lg:grid-rows-2">
                    {/* Lead image — 16:9 on mobile, spans 2 cols x 2 rows on desktop */}
                    <div className="relative aspect-[16/9] lg:col-span-2 lg:row-span-2 lg:aspect-auto">
                        <TileButton
                            src={leadImage}
                            alt={`Main view of ${address}`}
                            ariaLabel={`Open photo 1 of ${total}`}
                            sizes={heroSizes}
                            onClick={() => openAt(0)}
                            priority
                        />
                    </div>

                    {/* Secondary tiles — desktop only */}
                    {secondaryImages[0] && (
                        <div className="relative hidden aspect-[16/9] lg:block">
                            <TileButton
                                src={secondaryImages[0]}
                                alt={`Additional view of ${address}`}
                                ariaLabel={`Open photo 2 of ${total}`}
                                sizes={secondarySizes}
                                onClick={() => openAt(1)}
                            />
                        </div>
                    )}

                    {secondaryImages[1] && (
                        <div className="relative hidden aspect-[16/9] lg:block">
                            <TileButton
                                src={secondaryImages[1]}
                                alt={`Additional view of ${address}`}
                                ariaLabel={
                                    remainingCount > 0
                                        ? `Open photo gallery, ${remainingCount} more`
                                        : `Open photo 3 of ${total}`
                                }
                                sizes={secondarySizes}
                                onClick={() => openAt(2)}
                            >
                                {remainingCount > 0 && (
                                    <span
                                        aria-hidden="true"
                                        className="pointer-events-none absolute inset-x-0 bottom-0 flex h-1/2 items-end justify-center bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4"
                                    >
                                        <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                                            <ImageIcon className="h-4 w-4" />
                                            +{remainingCount} more
                                        </span>
                                    </span>
                                )}
                            </TileButton>
                        </div>
                    )}
                </div>

                {/* Mobile "View N photos" overlay */}
                <button
                    type="button"
                    onClick={() => openAt(0)}
                    className="absolute bottom-4 right-4 rounded-lg bg-white/90 px-4 py-2 text-sm font-medium text-gray-900 shadow-sm backdrop-blur-sm transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden"
                    aria-label={`View all ${total} photos`}
                >
                    <span className="inline-flex items-center gap-2">
                        <ImageIcon className="h-4 w-4" />
                        View {total} photo{total === 1 ? '' : 's'}
                    </span>
                </button>
            </div>

            {open && (
                <PhotoLightbox
                    open={open}
                    index={index}
                    slides={slides}
                    onClose={handleClose}
                    onIndexChange={setIndex}
                />
            )}
        </>
    );
}
