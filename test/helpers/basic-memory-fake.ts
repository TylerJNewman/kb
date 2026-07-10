export type FakeBasicMemoryProject = {
  name: string;
  localPath: string;
};

export function basicMemoryUvxScript(body: string): string {
  return `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ]; then shift 3; fi
${body}
exit 2
`;
}

export function recordingBasicMemoryUvxScript(body: string): string {
  return `#!/bin/sh
printf 'uvx %s\\n' "$*" >> "$HOME/engine-calls"
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "--from" ] && [ "$2" = "basic-memory==0.22.1" ] && [ "$3" = "bm" ]; then shift 3; fi
${body}
exit 2
`;
}

export function projectListJson(projects: FakeBasicMemoryProject[]): string {
  return JSON.stringify({
    projects: projects.map((project) => ({ name: project.name, local_path: project.localPath })),
  });
}

export function projectListResponseShell(json: string): string {
  return `if [ "$1" = "project" ] && [ "$2" = "list" ] && { [ "$3" = "--json" ] || { [ "$3" = "--local" ] && [ "$4" = "--json" ]; }; }; then
  printf '%s\\n' ${shellQuote(json)}
  exit 0
fi`;
}

export function homeResearchProjectListResponseShell(beforeResponse = ""): string {
  return `if [ "$1" = "project" ] && [ "$2" = "list" ] && { [ "$3" = "--json" ] || { [ "$3" = "--local" ] && [ "$4" = "--json" ]; }; }; then
${beforeResponse}
  printf '%s\\n' '{"projects":[{"name":"research","local_path":"'"$HOME"'/kb/research"}]}'
  exit 0
fi`;
}

export function projectListSequenceShell(responses: string[]): string {
  if (responses.length === 0) {
    throw new Error("projectListSequenceShell requires at least one response");
  }
  const cases = responses
    .map((response, index) => `  ${index + 1}) printf '%s\\n' ${shellQuote(response)} ;;`)
    .join("\n");
  return `if [ "$1" = "project" ] && [ "$2" = "list" ] && { [ "$3" = "--json" ] || { [ "$3" = "--local" ] && [ "$4" = "--json" ]; }; }; then
  count_file="$HOME/project-list-count"
  count=0
  if [ -f "$count_file" ]; then count=$(/bin/cat "$count_file"); fi
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  case "$count" in
${cases}
  *) printf '%s\\n' ${shellQuote(responses[responses.length - 1]!)} ;;
  esac
  exit 0
fi`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
