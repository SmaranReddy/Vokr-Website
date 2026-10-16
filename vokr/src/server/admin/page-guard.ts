import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { clientEnv } from "@/lib/env";

import { resolveAdmin } from "./guard";

/**
 * The second check for `/admin` pages (the proxy is the first, and the only
 * one that can still return a real 404 status — see `src/proxy.ts`). Reads
 * the session from cookies; Server Components cannot write cookies, and the
 * proxy has already refreshed them on this request.
 */
export async function requireAdminPage(): Promise<{ adminId: string; actor: string }> {
  // Read cookies first: it is what makes every admin page dynamic, even in
  // a build with no Supabase configuration (which would otherwise
  // prerender a static 404).
  const cookieStore = await cookies();
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) notFound();
  const supabase = createServerClient(url, anonKey, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
  });
  try {
    const { adminId } = await resolveAdmin(supabase);
    return { adminId, actor: `admin:${adminId}` };
  } catch {
    notFound();
  }
}
