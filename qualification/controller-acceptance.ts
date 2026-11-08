/** Internal external-acceptance runner join. Not exported by public Controller,
 * CLI/model options or testing's caller-supplied fixture profile route. */
import type {Controller} from '../dist/controller/controller.js';
import type {CreatedAcceptanceContext} from '../dist/platform/hosted-context.js';
import {createdAcceptanceSession} from '../dist/platform/hosted-context.js';
import type {Publications} from '../dist/controller/publication.js';
import type {Configurations} from '../dist/controller/configuration.js';
import type {Effects} from '../dist/controller/effects.js';
export function configureCreatedAcceptance(controller: Controller, context: CreatedAcceptanceContext) {
    // Validate runtime membership/liveness before touching any Controller engine.
    const session = createdAcceptanceSession(context);
    const owned = controller as unknown as { publicationEngine: Publications; configurationEngine: Configurations; effects: Effects };
    // All admission checks precede this synchronous, non-awaiting configuration.
    owned.effects.assertAcceptanceAdmission();
    owned.publicationEngine.configureCreatedAcceptance(context);
    owned.configurationEngine.configureCreatedAcceptance(context);
    owned.effects.configureCreatedAcceptance(context);
    return Object.freeze({credentialSessionId: session.credentialSessionId, activation: session.activation, target: session.target});
}
