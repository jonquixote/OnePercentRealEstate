import { Loader2 } from 'lucide-react';

export default function Loading() {
    return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-50">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            <p className="text-gray-500 text-sm font-medium">Loading...</p>
        </div>
    );
}
