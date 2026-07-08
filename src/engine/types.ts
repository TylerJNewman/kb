export type EngineSearchResult = {
  ref: string;
  title: string;
  match: string;
  score: number;
};

export type EngineConfigPatch = {
  arm: "b1";
  engineState: "enabled";
  engineProject: string;
};

export type EngineSuccess<T> = {
  ok: true;
  value: T;
};

export type EngineFailure = {
  ok: false;
  message: string;
};

export type EngineResult<T> = EngineSuccess<T> | EngineFailure;

export interface SearchEngineAdapter {
  id: string;
  ensureAvailable(kbPath: string): Promise<EngineResult<void>>;
  enable(kbPath: string, projectName: string): Promise<EngineResult<EngineConfigPatch>>;
  search(kbPath: string, projectName: string, query: string): Promise<EngineResult<EngineSearchResult[]>>;
}
