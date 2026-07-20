'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePrefs } from '@/lib/prefs';
import { useSessionLoaded, useSessionUser } from '@/lib/useSessionUser';
import { WizardSteps } from '@/components/onboarding/WizardSteps';

export default function WelcomePage() {
  const router = useRouter();
  const { prefs, loading, save } = usePrefs();
  const user = useSessionUser();
  const sessionLoaded = useSessionLoaded();

  // Signed out (after session resolves) → send to login, preserving the return path.
  useEffect(() => {
    if (!loading && sessionLoaded && !user) {
      router.replace('/login?next=/welcome');
    }
  }, [loading, sessionLoaded, user, router]);

  if (loading || !sessionLoaded) {
    return <div className="min-h-screen flex items-center justify-center text-haze">Loading…</div>;
  }

  // Signed out → nothing to render (redirect handled above).
  if (!user) {
    return null;
  }

  // Already onboarded → no loop, just a gentle panel.
  if (prefs.onboarded === true) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">You&apos;re set up</h1>
        <p className="text-haze text-sm">Your prefs are saved and your deals are ready.</p>
        <div className="flex gap-3">
          <Link href="/account#presets" className="rounded-full border border-pass px-4 py-2 text-sm text-pass hover:bg-pass/10">
            Edit your prefs
          </Link>
          <Link href="/search" className="rounded-full bg-pass px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            Browse deals
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <WizardSteps prefs={prefs} save={save} />
      </div>
    </div>
  );
}
