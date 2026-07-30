// Rendered when the property page calls notFound() — a listing that exists in
// neither the live table nor the archive. Route-level so the 404 keeps the site
// chrome and dark background instead of Next's bare default, while still
// returning a real 404 status (the whole point: crawlers must be able to drop
// nonexistent URLs).
import Link from 'next/link';

export default function PropertyNotFound() {
    return (
        <div className="flex h-screen flex-col items-center justify-center gap-4" style={{ background: 'var(--ink)' }}>
            <p className="text-muted-foreground">This property could not be found.</p>
            <Link href="/search" className="underline text-muted-foreground">
                Back to search
            </Link>
        </div>
    );
}
