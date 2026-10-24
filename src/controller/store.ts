import { DatabaseSync } from 'node:sqlite';
export class Store {
    readonly db: DatabaseSync;
    constructor(file: string) {
        this.db = new DatabaseSync(file);
        this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL;');
        const v = this.db.prepare('PRAGMA user_version').get() as {
            user_version: number;
        };
        if (v.user_version > 8) {
            this.db.close();
            throw new Error('Unsupported newer schema; use a compatible binary or explicit forward repair');
        }
        try {
            if (v.user_version > 0 && v.user_version < 5)
                this.db.exec('PRAGMA foreign_keys=OFF');
            this.db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,root TEXT NOT NULL,profile TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,conversation TEXT,origin TEXT NOT NULL,raw TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY,project TEXT REFERENCES projects(id),source TEXT NOT NULL REFERENCES sources(id),predecessor TEXT,lineage TEXT NOT NULL,state TEXT NOT NULL,epoch INTEGER NOT NULL,generation INTEGER NOT NULL,current_result TEXT,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS requirements(work TEXT NOT NULL,version INTEGER NOT NULL,raw TEXT NOT NULL,interpretation TEXT NOT NULL,PRIMARY KEY(work,version));
 CREATE TABLE IF NOT EXISTS budgets(lineage TEXT NOT NULL,kind TEXT NOT NULL,lim INTEGER NOT NULL CHECK(lim>=0),consumed INTEGER NOT NULL CHECK(consumed>=0),reserved INTEGER NOT NULL CHECK(reserved>=0),PRIMARY KEY(lineage,kind));
 CREATE TABLE IF NOT EXISTS obligations(id TEXT PRIMARY KEY,work TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,project TEXT REFERENCES projects(id),history TEXT,generation INTEGER NOT NULL,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,work TEXT NOT NULL REFERENCES works(id),epoch INTEGER NOT NULL,generation INTEGER NOT NULL,phase TEXT NOT NULL,staging TEXT NOT NULL,reservation TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,run TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY,work TEXT NOT NULL,run TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS change_state(work TEXT PRIMARY KEY REFERENCES works(id),phase TEXT NOT NULL,base TEXT,candidate TEXT,plan TEXT,verification TEXT,epoch INTEGER NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS change_versions(id TEXT PRIMARY KEY,work TEXT NOT NULL REFERENCES works(id),kind TEXT NOT NULL,predecessor TEXT,artifact TEXT,hash TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS role_launches(id TEXT PRIMARY KEY,work TEXT NOT NULL REFERENCES works(id),run TEXT NOT NULL REFERENCES runs(id),role TEXT NOT NULL,epoch INTEGER NOT NULL,status TEXT NOT NULL,resolution_reservation TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS role_outputs(id TEXT PRIMARY KEY,launch TEXT NOT NULL REFERENCES role_launches(id),raw TEXT,status TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS finding_occurrences(id TEXT PRIMARY KEY,output TEXT NOT NULL REFERENCES role_outputs(id),ordinal INTEGER NOT NULL,work TEXT NOT NULL REFERENCES works(id),data TEXT NOT NULL,UNIQUE(output,ordinal));
 CREATE TABLE IF NOT EXISTS finding_dispositions(id TEXT PRIMARY KEY,occurrence TEXT NOT NULL REFERENCES finding_occurrences(id),launch TEXT REFERENCES role_launches(id),status TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS check_runs(id TEXT PRIMARY KEY,work TEXT NOT NULL REFERENCES works(id),run TEXT NOT NULL REFERENCES runs(id),candidate TEXT NOT NULL REFERENCES change_versions(id),verification TEXT NOT NULL REFERENCES change_versions(id),check_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS remedy_confirmations(id TEXT PRIMARY KEY,work TEXT NOT NULL REFERENCES works(id),review TEXT NOT NULL,before_version TEXT NOT NULL,after_version TEXT NOT NULL,launch TEXT NOT NULL REFERENCES role_launches(id),data TEXT NOT NULL);
 `);
            if (v.user_version > 0 && v.user_version < 3)
                this.db.exec(`
 CREATE TABLE works_v3(id TEXT PRIMARY KEY,project TEXT REFERENCES projects(id),source TEXT NOT NULL REFERENCES sources(id),predecessor TEXT,lineage TEXT NOT NULL,state TEXT NOT NULL,epoch INTEGER NOT NULL,generation INTEGER NOT NULL,current_result TEXT,data TEXT NOT NULL);
 INSERT INTO works_v3 SELECT * FROM works; DROP TABLE works; ALTER TABLE works_v3 RENAME TO works;
 CREATE TABLE conversations_v3(id TEXT PRIMARY KEY,project TEXT REFERENCES projects(id),history TEXT,generation INTEGER NOT NULL,state TEXT NOT NULL);
 INSERT INTO conversations_v3 SELECT * FROM conversations; DROP TABLE conversations; ALTER TABLE conversations_v3 RENAME TO conversations;`);
            this.db.exec(`
 CREATE TABLE IF NOT EXISTS interaction_view(id INTEGER PRIMARY KEY CHECK(id=1),selected TEXT REFERENCES conversations(id),second TEXT REFERENCES conversations(id));
 CREATE TABLE IF NOT EXISTS conversation_state(conversation TEXT PRIMARY KEY REFERENCES conversations(id),native_id TEXT,work TEXT REFERENCES works(id),direction INTEGER NOT NULL DEFAULT 0,resource TEXT NOT NULL DEFAULT 'IDLE',human_used INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversation_relations(child TEXT PRIMARY KEY REFERENCES conversations(id),parent TEXT REFERENCES conversations(id),revision INTEGER NOT NULL DEFAULT 0,CHECK(child IS NOT parent));
 CREATE TABLE IF NOT EXISTS conversation_views(conversation TEXT PRIMARY KEY REFERENCES conversations(id),draft_revision INTEGER NOT NULL DEFAULT 0,draft TEXT NOT NULL DEFAULT '',scroll_entry TEXT,scroll_offset INTEGER NOT NULL DEFAULT 0,follow_end INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS conversation_inputs(id TEXT PRIMARY KEY,conversation TEXT NOT NULL REFERENCES conversations(id),generation INTEGER NOT NULL,work TEXT REFERENCES works(id),source TEXT NOT NULL REFERENCES sources(id),state TEXT NOT NULL,mode TEXT NOT NULL,text TEXT,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversation_directions(conversation TEXT NOT NULL REFERENCES conversations(id),revision INTEGER NOT NULL,source TEXT NOT NULL REFERENCES sources(id),data TEXT NOT NULL,PRIMARY KEY(conversation,revision));
 CREATE TABLE IF NOT EXISTS conversation_assignments(id TEXT PRIMARY KEY,source_conversation TEXT NOT NULL REFERENCES conversations(id),target TEXT NOT NULL REFERENCES conversations(id),work TEXT REFERENCES works(id),state TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS assignment_source_conversation ON conversation_assignments(source_conversation);
 CREATE INDEX IF NOT EXISTS assignment_source_run ON conversation_assignments(CASE WHEN json_valid(data) THEN json_extract(data,'$.source.runId') END);
 CREATE TABLE IF NOT EXISTS conversation_dependencies(id TEXT PRIMARY KEY,waiting TEXT NOT NULL REFERENCES conversations(id),target TEXT NOT NULL REFERENCES conversations(id),assignment TEXT REFERENCES conversation_assignments(id),state TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversation_notifications(id TEXT PRIMARY KEY,target TEXT NOT NULL REFERENCES conversations(id),state TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversation_results(id TEXT PRIMARY KEY,conversation TEXT NOT NULL REFERENCES conversations(id),work TEXT REFERENCES works(id),previous TEXT REFERENCES conversation_results(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS capacity_leases(id TEXT PRIMARY KEY,work TEXT NOT NULL REFERENCES works(id),run TEXT NOT NULL REFERENCES runs(id),epoch INTEGER NOT NULL,sequence INTEGER NOT NULL UNIQUE,state TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS effect_targets(id TEXT PRIMARY KEY,project TEXT REFERENCES projects(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS effect_delegations(id TEXT PRIMARY KEY,root TEXT NOT NULL REFERENCES works(id),target TEXT NOT NULL REFERENCES effect_targets(id),epoch INTEGER NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS authority_observations(id TEXT PRIMARY KEY,target TEXT NOT NULL REFERENCES effect_targets(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS effect_operations(id TEXT PRIMARY KEY,work TEXT NOT NULL REFERENCES works(id),target TEXT NOT NULL REFERENCES effect_targets(id),grant_id TEXT NOT NULL REFERENCES effect_delegations(id),phase TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS effect_receipts(id TEXT PRIMARY KEY,operation TEXT NOT NULL REFERENCES effect_operations(id),kind TEXT NOT NULL,data TEXT NOT NULL);

 `);
            if (v.user_version > 0 && v.user_version < 5)
                this.db.exec(`CREATE TABLE effect_targets_v5(id TEXT PRIMARY KEY,project TEXT REFERENCES projects(id),data TEXT NOT NULL);INSERT INTO effect_targets_v5 SELECT * FROM effect_targets;DROP TABLE effect_targets;ALTER TABLE effect_targets_v5 RENAME TO effect_targets;`);
            const catalogueTables = ['tracked_resources', 'resource_links', 'contribution_observations', 'summary_revisions', 'summary_members'];
            if (v.user_version >= 7 && catalogueTables.some(name => !this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)))
                throw new Error('Schema7 contribution catalogue missing; restore retained database or explicit forward repair');
            this.db.exec(`
 CREATE TABLE IF NOT EXISTS tracked_resources(id TEXT PRIMARY KEY,kind TEXT NOT NULL,repository_id INTEGER NOT NULL,repository_node TEXT NOT NULL,resource_id INTEGER NOT NULL,resource_node TEXT NOT NULL,number INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(repository_id,repository_node,resource_id,resource_node,kind));
 CREATE TABLE IF NOT EXISTS resource_links(child TEXT PRIMARY KEY REFERENCES tracked_resources(id),parent TEXT REFERENCES tracked_resources(id),revision INTEGER NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS contribution_observations(id TEXT PRIMARY KEY,resource TEXT NOT NULL REFERENCES tracked_resources(id),contribution_key TEXT NOT NULL,producer_key TEXT NOT NULL,facet TEXT NOT NULL,payload_hash TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(producer_key,facet,payload_hash));
 CREATE TABLE IF NOT EXISTS summary_revisions(id TEXT PRIMARY KEY,target_resource TEXT NOT NULL REFERENCES tracked_resources(id),revision INTEGER NOT NULL,member_fingerprint TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(target_resource,revision),UNIQUE(target_resource,member_fingerprint));
 CREATE TABLE IF NOT EXISTS summary_members(revision TEXT NOT NULL REFERENCES summary_revisions(id),observation TEXT NOT NULL REFERENCES contribution_observations(id),PRIMARY KEY(revision,observation));
 `);
            if (v.user_version === 8 && ['goals', 'goal_attempts', 'goal_events', 'goal_reviews'].some(name => !this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)))
                throw new Error('Schema8 goal catalogue missing; restore retained database or explicit forward repair');
            this.db.exec(`
 CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,conversation TEXT NOT NULL REFERENCES conversations(id),revision INTEGER NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS goal_unfinished ON goals(conversation) WHERE state NOT IN ('COMPLETED','CANCELLED');
 CREATE TABLE IF NOT EXISTS goal_attempts(id TEXT PRIMARY KEY,goal TEXT NOT NULL REFERENCES goals(id),ordinal INTEGER NOT NULL,kind TEXT NOT NULL,conversation TEXT NOT NULL REFERENCES conversations(id),input TEXT NOT NULL REFERENCES conversation_inputs(id),run TEXT NOT NULL UNIQUE REFERENCES runs(id),state TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(goal,ordinal));
 CREATE UNIQUE INDEX IF NOT EXISTS goal_running ON goal_attempts(goal) WHERE state='RUNNING';
 CREATE TABLE IF NOT EXISTS goal_events(id TEXT PRIMARY KEY,goal TEXT NOT NULL REFERENCES goals(id),kind TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS goal_reviews(id TEXT PRIMARY KEY,goal TEXT NOT NULL REFERENCES goals(id),conversation TEXT NOT NULL UNIQUE REFERENCES conversations(id),input TEXT NOT NULL UNIQUE REFERENCES conversation_inputs(id),state TEXT NOT NULL,data TEXT NOT NULL);
 `);
            const hasProtection = (this.db.prepare('PRAGMA table_info(projects)').all() as {
                name: string;
            }[]).some(column => column.name === 'execution_policy');
            if (v.user_version >= 6 && !hasProtection)
                throw new Error('Schema6 protection policy column missing; compatible forward repair required');
            if (!hasProtection)
                this.db.exec('ALTER TABLE projects ADD COLUMN execution_policy TEXT');
            if (this.db.prepare('PRAGMA foreign_key_check').all().length)
                throw new Error('Schema migration foreign-key validation failed');
            this.db.exec('PRAGMA user_version=8;COMMIT;PRAGMA foreign_keys=ON;');
        }
        catch (error) {
            try {
                this.db.exec('ROLLBACK');
            }
            catch {
            }
            finally {
                this.db.close();
            }
            throw error;
        }
    }
    tx<T>(fn: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const v = fn();
            this.db.exec('COMMIT');
            return v;
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
    }
    one(sql: string, ...values: (string | number | null)[]): any {
        return this.db.prepare(sql).get(...values);
    }
    all(sql: string, ...values: (string | number | null)[]): any[] {
        return this.db.prepare(sql).all(...values);
    }
    run(sql: string, ...values: (string | number | null)[]) {
        return this.db.prepare(sql).run(...values);
    }
    close() {
        this.db.close();
    }
}
