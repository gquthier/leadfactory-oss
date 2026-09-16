import { describe, expect, it, vi } from "vitest";
import { CollaborationFacade } from "../src/sidecar.js";
function facade(state: string) {
 const invoke=vi.fn(async (channel:string) => {
  if(channel==="lbz:runs:get") return {id:"run_abc",threadId:"bot:bot_abc",state};
  if(channel==="lbz:threads:get") return {messages:[{blocks:[{kind:"ask",runId:"run_abc",askId:"ask_abc",requestType:"permission",tool:"computer",summary:"Read QA app",status:"pending"}]}]};
  if(channel==="lbz:threads:answer") return;
  throw Error("Unexpected side effect: "+channel);
 });
 const f=Object.create(CollaborationFacade.prototype) as CollaborationFacade;
 Object.assign(f,{instanceId:"qa",invoke,getRun:vi.fn(async()=>({state}))});
 return {f,invoke};
}
describe("terminal local approvals",()=>{
 for(const state of ["completed","cancelled","failed"]) it(`${state} expires legacy pending cards and cannot answer or stop another run`,async()=>{
  const {f,invoke}=facade(state);const id="local:qa:run:run_abc";
  expect((await f.approvals(id)).approvals[0].status).toBe("expired");
  await expect(f.answer(id,{askId:"ask_abc",answer:{kind:"allow_once"}})).rejects.toMatchObject({status:409,code:"run_finished"});
  await f.cancel(id);
  expect(invoke.mock.calls.some(([c])=>c==="lbz:threads:answer"||c==="lbz:threads:stop")).toBe(false);
 });
 it("keeps active waiting requests actionable",async()=>{
  const {f,invoke}=facade("waiting_input");const id="local:qa:run:run_abc";
  expect((await f.approvals(id)).approvals[0].status).toBe("pending");
  await f.answer(id,{askId:"ask_abc",answer:{kind:"deny"}});
  expect(invoke.mock.calls.some(([c])=>c==="lbz:threads:answer")).toBe(true);
 });
});
