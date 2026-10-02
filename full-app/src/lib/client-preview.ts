import { cookies } from 'next/headers';
import {createClient,createAdminClient} from './supabase-server';
import {getAdminScope} from './admin-scope';
import {authorizedClientPreview} from './client-preview-access';
export const PREVIEW_COOKIE='lf_preview_client_id';
export async function getPreviewClientId():Promise<string|null>{
 return authorizedClientPreview((await cookies()).get(PREVIEW_COOKIE)?.value??null,{getUser:()=>createClient().auth.getUser(),db:createAdminClient,scope:getAdminScope});
}
