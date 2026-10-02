import {agentView,recruit,addSource,enqueue,stopJob,recoverJobs} from '@/lib/starter-agents';
export const runtime='nodejs';
export async function GET(){await recoverJobs();return Response.json(await agentView());}
export async function POST(req:Request){try{const raw=await req.text();if(raw.length>30000)throw new Error('Requête trop longue.');const b=JSON.parse(raw);if(b.action==='recruit')await recruit(b.role);else if(b.action==='source')await addSource(b);else if(b.action==='stop')await stopJob(b.id);else if(b.action==='run')await enqueue(b);else throw new Error('Action inconnue.');return Response.json(await agentView());}catch(e){return Response.json({error:e instanceof Error?e.message:'Action impossible.'},{status:400});}}
