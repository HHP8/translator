export interface TranscriptTurn { id:string; text:string; final:boolean; order:number; committed:boolean }
export class TranscriptLedger {
  private turns=new Map<string,TranscriptTurn>(); private seen=0;private commitOrder=0;private completed=new Set<string>();
  constructor(private onChange:(turns:TranscriptTurn[])=>void,private onFinal:(id:string,text:string)=>void){}
  handle(event:Record<string,unknown>){
    const type=event.type; const id=typeof event.item_id==='string'?event.item_id:undefined;
    if(!id)return;
    if(!['input_audio_buffer.committed','conversation.item.input_audio_transcription.delta','conversation.item.input_audio_transcription.completed','conversation.item.input_audio_transcription.failed'].includes(String(type)))return;
    let turn=this.turns.get(id);
    if(!turn){turn={id,text:'',final:false,order:1_000_000+this.seen++,committed:false};this.turns.set(id,turn);}
    if(type==='input_audio_buffer.committed'&&!turn.committed){turn.order=this.commitOrder++;turn.committed=true;}
    if(type==='conversation.item.input_audio_transcription.delta'&&!turn.final&&typeof event.delta==='string')turn.text+=event.delta;
    let finalized=false;
    if(type==='conversation.item.input_audio_transcription.completed'&&typeof event.transcript==='string'){
      turn.text=event.transcript;turn.final=true;
      if(!this.completed.has(id)){this.completed.add(id);finalized=true;}
    }
    this.onChange(this.list());
    if(finalized&&turn.text.trim())this.onFinal(id,turn.text);
  }
  list(){return [...this.turns.values()].sort((a,b)=>a.order-b.order);}
}
export class PhraseQueue {
  private pending:{id:string;text:string}[]=[];private active=new Map<string,AbortController>();private waiters:(()=>void)[]=[];private seen=new Set<string>();private stopped=false;
  constructor(private run:(id:string,text:string,signal:AbortSignal)=>Promise<void>,private onCount:(n:number)=>void,private onSkipped:(ids:string[])=>void,private concurrency=2){}
  get count(){return this.pending.length+this.active.size;}
  push(id:string,text:string){if(this.seen.has(id))return;this.seen.add(id);if(this.stopped){this.onSkipped([id]);return;}this.pending.push({id,text});this.pump();}
  private pump(){
    while(this.active.size<this.concurrency&&this.pending.length&&!this.stopped){
      const job=this.pending.shift()!;const controller=new AbortController();this.active.set(job.id,controller);
      void this.run(job.id,job.text,controller.signal).catch(()=>{
        this.stopped=true;const skipped=this.pending.splice(0).map(j=>j.id);this.onSkipped(skipped);
      }).finally(()=>{this.active.delete(job.id);this.onCount(this.count);this.pump();this.resolveDrain();});
    }
    this.onCount(this.count);this.resolveDrain();
  }
  private resolveDrain(){if(!this.count){for(const resolve of this.waiters.splice(0))resolve();}}
  drain(){return this.count?new Promise<void>(resolve=>this.waiters.push(resolve)):Promise.resolve();}
  cancel(){this.stopped=true;this.onSkipped(this.pending.splice(0).map(j=>j.id));for(const c of this.active.values())c.abort();this.resolveDrain();}
}
