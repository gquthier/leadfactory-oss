import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {authorizedClientPreview} from '../src/lib/client-preview-access';import {createLocalClient,localTransaction} from '../src/lib/starter-local-store';
test('forged preview cookie cannot change a client identity; admins need client scope',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'lf-preview-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));const options={dataDir};
 const viewer='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222';let superAdmin=false,assigned:string[]=[];
 await localTransaction(db=>db.tables.profiles.push({id:viewer,role:'client',is_active:true},{id:target,role:'client',is_active:true,managed_by:'other'}),options);
 const deps={getUser:async()=>({data:{user:{id:viewer}},error:null}),db:()=>createLocalClient(options),scope:async()=>({isSuperAdmin:superAdmin,adminId:viewer,assignedClientIds:assigned})};
 assert.equal(await authorizedClientPreview(target,deps),null);
 await localTransaction(db=>{db.tables.profiles.find(r=>r.id===viewer)!.role='admin';},options);
 assert.equal(await authorizedClientPreview(target,deps),null);
 assigned=[target];assert.equal(await authorizedClientPreview(target,deps),target);
 assigned=[];superAdmin=true;assert.equal(await authorizedClientPreview(target,deps),target);
 await localTransaction(db=>{db.tables.profiles.find(r=>r.id===viewer)!.is_active=false;},options);assert.equal(await authorizedClientPreview(target,deps),null);
 assert.equal(await authorizedClientPreview('invalid',deps),null);
 assert.equal(await authorizedClientPreview(target,{...deps,getUser:async()=>({data:{user:null},error:null})}),null);
});
