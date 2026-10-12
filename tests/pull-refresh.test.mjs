import test from 'node:test';
import assert from 'node:assert/strict';
import { initPullRefresh } from '../js/pull-refresh.js';

function harness(refresh, platform='android') {
  const handlers=new Map(), results=[];
  const indicator={hidden:true,style:{},setAttribute(){},remove(){}};
  const doc={body:{append(){}},scrollingElement:{scrollTop:0},createElement:()=>indicator,querySelector:()=>null,
    addEventListener:(type,fn)=>handlers.set(type,fn),removeEventListener:type=>handlers.delete(type)};
  const win={scrollY:0,Capacitor:{getPlatform:()=>platform}};
  const cleanup=initPullRefresh({refresh,onResult:e=>results.push(e),doc,win});
  const event=(x,y)=>({touches:[{clientX:x,clientY:y}],target:{closest:()=>null},cancelable:true,preventDefault(){this.prevented=true;}});
  const drag=(distance)=>{handlers.get('touchstart')?.(event(20,20));handlers.get('touchmove')?.(event(20,20+distance));};
  return {handlers,indicator,results,doc,win,event,drag,cleanup};
}
test('long downward pull at top refreshes once and leaves page intact; short pull does not', async()=>{
  let calls=0,finish;
  const h=harness(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  h.drag(50);await h.handlers.get('touchend')();assert.equal(calls,0);
  h.drag(140);assert.match(h.indicator.textContent,/Отпустите/);
  const pending=h.handlers.get('touchend')();assert.equal(calls,1);
  h.drag(150);await h.handlers.get('touchend')();assert.equal(calls,1);
  finish();await pending;assert.equal(h.indicator.hidden,true);assert.deepEqual(h.results,[null]);
  h.cleanup();assert.equal(h.handlers.size,0);
});
test('scrolled pages, horizontal swipes, forms and dialogs cannot trigger refresh; network error is reported', async()=>{
  let calls=0;const error=new Error('offline');const h=harness(async()=>{calls++;throw error;});
  h.win.scrollY=100;h.drag(160);await h.handlers.get('touchend')();assert.equal(calls,0);
  h.win.scrollY=0;h.handlers.get('touchstart')(h.event(20,20));h.handlers.get('touchmove')(h.event(220,40));await h.handlers.get('touchend')();assert.equal(calls,0);
  const event=h.event(20,20);event.target.closest=()=>({});h.handlers.get('touchstart')(event);h.handlers.get('touchmove')(h.event(20,200));await h.handlers.get('touchend')();assert.equal(calls,0);
  h.doc.querySelector=()=>({});h.drag(150);await h.handlers.get('touchend')();assert.equal(calls,0);
  h.doc.querySelector=()=>null;h.drag(150);await h.handlers.get('touchend')();assert.equal(calls,1);assert.equal(h.results[0],error);assert.equal(h.indicator.hidden,true);
});
test('browser keeps its own scrolling behavior',()=>{const h=harness(()=>{throw Error('must not run');},'web');assert.equal(h.handlers.size,0);});
