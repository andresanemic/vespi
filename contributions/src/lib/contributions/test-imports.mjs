import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

const root = new URL('../../', import.meta.url);
const contributions = new URL('./', import.meta.url);
registerHooks({ resolve(specifier, context, nextResolve) {
  let candidate;
  if (specifier.startsWith('@/')) {
    const path = specifier.slice(2);
    candidate = new URL(path, root);
  } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier) &&
    context.parentURL?.startsWith(contributions.href)) {
    candidate = new URL(specifier, context.parentURL);
  }
  if (candidate) {
    if (/\.[cm]?[jt]s$/.test(candidate.pathname)) return nextResolve(candidate.href, context);
    const typescript = new URL(candidate.href + '.ts');
    if (existsSync(typescript)) return nextResolve(typescript.href, context);
  }
  return nextResolve(specifier, context);
} });
