'use client';

import Lightbox, { type SlideImage } from 'yet-another-react-lightbox';
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';

import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/thumbnails.css';
import 'yet-another-react-lightbox/plugins/counter.css';

export interface PhotoLightboxProps {
    open: boolean;
    index: number;
    slides: SlideImage[];
    onClose: () => void;
    onIndexChange?: (i: number) => void;
}

/**
 * Lightbox shell. Lives in its own module so the parent can pull it in via
 * next/dynamic — the lightbox core, plugins, and CSS all ship in a single
 * async chunk that only loads when the user opens the gallery.
 */
export default function PhotoLightbox({
    open,
    index,
    slides,
    onClose,
    onIndexChange,
}: PhotoLightboxProps) {
    return (
        <Lightbox
            open={open}
            close={onClose}
            index={index}
            on={{
                view: ({ index: i }) => {
                    if (onIndexChange) onIndexChange(i);
                },
            }}
            slides={slides}
            plugins={[Thumbnails, Counter, Fullscreen, Zoom]}
            animation={{ fade: 300, swipe: 250 }}
            carousel={{ finite: slides.length <= 1 }}
            controller={{ closeOnBackdropClick: true }}
            thumbnails={{
                position: 'bottom',
                width: 100,
                height: 70,
                border: 0,
                borderRadius: 6,
                padding: 4,
                gap: 8,
            }}
            counter={{ container: { style: { top: 'unset', bottom: 0 } } }}
            zoom={{
                maxZoomPixelRatio: 3,
                scrollToZoom: true,
                doubleTapDelay: 300,
                doubleClickDelay: 300,
            }}
            styles={{
                container: { backgroundColor: 'rgba(0, 0, 0, 0.95)' },
            }}
        />
    );
}
