import {handleLocalQuery} from '@/lib/starter-local-api';
export const runtime='nodejs';
export async function POST(request:Request){return handleLocalQuery(request);}
