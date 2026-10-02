/** Deliberately small PostgREST-shaped boundary for the disconnected starter.
 * `any` is confined to this adapter because the historical UI has no generated DB types. */
export type LocalQuery = { table: string; operations: Array<[string, any[]]> };
export type LocalResult = { data: any; error: null | { message: string; code?: string }; count?: number | null };
export const LOCAL_ADMIN_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_USER = { id: LOCAL_ADMIN_ID, email: "owner@example.invalid", user_metadata: { full_name: "Administrateur local" }, app_metadata: { provider: "local-starter" } };
export const QUERY_METHODS = ["select", "eq", "neq", "in", "is", "not", "or", "order", "limit", "range", "single", "maybeSingle", "insert", "update", "upsert", "delete", "gte", "gt", "lte", "lt", "like", "ilike", "contains"];

export function createQueryClient(execute: (query: LocalQuery) => Promise<LocalResult>): any {
  const unsupported = async () => ({ data: null, error: { message: "Action indisponible dans le starter local déconnecté." } });
  return {
    from(table: string) {
      const query: LocalQuery = { table, operations: [] };
      let result: Promise<LocalResult> | undefined;
      const builder: any = {};
      for (const name of QUERY_METHODS) builder[name] = (...args: any[]) => {
        if (result) throw new Error("Requête déjà exécutée");
        query.operations.push([name, args]); return builder;
      };
      builder.then = (resolve: any, reject: any) => (result ||= execute(query)).then(resolve, reject);
      return builder;
    },
    auth: {
      getSession: async () => ({ data: { session: { user: LOCAL_USER, provider: "local-starter" } }, error: null }),
      getUser: async () => ({ data: { user: LOCAL_USER }, error: null }),
      // This is a local operator identity, never a hosted login or multi-user account.
      signOut: async () => ({ error: null }),
      signInWithPassword: unsupported, signUp: unsupported, updateUser: unsupported,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      admin: { getUserById: async () => ({ data: { user: { user_metadata: {} } }, error: null }), createUser: unsupported, deleteUser: unsupported, updateUserById: unsupported },
    },
    rpc(name:string, args:any={}) {
      const result = (async():Promise<LocalResult> => {
        if(name!=='get_crm_metrics')return unsupported();
        const leadQuery:LocalQuery={table:'crm_leads',operations:[['select',['*']]]};
        const spendQuery:LocalQuery={table:'crm_ad_spend_daily',operations:[['select',['*']]]};
        for(const [query,column] of [[leadQuery,'created_at'],[spendQuery,'spend_date']] as const){
          if(args.from_date)query.operations.push(['gte',[column,args.from_date]]);
          if(args.to_date)query.operations.push(['lte',[column,args.to_date+'T23:59:59.999Z']]);
        }
        const [leads,spending]=await Promise.all([execute(leadQuery),execute(spendQuery)]);
        if(leads.error||spending.error)return {data:null,error:leads.error||spending.error};
        const rows=leads.data||[],spend=(spending.data||[]).reduce((n:number,r:any)=>n+Number(r.spend||0),0);
        const booked=rows.filter((r:any)=>r.call_start_time).length,shown=rows.filter((r:any)=>['qualified','proposal_sent','won','lost'].includes(r.status)).length,won=rows.filter((r:any)=>r.status==='won').length;
        return {error:null,data:{lead_count:rows.length,booked_call_count:booked,shown_call_count:shown,no_show_count:rows.filter((r:any)=>r.status==='no_show').length,cancelled_count:rows.filter((r:any)=>r.status==='cancelled').length,won_count:won,spend,meta_reported_leads:(spending.data||[]).reduce((n:number,r:any)=>n+Number(r.meta_reported_leads||0),0),cost_per_lead:rows.length?spend/rows.length:null,cost_per_call:booked?spend/booked:null,show_rate:(shown+rows.filter((r:any)=>r.status==='no_show').length)?shown/(shown+rows.filter((r:any)=>r.status==='no_show').length)*100:null,sales_conversion_rate:shown?won/shown*100:null}};
      })();
      return Object.assign(result,{single:()=>result,maybeSingle:()=>result});
    },
    storage: { from: () => ({ upload: unsupported, remove: unsupported, createSignedUrl: unsupported, getPublicUrl: () => ({ data: { publicUrl: "" }, error: { message: "Stockage distant déconnecté" } }) }) },
    channel: () => { const channel: any = { on: () => channel, subscribe: () => channel, unsubscribe() {} }; return channel; },
    removeChannel: async () => "ok",
  };
}
