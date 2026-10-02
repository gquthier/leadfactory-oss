/** A preview cookie is only a requested target, never proof of an admin session. */
export async function authorizedClientPreview(targetId:string|null, deps:{getUser:()=>Promise<any>;db:()=>any;scope:(id:string)=>Promise<{isSuperAdmin:boolean;adminId:string;assignedClientIds:string[]}>}):Promise<string|null>{
 if(!targetId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(targetId))return null;
 const {data,error}=await deps.getUser();if(error||!data?.user?.id)return null;
 const viewerId=data.user.id,db=deps.db();
 const {data:viewer,error:viewerError}=await db.from('profiles').select('role,is_active').eq('id',viewerId).single();
 if(viewerError||viewer?.role!=='admin'||viewer.is_active===false)return null;
 const {data:target,error:targetError}=await db.from('profiles').select('id,role,is_active,managed_by').eq('id',targetId).single();
 if(targetError||target?.role!=='client'||target.is_active===false)return null;
 const scope=await deps.scope(viewerId);
 return scope.isSuperAdmin||target.managed_by===viewerId||scope.assignedClientIds.includes(targetId)?targetId:null;
}
