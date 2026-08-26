// Minimal ambient types for the pieces of @stryker-mutator/api used by
// mutationProgressReporter.ts. The real package is ESM-only ("type":
// "module") with an `exports` map; this project's classic Node10 module
// resolution (module: commonjs, no moduleResolution override) can't resolve
// its subpath type declarations even though Node itself loads the package
// fine at runtime (verified: `require('@stryker-mutator/api/plugin')` works
// under Node 22's require(esm) support). These declarations only describe
// the shapes this project actually consumes - not the full Stryker API.

declare module '@stryker-mutator/api/plugin' {
  export enum PluginKind {
    Reporter = 'Reporter',
    // BL-447: entrypointBoilerplateIgnorer.ts's own Ignorer plugin.
    Ignore = 'Ignore',
  }
  export function declareClassPlugin(
    kind: PluginKind,
    name: string,
    injectableClass: new (...args: any[]) => unknown
  ): unknown;
}

declare module '@stryker-mutator/api/report' {
  export interface MutantResult {
    status: string;
  }
  export interface MutantTestPlan {
    plan: string;
  }
  export interface MutationTestingPlanReadyEvent {
    mutantPlans: readonly MutantTestPlan[];
  }
  export interface Reporter {
    onMutationTestingPlanReady?(event: MutationTestingPlanReadyEvent): void;
    onMutantTested?(result: Readonly<MutantResult>): void;
    onMutationTestReportReady?(): void;
    wrapUp?(): Promise<void> | void;
  }
}

// BL-485: mutation-site-count.ts's own real @stryker-mutator/instrumenter
// wiring - a plain, no-op-capable Logger to satisfy Instrumenter's
// constructor.
declare module '@stryker-mutator/api/logging' {
  export interface Logger {
    isTraceEnabled(): boolean;
    isDebugEnabled(): boolean;
    isInfoEnabled(): boolean;
    isWarnEnabled(): boolean;
    isErrorEnabled(): boolean;
    isFatalEnabled(): boolean;
    trace(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    fatal(message: string, ...args: unknown[]): void;
  }
}
