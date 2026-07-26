import { getSessionUser } from "@/lib/auth";
import { TerminalClient } from "@/components/TerminalClient";
import { withSpan } from '@/lib/tracing';

/**
 * Server component: resolves the session tier here so the demo cap + banner
 * are driven by authoritative server state (not just client-side reactivity).
 * The actual terminal UI is a client component; we pass `isPro` down.
 */
export default async function TerminalPage() {
  return withSpan('two.terminal', () => renderTerminal());
}

async function renderTerminal() {
  const session = await getSessionUser();
  const isPro = session?.tier === "pro";
  return <TerminalClient isPro={isPro} />;
}
