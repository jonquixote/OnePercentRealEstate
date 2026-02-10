
export async function getHealth() {
    const res = await fetch('/api/health');
    if (!res.ok) {
        throw new Error('Health check failed');
    }
    return res.json();
}
