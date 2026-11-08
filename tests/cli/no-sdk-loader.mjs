import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@earendil-works/') || /(?:^|\/)pi\/(?:index|session|host|tools)\.js$/.test(specifier)) {
    throw new Error('SDK_LOADED_ON_LOCAL_PATH');
  }
  return nextResolve(specifier, context);
} });
