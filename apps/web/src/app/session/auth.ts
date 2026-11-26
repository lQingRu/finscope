import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseUrl } from "../../config/env";

function configureAuth(): SupabaseClient | undefined {
  const url = supabaseUrl;
  const key = supabasePublishableKey;
  if (!url || !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key ?? "")) {
    return undefined;
  }

  const project = URL.parse(url);
  if (!project || project.protocol !== "https:" || project.origin !== url) {
    return undefined;
  }

  return createClient(url, key, {
    auth: { flowType: "pkce", detectSessionInUrl: true },
  });
}

export const auth = configureAuth()?.auth;
