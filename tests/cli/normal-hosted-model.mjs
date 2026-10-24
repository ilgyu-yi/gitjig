import http from 'node:http';
import { scripted } from '../controller/effect-fixture.mjs';

/** Serve the existing deterministic role fixture through actual OpenAI SSE,
 * so CLI model-profile parsing and the official SDK HTTP provider stay real. */
export async function modelServer() {
  const model = scripted(), requests = [], sockets = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      let bytes = 0; const chunks = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 3 * 2 ** 20) throw Error('Fixture request bound'); chunks.push(chunk); }
      const payload = JSON.parse(Buffer.concat(chunks).toString()), user = payload.messages.find(m => m.role === 'user');
      const text = typeof user.content === 'string' ? user.content : user.content.filter(c => c.type === 'text').map(c => c.text).join('');
      const role = text.match(/assigned (\w+) task/)?.[1]; if (!role) throw Error('Assigned role expected');
      requests.push({ role, stage: JSON.parse(text.split('\n')[1]).context.stage });
      const stream = model.definition.streamSimple({ api: 'openai-completions', provider: 'owned-normal-cli', id: 'fixture' }, { messages: [{ role: 'user', content: [{ type: 'text', text }] }] });
      let message;
      for await (const event of stream) if (event.type === 'done') message = event.message;
      if (!message) throw Error('Fixture native producer missing');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const tool = message.content.find(c => c.type === 'toolCall'), content = message.content.filter(c => c.type === 'text').map(c => c.text).join('');
      const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] } : { role: 'assistant', content };
      const chunk = (delta, finish_reason) => ({ id: 'owned-normal', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] });
      res.write('data: ' + JSON.stringify(chunk(delta, null)) + '\n\n');
      res.write('data: ' + JSON.stringify(chunk({}, tool ? 'tool_calls' : 'stop')) + '\n\n');
      res.end('data: [DONE]\n\n');
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, profile: { provider: 'owned-normal-cli', modelId: 'fixture', definition: { api: 'openai-completions', apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 20000 }] } }, async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
