import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm';

import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './supabase-config.js';
export {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
