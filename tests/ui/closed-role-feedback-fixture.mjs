import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openController} from '../../dist/controller/index.js';
import {ApplicationAccounts} from '../../dist/app/accounts.js';
import {ApplicationModels} from '../../dist/app/models.js';

// Controlled settled-role ledger premises; no claim of live Native execution.
export async function closedRoleFixture(root, locale='en', {configuredModel=true}={}) {
    const home=path.join(root,'home'),project=path.join(root,'project');
    await fs.mkdir(project);await fs.writeFile(path.join(project,'source.txt'),'Original source');
    const c=await openController({installationHome:home});
    try {
        await c.registerProject({id:'P',sourceRoot:project});
        let view;
        if(configuredModel){
            const accounts=ApplicationAccounts.open(c);
            await accounts.configure({providers:{'feedback-fixture':{api:'openai-completions',apiKey:'DUMMY',baseUrl:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}});
            await accounts.setDefault('feedback-fixture','fixture');
            view=await new ApplicationModels(c).newConversation({projectId:'P'});
        }else view=c.createConversation({projectId:'P'});
        const cid=view.conversationId;
        const work=await c.beginChange({projectId:'P',request:'Original owner request'}),workId=work.workId;
        const run=c.store.one('SELECT * FROM runs WHERE work=?',workId),launch=randomUUID();
        c.store.run('INSERT INTO role_launches VALUES(?,?,?,?,?,?,?,?)',launch,workId,run.id,'reviewer',1,'COMPLETE','none',JSON.stringify({stage:'fresh-review',cleanup:'removed'}));
        const data=JSON.parse(c.store.one('SELECT data FROM conversation_state WHERE conversation=?',cid).data);
        c.store.run('UPDATE conversation_state SET work=?,resource=?,data=? WHERE conversation=?',workId,'IDLE',JSON.stringify({...data,role:'reviewer',runId:run.id}),cid);
        const finding=randomUUID();c.store.run('INSERT INTO obligations VALUES(?,?,?)',finding,workId,JSON.stringify({kind:'finding',state:'pending',occurrence:finding,disposition:'upheld'}));
        c.setConversationLanguage({conversationId:cid,expectedGeneration:0,expectedRevision:c.getConversationLanguage(cid).revision,replyLanguage:locale});
        return {c,home,cid,workId};
    } catch(error) {await c.close();throw error;}
}
