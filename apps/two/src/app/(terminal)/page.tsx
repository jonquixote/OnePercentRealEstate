import { getSessionUser } from "@/lib/auth";
import { TerminalClient } from "@/components/TerminalClient";

/**
 * Server component: resolves the session tier here so the demo cap + banner
 * are driven by authoritative server state (not just client-side reactivity).
 * The actual terminal UI is a client component; we pass `isPro` + `tier` down.
 */
export default async function TerminalPage() {
  const session = await getSessionUser();
  const isPro = session?.tier === "pro";
  return <TerminalClient isPro={isPro} tier={session?.tier ?? null} />;
}
