import {isLocalHost,isLocalOrigin} from '@/lib/starter-origin';
import {NextResponse, type NextRequest} from 'next/server';
export function middleware(req:NextRequest){
 const local=process.env.LEADFACTORY_DATA_MODE!=='supabase';
 const path=req.nextUrl.pathname;
 if(local){
  // This administrative local starter is never a public multi-user portal.
  const host=req.headers.get('host')??'';
  if(!isLocalHost(host))return NextResponse.json({error:'Starter local : accès loopback uniquement.'},{status:403});
  const origin=req.headers.get('origin');
  if(req.method!=='GET'&&req.method!=='HEAD'&&(!isLocalOrigin(host,origin)||req.headers.get('sec-fetch-site')==='cross-site'))return NextResponse.json({error:'Origine refusée.'},{status:403});
  if(path.startsWith('/api/')&&!path.startsWith('/api/starter/')){
   const url=new URL(req.nextUrl.pathname+req.nextUrl.search,`http://${host}`);url.pathname='/api/starter/local-api';url.searchParams.set('path',path);return NextResponse.rewrite(url);
  }
  if(path==='/login')return NextResponse.redirect(new URL('/admin/start-here',req.url));
 }else{
  if(path.startsWith('/api/starter/'))return NextResponse.json({error:'Configuration du starter accessible uniquement en mode local.'},{status:403});
  if(path.startsWith('/api/')&&process.env.LEADFACTORY_ENABLE_EXTERNAL!=='1')return NextResponse.json({error:'Services externes désactivés. Configurer et valider vos propres comptes dans Start Here.'},{status:503});
 }
 return NextResponse.next();
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
