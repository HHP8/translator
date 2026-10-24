import { apiJson } from './api.ts';
export interface LiveCallbacks { onEvent:(event:Record<string,unknown>)=>void;onLevel:(level:number)=>void;onError:(message:string)=>void }
export class LiveCapture {
  private pc:RTCPeerConnection|null=null;private stream:MediaStream|null=null;private dc:RTCDataChannel|null=null;private context:AudioContext|null=null;
  private interval:ReturnType<typeof setInterval>|null=null;private controller=new AbortController();private ended=false;
  private speech=false;private lastSpeech=0;private speechStart=0;private commits=0;private finalized=new Set<string>();private committed=new Set<string>();private stopping:Promise<boolean>|null=null;
  constructor(private callbacks:LiveCallbacks){}
  async start(source:string){
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone support is unavailable in this browser. Open the local app in Edge or Chrome, or upload a recording.');
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(this.ended){this.stream.getTracks().forEach(t=>t.stop());return;}
      const secret=await apiJson<{value:string}>('/api/realtime/client-secret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source}),signal:this.controller.signal});
      if(this.ended)return;
      this.pc=new RTCPeerConnection();for(const track of this.stream.getTracks())this.pc.addTrack(track,this.stream);
      this.dc=this.pc.createDataChannel('oai-events');
      this.dc.onmessage=({data})=>{
        let event:Record<string,unknown>;try{event=JSON.parse(data);}catch{this.callbacks.onError('The live connection returned an invalid event.');return;}
        if(event.type==='input_audio_buffer.committed')this.committed.add(String(event.item_id));
        if(event.type==='conversation.item.input_audio_transcription.delta'&&!this.committed.has(String(event.item_id))){const now=performance.now();if(!this.speech)this.speechStart=now;this.speech=true;this.lastSpeech=now;}
        if(event.type==='conversation.item.input_audio_transcription.completed'||event.type==='conversation.item.input_audio_transcription.failed'){
          const id=String(event.item_id);if(!this.finalized.has(id)){this.finalized.add(id);this.commits=Math.max(0,this.commits-1);}
        }
        this.callbacks.onEvent(event);
        if(event.type==='error'||event.type==='conversation.item.input_audio_transcription.failed')this.callbacks.onError('Live transcription could not finish. Your received text is preserved.');
      };
      this.pc.onconnectionstatechange=()=>{if(!this.ended&&['failed','disconnected'].includes(this.pc?.connectionState||'')){this.callbacks.onError('The microphone connection was interrupted. Restart Live Voice when ready.');this.forceClose();}};
      const open=new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('The live connection did not open. Try again when ready.')),15_000);
        this.dc!.onopen=()=>{clearTimeout(timer);resolve();};
        this.dc!.onerror=()=>{clearTimeout(timer);reject(new Error('The live connection failed.'));};
        this.controller.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});
      });
      // Observe an early data-channel failure while the SDP request is in progress.
      void open.catch(()=>{});
      const offer=await this.pc.createOffer();await this.pc.setLocalDescription(offer);
      const response=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${secret.value}`,'Content-Type':'application/sdp'},body:offer.sdp,signal:this.controller.signal});
      if(!response.ok)throw new Error('OpenAI could not start this transcription session. Check model access in your project.');
      await this.pc.setRemoteDescription({type:'answer',sdp:await response.text()});await open;
      if(!this.ended)this.monitorSpeech();
    }catch(error){this.forceClose();throw error;}
  }
  private monitorSpeech(){
    this.context=new AudioContext();const input=this.context.createMediaStreamSource(this.stream!);const analyser=this.context.createAnalyser();analyser.fftSize=2048;input.connect(analyser);
    const samples=new Float32Array(analyser.fftSize);let baseline=0;let measurements=0;const started=performance.now();
    this.interval=setInterval(()=>{
      analyser.getFloatTimeDomainData(samples);let sum=0;for(const sample of samples)sum+=sample*sample;const rms=Math.sqrt(sum/samples.length);this.callbacks.onLevel(Math.min(1,rms*7));
      const now=performance.now();
      if(now-started<400){baseline+=rms;measurements++;}
      // Client-side VAD: gpt-live-transcribe does not support server_vad.
      const threshold=now-started<400?0.012:Math.max(0.012,Math.min(0.035,(baseline/Math.max(measurements,1))*2.5));
      if(rms>threshold){if(!this.speech)this.speechStart=now;this.speech=true;this.lastSpeech=now;}
      if(this.speech&&((now-this.lastSpeech>700)||(now-this.speechStart>12_000)))this.commit();
    },50);
  }
  private commit(){if(this.dc?.readyState==='open'&&this.speech){this.commits++;this.dc.send(JSON.stringify({type:'input_audio_buffer.commit'}));this.speech=false;}}
  stop():Promise<boolean>{
    if(this.stopping)return this.stopping;
    this.stopping=(async()=>{
      if(this.interval){clearInterval(this.interval);this.interval=null;}
      this.commit();this.stream?.getTracks().forEach(t=>t.stop());this.callbacks.onLevel(0);
      const started=Date.now();while(this.commits>0&&Date.now()-started<5000&&this.dc?.readyState==='open')await new Promise(resolve=>setTimeout(resolve,50));
      const finished=this.commits===0;this.forceClose();return finished;
    })();return this.stopping;
  }
  forceClose(){this.ended=true;this.controller.abort();if(this.interval)clearInterval(this.interval);this.interval=null;this.stream?.getTracks().forEach(t=>t.stop());this.dc?.close();this.pc?.close();void this.context?.close().catch(()=>{});this.callbacks.onLevel(0);}
}
