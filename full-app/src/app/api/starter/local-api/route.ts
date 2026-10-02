import {autoOnboarding} from '@/lib/starter-agents';
import {handleLocalApi} from '@/lib/starter-local-api';
export const runtime='nodejs';
const handler=async(request:Request)=>{const path=new URL(request.url).searchParams.get('path')??'';const response=await handleLocalApi(request,path);
 if(response.ok&&request.method==='POST'&&['/api/onboarding/submit','/api/onboarding/finalize'].includes(path)){const data=await response.clone().json();try{const job=await autoOnboarding(data);return Response.json({...data,agent_job_id:job?.id??null});}catch(e){return Response.json({...data,agent_error:e instanceof Error?e.message:'Mission non démarrée.'});}}
 return response;};
export {handler as GET,handler as POST,handler as PUT,handler as PATCH,handler as DELETE};
