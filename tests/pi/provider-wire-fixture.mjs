/** Finite wire fixtures consumed by the original Pi codecs, no provider implementation. */
export function wireResponse(api,modelId,{text='SYNTHETIC builtin reply',tool=false}={}){
 const call=tool===true?{name:'read',arguments:{path:'owned.txt'}}:tool;
 const data=events=>new Response(events.map(event=>'data: '+(typeof event==='string'?event:JSON.stringify(event))+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
 if(api==='openai-responses'||api==='openai-codex-responses'){
  const item=tool?{id:'fc_owned',type:'function_call',call_id:'call_owned',name:call.name,arguments:JSON.stringify(call.arguments),status:'completed'}:{id:'msg_owned',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
  const delta=tool?{type:'response.function_call_arguments.delta',output_index:0,delta:item.arguments}:{type:'response.output_text.delta',output_index:0,content_index:0,delta:text};
  return data([{type:'response.created',response:{id:'response_owned'}},{type:'response.output_item.added',output_index:0,item:tool?{...item,arguments:''}:{...item,content:[]} },delta,{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'response_owned',status:'completed',output:[item],usage:{input_tokens:4,output_tokens:3,total_tokens:7,input_tokens_details:{cached_tokens:0}}}}]);
 }
 if(api!=='openai-completions')throw Error('Undeclared fixture API');
 const delta=tool?{role:'assistant',tool_calls:[{index:0,id:'call_owned',type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]}:{role:'assistant',content:text};
 const chunk=(delta,finish_reason)=>({id:'completion_owned',object:'chat.completion.chunk',created:1,model:modelId,choices:[{index:0,delta,finish_reason}]});
 return data([chunk(delta,null),{...chunk({},tool?'tool_calls':'stop'),usage:{prompt_tokens:4,completion_tokens:3,total_tokens:7}},'[DONE]']);
}
export const builtinRoutes=[{provider:'openai',modelId:'gpt-4.1-mini',api:'openai-responses',url:'https://api.openai.com/v1/responses'},{provider:'openrouter',modelId:'openai/gpt-4.1-mini',api:'openai-completions',url:'https://openrouter.ai/api/v1/chat/completions'}];
