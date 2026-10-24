import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {CustomEditor} from '@earendil-works/pi-coding-agent';
import {TuiAltScreen, CombinedAutocompleteProvider} from '@earendil-works/pi-tui';
import {openController} from '../../dist/controller/index.js';
import {startConversationUI} from '../../dist/ui/index.js';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8')),c=await openController({installationHome:cfg.home});
process.env.TMPDIR=path.join(cfg.home,'artifacts');
const named=name=>{const v=c.createConversation();c.setDraft({conversationId:v.conversationId,expectedRevision:0,text:name+'_DRAFT'});return v.conversationId;};
const root=named('ROOT'),a=named('A'),b=named('B'),grand=named('GRAND'),other=named('OTHER');
for(const [childId,parentId] of [[a,root],[b,root],[grand,b]])c.setConversationParent({childId,parentId,expectedRevision:0});
let latest,queue=Promise.resolve(),providerCalls=0,failed=0,recovered=false,reparented=false,lastAttempt,autocompleteEditor,completionArrowSeen=false;
const startDescriptor=Object.getOwnPropertyDescriptor(TuiAltScreen.prototype,'start'),nativeStart=TuiAltScreen.prototype.start;let nativeScreen;
TuiAltScreen.prototype.start=function(...args){nativeScreen=this;return nativeStart.apply(this,args);};
const nativeInput=CustomEditor.prototype.handleInput;
// Fixture-only installation of a real original SDK completion list through its public editor API.
CustomEditor.prototype.handleInput=function(data){
 if(data==='\x1b[20~'){autocompleteEditor=this;this.setAutocompleteProvider(new CombinedAutocompleteProvider([{name:'alpha'},{name:'alpine'}],process.cwd()));this.setText('/');return nativeInput.call(this,'a');}
 if(this===autocompleteEditor&&this.isShowingAutocomplete()&&data==='\x1b[1;2B')completionArrowSeen=true;
 return nativeInput.call(this,data);
};
const setDraft=c.setDraft.bind(c);
c.setDraft=input=>{lastAttempt=input;if(cfg.fault&&!recovered&&input.conversationId===b&&input.text.includes('UNSAVED')){failed++;throw Error('INJECTED_HIERARCHY_DRAFT_UNAVAILABLE');}return setDraft(input);};
const snapshot=()=>({frame:nativeScreen?.getScreenLines()??[],root,a,b,grand,other,selected:latest?.selectedConversationId,second:latest?.secondConversationId,visibleSecond:latest?.visibleSecondConversationId,drafts:Object.fromEntries([root,a,b,grand,other].map(id=>[id,c.inspectConversation(id).draft.text])),failed,lastAttempt,recovered,reparented,autocomplete:autocompleteEditor?.isShowingAutocomplete()??false,completionArrowSeen});
const write=()=>{queue=queue.then(async()=>{await fs.writeFile(cfg.control+'.next',JSON.stringify(snapshot()));await fs.rename(cfg.control+'.next',cfg.control);});};
const abort=new AbortController();
const poll=setInterval(()=>{
 if(existsSync(cfg.recover))recovered=true;
 if(existsSync(cfg.reparent)&&!reparented){c.setConversationParent({childId:b,parentId:other,expectedRevision:1});reparented=true;}
 if(existsSync(cfg.finish)){recovered=true;clearInterval(poll);abort.abort();}else write();
},5);
const model={provider:'unused-hierarchy',modelId:'fixture',definition:{api:'fixture-api',apiKey:'fixture',baseUrl:'http://unused.invalid',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000}],streamSimple(){providerCalls++;throw Error('Hierarchy navigation must not dispatch a model');}}};
try{await startConversationUI({controller:c,model,conversationId:cfg.fault||cfg.fastSwitch?b:root,signal:abort.signal,onViewCacheState:v=>{latest=v;write();}});clearInterval(poll);await queue;await fs.writeFile(cfg.receipt,JSON.stringify({...snapshot(),providerCalls,normalUiReturn:true}));}
finally{clearInterval(poll);CustomEditor.prototype.handleInput=nativeInput;if(startDescriptor)Object.defineProperty(TuiAltScreen.prototype,'start',startDescriptor);else delete TuiAltScreen.prototype.start;await c.close();}
