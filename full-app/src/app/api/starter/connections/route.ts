import {starterConnections as c} from '@/lib/starter-connections';
export const runtime='nodejs';
export async function GET(){return Response.json(await c.view());}
export async function POST(req:Request){try{const text=await req.text();if(text.length>8000)throw new Error('Requête trop longue.');const body=JSON.parse(text);if(body.action==='test')return Response.json(await c.test(body.service));if(body.action==='ai')await c.connectAI(body);else if(body.action==='remove')await c.remove(body.service);else await c.save(body);return Response.json(await c.view());}catch(e){return Response.json({error:e instanceof Error?e.message:'Connexion impossible.'},{status:400});}}
