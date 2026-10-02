const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
export function isLocalHost(host:string){return LOOPBACK.test(host);}
/** Next normalizes loopback hostnames during rewrites. Trust only loopback at the same port. */
export function isLocalOrigin(host:string,origin:string|null){
 if(!isLocalHost(host))return false;if(!origin)return true;
 try{const expected=new URL('http://'+host),actual=new URL(origin);return actual.protocol==='http:'&&isLocalHost(actual.host)&&actual.port===expected.port&&actual.origin===origin&&!actual.username&&!actual.password;}catch{return false;}
}
