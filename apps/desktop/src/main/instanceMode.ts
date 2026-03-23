import { dirname, join } from "node:path";

const INSTANCE_ARG = "--instance";

export type SideBySideInstance = {
  id: string;
  titleSuffix: string;
  userDataPath: string;
  sessionDataPath: string;
};

export function resolveSideBySideInstance(
  argv: string[],
  env: NodeJS.ProcessEnv,
  defaultUserDataPath: string,
): SideBySideInstance | null {
  const id = resolveInstanceId(argv, env);
  if (!id) {
    return null;
  }

  const titleSuffix = ` (${id})`;
  const userDataPath = `${defaultUserDataPath}${titleSuffix}`;
  return {
    id,
    titleSuffix,
    userDataPath,
    sessionDataPath: join(dirname(userDataPath), `session-data${titleSuffix}`),
  };
}

export function resolveInstanceId(argv: string[], env: NodeJS.ProcessEnv): string | null {
  const candidate = readInstanceIdFromArgs(argv) ?? env.CODETRAIL_INSTANCE;
  return normalizeInstanceId(candidate);
}

function readInstanceIdFromArgs(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (typeof value !== "string") {
      continue;
    }
    if (value === INSTANCE_ARG) {
      return argv[index + 1] ?? null;
    }
    if (value.startsWith(`${INSTANCE_ARG}=`)) {
      return value.slice(`${INSTANCE_ARG}=`.length);
    }
  }
  return null;
}

export function normalizeInstanceId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 32);

  return normalized.length > 0 ? normalized : null;
}
