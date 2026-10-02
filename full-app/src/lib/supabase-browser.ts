import {createBrowserClient} from '@supabase/ssr';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createLocalBrowserClient} from './starter-local-browser';
export function createClient():SupabaseClient {
 if(process.env.NEXT_PUBLIC_LEADFACTORY_DATA_MODE!=='supabase')return createLocalBrowserClient() as unknown as SupabaseClient;
 return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
