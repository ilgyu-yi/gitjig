/** Internal owned-fixture entry, never wired into CLI/model/public Controller configuration. */
import type { Controller } from '../dist/controller/controller.js';
import type { PublicationCredential } from '../dist/controller/publication-types.js';
import type { Publications } from '../dist/controller/publication.js';
export function configureOwnedPublicationFixture(controller: Controller, options: PublicationCredential & {
    origin: string;
}) {
    return (controller as unknown as {
        publicationEngine: Publications;
    }).publicationEngine.configureOwned(options);
}
export function configureOwnedRepositoryConfigurationFixture(controller: Controller, options: import('../dist/controller/configuration-types.js').RepositoryConfigurationCredential & {
    origin: string;
}) {
    return (controller as unknown as {
        configurationEngine: import('../dist/controller/configuration.js').Configurations;
    }).configurationEngine.configureOwned(options);
}
export function configureOwnedHostedIntegrationFixture(controller: Controller, options: import('../dist/controller/hostedintegration.js').OwnedHostedIntegrationFixture) {
    return (controller as unknown as {
        effects: import('../dist/controller/effects.js').Effects;
    }).effects.configureOwnedHosted(options);
}
export function configureOwnedContributionFixture(controller: Controller, options: import('../dist/platform/github-contributions.js').ContributionReadOptions & {
    origin: string;
}) {
    return (controller as unknown as {
        contributions: import('../dist/controller/contributions.js').Contributions;
    }).contributions.configureOwned(options);
}
/** Internal normal-PUBLIC-profile transport seams, never CLI/model options. */
export function configureOwnedNormalPublicPublicationFixture(controller: Controller, options: import('../dist/controller/publication-types.js').PublicationCredential & {
    origin: string;
}) {
    return (controller as unknown as {
        publicationEngine: import('../dist/controller/publication.js').Publications;
    }).publicationEngine.configureOwnedPublicOwner(options);
}
export function configureOwnedNormalPublicConfigurationFixture(controller: Controller, options: import('../dist/controller/configuration-types.js').RepositoryConfigurationCredential & {
    origin: string;
}) {
    return (controller as unknown as {
        configurationEngine: import('../dist/controller/configuration.js').Configurations;
    }).configurationEngine.configureOwnedPublicOwner(options);
}

/** Internal actual normal-profile transport counterpart, never a public CLI option. */
export function configureOwnedNormalHostedIntegrationFixture(controller:Controller,options:import('../dist/controller/hostedintegration.js').OwnedNormalHostedIntegrationFixture){return (controller as unknown as {effects:import('../dist/controller/effects.js').Effects}).effects.configureOwnedNormalHosted(options);}

/** Internal owned native merge boundary; never public model/CLI options. */
export function configureOwnedMergeFixture(controller:Controller,options:import('../dist/controller/merge-types.js').MergeCredential&{origin:string}){return (controller as unknown as {effects:import('../dist/controller/effects.js').Effects}).effects.merges.configureOwned(options);}
