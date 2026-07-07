import { Loader2 } from 'lucide-react';

export default function Loading() {
    return (
        <div className="flex h-screen flex-col items-center justify-center gap-4" style={{ background: 'var(--ink)' }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--pass)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--haze)' }}>Loading property...</p>
        </div>
    );
}
