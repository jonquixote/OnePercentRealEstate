'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface ToastState {
    message: string;
    key: number;
}

export function useToast(timeoutMs = 3000) {
    const [toast, setToast] = useState<ToastState | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((message: string) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setToast({ message, key: Date.now() });
        timerRef.current = setTimeout(() => {
            setToast(null);
            timerRef.current = null;
        }, timeoutMs);
    }, [timeoutMs]);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const ToastView = toast ? (
        <div
            key={toast.key}
            role="alert"
            aria-live="polite"
            className="fixed bottom-6 right-6 z-[60] max-w-sm rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg ring-1 ring-slate-700 animate-in fade-in slide-in-from-bottom-2"
        >
            {toast.message}
        </div>
    ) : null;

    return { showToast, ToastView };
}
