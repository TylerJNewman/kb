export type EngineSearchResult = {
  ref: string;
  title: string;
  match: string;
  score: number;
};

export type EngineProject = {
  name: string;
  localPath: string;
};

export type EngineSchemaFieldFrequency = {
  name: string;
  source: "observation" | "relation";
  count: number;
  total: number;
  percentage: number;
  sampleValues: string[];
  isArray: boolean;
  targetType: string | null;
};

export type EngineSchemaInference = {
  noteType: string;
  notesAnalyzed: number;
  fieldFrequencies: EngineSchemaFieldFrequency[];
  suggestedSchema: Record<string, unknown>;
  suggestedRequired: string[];
  suggestedOptional: string[];
  excluded: string[];
};

export type EngineSchemaFieldResult = {
  fieldName: string;
  fieldType: string;
  required: boolean;
  status: string;
  values: string[];
  message: string | null;
};

export type EngineSchemaNoteValidation = {
  noteIdentifier: string;
  schemaEntity: string;
  passed: boolean;
  fieldResults: EngineSchemaFieldResult[];
  unmatchedObservations: Record<string, number>;
  unmatchedRelations: string[];
  warnings: string[];
  errors: string[];
};

export type EngineSchemaValidation = {
  noteType: string | null;
  totalNotes: number;
  totalEntities: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  results: EngineSchemaNoteValidation[];
};

export type EngineSchemaDriftField = {
  name: string;
  source: "observation" | "relation";
  count: number;
  total: number;
  percentage: number;
};

export type EngineSchemaDiff = {
  noteType: string;
  schemaFound: boolean;
  newFields: EngineSchemaDriftField[];
  droppedFields: EngineSchemaDriftField[];
  cardinalityChanges: string[];
  hasDrift: boolean;
};

export type EngineSchemaValidationTarget =
  | { kind: "all" }
  | { kind: "type"; type: string }
  | { kind: "memory"; ref: string };

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
  exitCode?: 130 | 143;
};

export type EngineResult<T> = EngineSuccess<T> | EngineFailure;

export interface SearchEngineAdapter {
  id: string;
  ensureAvailable(kbPath: string): Promise<EngineResult<void>>;
  enable(kbPath: string, projectName: string): Promise<EngineResult<EngineConfigPatch>>;
  search(kbPath: string, projectName: string, query: string): Promise<EngineResult<EngineSearchResult[]>>;
}

export interface SchemaEngineAdapter extends SearchEngineAdapter {
  listProjects(kbPath: string): Promise<EngineResult<EngineProject[]>>;
  reindex(kbPath: string, projectName: string): Promise<EngineResult<void>>;
  inferSchema(
    kbPath: string,
    projectName: string,
    noteType: string,
    threshold: number,
  ): Promise<EngineResult<EngineSchemaInference>>;
  validateSchema(
    kbPath: string,
    projectName: string,
    target: EngineSchemaValidationTarget,
  ): Promise<EngineResult<EngineSchemaValidation>>;
  diffSchema(kbPath: string, projectName: string, noteType: string): Promise<EngineResult<EngineSchemaDiff>>;
}
