import { describe,it,expect,vi } from 'vitest';
import { TranscriptLedger,PhraseQueue } from '../src/live-core.ts';
import { LiveCapture } from '../src/live.ts';

describe('live transcript ordering and translation queue',()=>{
  it('shows partial text and reconciles final text without duplicate translations',()=>{
    let turns:ReturnType<TranscriptLedger['list']>=[];const finalized=vi.fn();const ledger=new TranscriptLedger(value=>{turns=value;},finalized);
    ledger.handle({type:'input_audio_buffer.committed',item_id:'first'});ledger.handle({type:'input_audio_buffer.committed',item_id:'second'});
    ledger.handle({type:'conversation.item.input_audio_transcription.delta',item_id:'first',delta:'Hello,'});expect(turns[0].text).toBe('Hello,');expect(finalized).not.toHaveBeenCalled();
    ledger.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'second',transcript:'Second phrase.'});ledger.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'first',transcript:'Hello, world.'});ledger.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'first',transcript:'Hello, world.'});
    expect(turns.map(t=>t.id)).toEqual(['first','second']);expect(turns[0].text).toBe('Hello, world.');expect(finalized).toHaveBeenCalledTimes(2);
  });
  it('limits concurrency, permits out-of-order completion, and drains after stop',async()=>{
    const releases=new Map<string,()=>void>();const begun:string[]=[];const counts:number[]=[];
    const queue=new PhraseQueue(async id=>{begun.push(id);await new Promise<void>(resolve=>releases.set(id,resolve));},n=>counts.push(n),()=>{},2);
    queue.push('a','First');queue.push('b','Second');queue.push('c','Third');queue.push('a','Duplicate');expect(begun).toEqual(['a','b']);expect(queue.count).toBe(3);
    releases.get('b')!();await new Promise(resolve=>setTimeout(resolve,0));expect(begun).toEqual(['a','b','c']);
    releases.get('a')!();releases.get('c')!();await queue.drain();expect(queue.count).toBe(0);expect(counts).toContain(3);
  });
  it('cancels active requests and marks queued phrases skipped',async()=>{
    const skipped=vi.fn();const queue=new PhraseQueue(async(_id,_text,signal)=>{await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));},()=>{},skipped,1);
    queue.push('a','a');queue.push('b','b');queue.cancel();await queue.drain();expect(skipped).toHaveBeenCalledWith(['b']);expect(queue.count).toBe(0);
  });
  it('stops queued work after a provider failure, without retrying',async()=>{
    const calls=vi.fn(async()=>{throw new Error('Provider failed');});const skipped=vi.fn();const queue=new PhraseQueue(calls,()=>{},skipped,1);queue.push('a','first');queue.push('b','second');await queue.drain();expect(calls).toHaveBeenCalledTimes(1);expect(skipped).toHaveBeenCalledWith(['b']);
  });
  it('propagates denied microphone permission without starting an API request',async()=>{
    const denied=new DOMException('Denied','NotAllowedError');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn().mockRejectedValue(denied)}});
    const capture=new LiveCapture({onEvent:()=>{},onLevel:()=>{},onError:()=>{}});await expect(capture.start('auto')).rejects.toBe(denied);expect(fetcher).not.toHaveBeenCalled();vi.unstubAllGlobals();
  });
  it('commits a last draft on stop and a local silence boundary, and releases resources on connection loss',async()=>{
    const stopped=vi.fn();const changes=vi.fn();const errors=vi.fn();
    class Channel{readyState='open';onopen:(()=>void)|null=null;onmessage:((event:{data:string})=>void)|null=null;onerror:(()=>void)|null=null;sent:string[]=[];close=vi.fn(()=>{this.readyState='closed';});emit(event:unknown){this.onmessage?.({data:JSON.stringify(event)});}send(data:string){this.sent.push(data);queueMicrotask(()=>{this.emit({type:'input_audio_buffer.committed',item_id:'last'});this.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'last',transcript:'Final phrase.'});});}}
    class Peer{static latest:Peer;channel=new Channel();connectionState='connected';onconnectionstatechange:(()=>void)|null=null;close=vi.fn();constructor(){Peer.latest=this;}addTrack(){}createDataChannel(){return this.channel;}async createOffer(){return {sdp:'test-offer'};}async setLocalDescription(){}async setRemoteDescription(){this.channel.onopen?.();}}
    let amplitude=0;
    class Context{createMediaStreamSource(){return {connect(){}};}createAnalyser(){return {fftSize:2048,getFloatTimeDomainData(values:Float32Array){values.fill(amplitude);}};}async close(){}}
    vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn().mockResolvedValue({getTracks:()=>[{stop:stopped}]})}});vi.stubGlobal('RTCPeerConnection',Peer);vi.stubGlobal('AudioContext',Context);
    const fetcher=vi.fn(async(url:string)=>url.startsWith('/api/')?new Response(JSON.stringify({value:'ephemeral-test-only'}),{headers:{'Content-Type':'application/json'}}):new Response('test-answer'));vi.stubGlobal('fetch',fetcher);
    const capture=new LiveCapture({onEvent:changes,onLevel:()=>{},onError:errors});await capture.start('auto');
    Peer.latest.channel.emit({type:'conversation.item.input_audio_transcription.delta',item_id:'last',delta:'Final'});
    expect(await capture.stop()).toBe(true);expect(stopped).toHaveBeenCalled();expect(Peer.latest.channel.close).toHaveBeenCalled();expect(Peer.latest.close).toHaveBeenCalled();expect(Peer.latest.channel.sent.map(s=>JSON.parse(s).type)).toEqual(['input_audio_buffer.commit']);expect(changes).toHaveBeenCalledWith(expect.objectContaining({transcript:'Final phrase.'}));expect(fetcher).toHaveBeenCalledTimes(2);expect(errors).not.toHaveBeenCalled();
    vi.useFakeTimers();
    try{
      const interrupted=new LiveCapture({onEvent:changes,onLevel:()=>{},onError:errors});await interrupted.start('auto');
      amplitude=0.1;await vi.advanceTimersByTimeAsync(500);amplitude=0;await vi.advanceTimersByTimeAsync(800);
      expect(Peer.latest.channel.sent.map(s=>JSON.parse(s).type)).toEqual(['input_audio_buffer.commit']);
      Peer.latest.connectionState='failed';Peer.latest.onconnectionstatechange?.();
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('interrupted'));expect(Peer.latest.close).toHaveBeenCalled();expect(Peer.latest.channel.close).toHaveBeenCalled();
    }finally{vi.useRealTimers();vi.unstubAllGlobals();}
  });
  it('releases a microphone that resolves after startup was cancelled',async()=>{
    let grant:(stream:unknown)=>void=()=>{};const stop=vi.fn();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(resolve=>{grant=resolve;})}});
    const capture=new LiveCapture({onEvent:()=>{},onLevel:()=>{},onError:()=>{}});const starting=capture.start('auto');capture.forceClose();grant({getTracks:()=>[{stop}]});await starting;expect(stop).toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();vi.unstubAllGlobals();
  });
});
