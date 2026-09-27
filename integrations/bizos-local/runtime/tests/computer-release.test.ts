import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BoatClient, CloudComputer } from "../src/computer/cloud.js";
import { ComputerManager } from "../src/computer/manager.js";
import { handleLocalTeamMessage } from "../src/local-team-mcp.js";
beforeEach(()=>vi.stubEnv("BIZOS_LOCAL_COMPUTER_ENABLED", ""));
afterEach(()=>vi.unstubAllEnvs());
it("refuses all Boat effects before fetch, preserves explicit stop",async()=>{
 const fetchImpl=vi.fn(async()=>Response.json({ok:true})); const client=new BoatClient("test",{fetchImpl});
 for(const invoke of [()=>client.create({type:"small",ttlSeconds:3600,noEnv:true},"id"),()=>client.get("id"),()=>client.resume("id",{ttlSeconds:3600}),()=>client.command("id","x",1),()=>client.desktop("id"),()=>client.writeFile("id","x","x"),()=>client.host("id",80,{title:"x",public:true})]) await expect(invoke()).rejects.toThrow("unavailable in this release");
 expect(fetchImpl).not.toHaveBeenCalled(); await client.stop("id");expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it("configured paid machine status and stale tool calls cause no provider work while off",async()=>{
 const fetchImpl=vi.fn(); const writeJson=vi.fn();
 const machine=new CloudComputer({storage:{readJson:()=>null,writeJson},isAllowed:()=>true,environment:()=>({BOAT_API_KEY:"test"}),fetchImpl});
 expect(await machine.allowed()).toBe(false);
 for(const invoke of [()=>machine.wake(),()=>machine.desktop(),()=>machine.run("a","x"),()=>machine.writeFile("x","x"),()=>machine.execAwake("id","x",1)])await expect(invoke()).rejects.toThrow("unavailable in this release");
 expect((await machine.status()).allowed).toBe(false);
 expect(await machine.tool("a","cloud_computer_run",{command:"x"})).toMatchObject({ok:false,error:"computer_disabled"});expect(fetchImpl).not.toHaveBeenCalled();expect(writeJson).not.toHaveBeenCalled();
});
it("native manager cannot start, capture or drive an agent surface while off",async()=>{
 const effect=vi.fn(); const manager=new ComputerManager({backend:{kind:"native",start:effect,capture:effect,state:effect,dispose:()=>{},disposeAll:()=>{}} as any,approvals:{} as any,workspaceFor:()=>"/tmp/test",nowIso:()=>"test",publish:effect});
 expect(manager.state("a")).toMatchObject({backend:"none",status:"none"});
 await expect(manager.setUp("a")).rejects.toThrow("unavailable in this release");
 await expect(manager.observe("a")).rejects.toThrow("unavailable in this release");
 expect(await manager.frame("a")).toBeNull();manager.watch("a",true);expect(effect).not.toHaveBeenCalled();manager.stop();
});
it("MCP omits all computer tools and refuses forged old calls before injected handlers",async()=>{
 const computer=vi.fn();const cloud=vi.fn();const options={computer,cloud,toolsets:new Set(["team","computer"])};
 const list=await handleLocalTeamMessage({id:1,method:"tools/list"},undefined,undefined,undefined,undefined,options);
 const names=(list!.result as any).tools.map((t:any)=>t.name);
 expect(names.some((name:string)=>name.startsWith("computer_")||name.startsWith("cloud_computer_")||name==="cloud_browser_fetch")).toBe(false);
 expect(names).toContain("recruit_agent");expect(names).toContain("schedule_routine");
 for(const name of ["computer_observe","computer_act","cloud_computer_run","cloud_computer_wake","cloud_browser_fetch"]){const r=await handleLocalTeamMessage({id:2,method:"tools/call",params:{name,arguments:{}}},undefined,undefined,undefined,undefined,options);expect((r!.result as any).isError).toBe(true);}
 expect(computer).not.toHaveBeenCalled();expect(cloud).not.toHaveBeenCalled();
});

it("withdrawal still disposes existing native surfaces and suppresses late frames",()=>{
 const dispose=vi.fn();const disposeAll=vi.fn();const publish=vi.fn();
 const manager=new ComputerManager({backend:{kind:"native",dispose,disposeAll} as any,approvals:{} as any,workspaceFor:()=>"/tmp/test",nowIso:()=>"test",publish});
 manager.dispose("a");manager.stop();expect(dispose).toHaveBeenCalledWith("a");expect(disposeAll).toHaveBeenCalledTimes(1);expect(publish).not.toHaveBeenCalled();
});
