import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm';

export const SUPABASE_URL = 'https://pvfrlirjdauncoudkomu.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__f4s5z5TGb-_GUCx1U4jIg_zn8wnu84';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
