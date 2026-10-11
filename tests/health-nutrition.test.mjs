import test from 'node:test';
import assert from 'node:assert/strict';
import { createNutritionSync, nutritionPayload } from '../js/health-nutrition.js';
const meal = { id:'one', date:'2026-10-11', title:'Еда', calories:500, protein:20, fat:10, carbs:60 };
function setup() {
  const data = new Map();
  const writes = [];
  let uid = 'a', date = '2026-10-11', granted = true, fail = false, hold;
  const storage = { getItem:key=>data.get(key) || null, setItem:(key,value)=>data.set(key,value) };
  const plugin = { getStatus:async()=>({nutritionGranted:granted}), writeNutrition:async operation=>{if(hold)await hold;if(fail)throw Error();writes.push(operation)} };
  const make = () => createNutritionSync({storage, owner:()=>uid, plugin:()=>plugin, today:()=>date});
  return { sync:make(), make, writes, storage, setUid:value=>uid=value, setDate:value=>date=value, deny:()=>granted=false, allow:()=>granted=true, fail:()=>fail=true, recover:()=>fail=false, hold:promise=>hold=promise };
}
test('nutrition validation preserves totals and rejects invalid dates/numbers',()=>{
  assert.equal(nutritionPayload(meal).calories,500);
  assert.equal(nutritionPayload({...meal,date:'2026-02-30'}),null);
  assert.equal(nutritionPayload({...meal,protein:-1}),null);
  assert.equal(nutritionPayload({...meal,calories:Infinity}),null);
});
test('default off, explicit enable, permission denial, durable retry and deletion',async()=>{
  const ctx=setup();
  ctx.sync.enqueue({owner:'a',entry:meal});
  assert.equal(ctx.sync.status().pending,0);
  ctx.sync.setEnabled(true);ctx.deny();
  ctx.sync.enqueue({owner:'a',entry:meal});await ctx.sync.flush();
  assert.equal(ctx.writes.length,0);assert.equal(ctx.sync.status().pending,1);
  ctx.allow();ctx.fail();await ctx.sync.flush();
  assert.equal(ctx.sync.status().pending,1);
  ctx.recover();const restarted=ctx.make();await restarted.flush();
  assert.equal(ctx.writes.length,1);assert.equal(restarted.status().pending,0);
  restarted.enqueue({owner:'a',deleted:true,id:'one'});await restarted.flush();
  assert.equal(ctx.writes[1].deleted,true);assert.equal(ctx.writes[1].id,'one');
});
test('pending changes coalesce per ID; future meals wait until their day',async()=>{
  const ctx=setup();ctx.sync.setEnabled(true);ctx.deny();
  ctx.sync.enqueue({owner:'a',entry:meal});await ctx.sync.flush();
  ctx.sync.enqueue({owner:'a',entry:{...meal,calories:600}});await ctx.sync.flush();
  assert.equal(ctx.sync.status().pending,1);ctx.allow();await ctx.sync.flush();
  assert.equal(ctx.writes[0].entry.calories,600);
  ctx.sync.enqueue({owner:'a',entry:{...meal,id:'tomorrow',date:'2026-10-12'}});await ctx.sync.flush();
  assert.equal(ctx.writes.length,1);ctx.setDate('2026-10-12');await ctx.sync.flush();
  assert.equal(ctx.writes.length,2);
});
test('late acknowledgement does not discard a newer edit; accounts are isolated',async()=>{
  const ctx=setup();ctx.sync.setEnabled(true);
  let release;ctx.hold(new Promise(resolve=>release=resolve));
  ctx.sync.enqueue({owner:'a',entry:meal});
  await new Promise(resolve=>setTimeout(resolve,0));
  ctx.sync.enqueue({owner:'a',entry:{...meal,calories:700}});
  release();await ctx.sync.flush();
  assert.equal(ctx.writes.length,2);assert.equal(ctx.writes[1].entry.calories,700);
  assert.ok(ctx.writes[1].version>ctx.writes[0].version);
  ctx.setUid('b');assert.equal(ctx.sync.status().enabled,false);
  await ctx.sync.flush();assert.equal(ctx.writes.length,2);
});
test('disable cancels pending exports without writing or deleting existing records',async()=>{
  const ctx=setup();ctx.sync.setEnabled(true);ctx.deny();
  ctx.sync.enqueue({owner:'a',entry:meal});await ctx.sync.flush();
  ctx.sync.setEnabled(false);ctx.allow();await ctx.sync.flush();
  assert.equal(ctx.sync.status().pending,0);assert.equal(ctx.writes.length,0);
});
