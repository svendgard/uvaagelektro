/**
 * Demomodus. Settes ved bygg (DEMO=true npm run build). Er den av, fjernes all eksempeldata
 * fra bygget (tree-shaking), og simuleringsknapper skjules.
 */
declare const __DEMO__: boolean | undefined;
export const DEMO: boolean = typeof __DEMO__ !== 'undefined' && __DEMO__ === true;
