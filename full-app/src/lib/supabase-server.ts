import {createServerClient, type CookieOptions} from '@supabase/ssr';
import {createClient as supabaseClient, type SupabaseClient} from '@supabase/supabase-js';
import {cookies} from 'next/headers';
import {createLocalClient} from './starter-local-store';
export function isLocalStarter(){return process.env.LEADFACTORY_DATA_MODE!=='supabase';}
function remoteConfig(){
 if(process.env.LEADFACTORY_CONNECT_DATABASE!=='1')throw new Error('Connexion distante désactivée. Lire Start Here et utiliser un projet personnel vide.');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)throw new Error('Configurer votre propre projet Supabase.');return {url,key};
}
export function createClient():SupabaseClient {
 if(isLocalStarter())return createLocalClient() as unknown as SupabaseClient;
 const {url,key}=remoteConfig();
 return createServerClient(url,key,{cookies:{getAll:async()=>(await cookies()).getAll(),setAll:async (values:{name:string;value:string;options:CookieOptions}[])=>{try{const jar=await cookies();values.forEach(({name,value,options})=>jar.set(name,value,options));}catch{}}}});
}
export function createAdminClient():SupabaseClient {
 if(isLocalStarter())return createLocalClient() as unknown as SupabaseClient;
 const {url}=remoteConfig(),key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw new Error('Configurer la clé serveur de votre propre projet.');
 return supabaseClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}
