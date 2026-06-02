'use client';

import { useRef, useState } from 'react';

export function usePropertyExport() {
    const reportRef = useRef<HTMLDivElement>(null);
    const [exporting, setExporting] = useState(false);

    const exportPdf = async (address: string, onError: (message: string) => void) => {
        if (!reportRef.current) return;
        setExporting(true);

        try {
            const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
                import('html2canvas'),
                import('jspdf'),
            ]);

            const element = reportRef.current;
            element.style.display = 'block';

            const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                logging: false
            });

            element.style.display = 'none';

            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });

            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(`property-report-${address.replace(/\s+/g, '-').toLowerCase()}.pdf`);
        } catch (err) {
            console.error("PDF Export failed:", err);
            onError("Failed to generate PDF. Please try again.");
        } finally {
            setExporting(false);
        }
    };

    return { reportRef, exporting, exportPdf };
}
