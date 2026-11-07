// The self-contained producer is also relocated by installed fixture drivers.
export { withAssignedReports } from '../controller/effect-fixture.mjs';
export function assignedWireReply(body, answer) {
    if (!answer.text || !body.tools?.some(tool => tool.function?.name === 'conversation_report'))
        return answer;
    const lastUser = body.messages.findLastIndex(message => message.role === 'user'), reported = body.messages.slice(lastUser + 1).some(message => message.role === 'assistant' && message.tool_calls?.some(call => call.function?.name === 'conversation_report'));
    return reported ? answer : { tool: { name: 'conversation_report', arguments: { text: answer.text } } };
}
