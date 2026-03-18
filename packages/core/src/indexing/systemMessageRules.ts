import { PROVIDER_VALUES, type Provider } from "../contracts/canonical";
import { PROVIDER_METADATA, createProviderRecord } from "../contracts/providerMetadata";

export type SystemMessageRegexRules = Record<Provider, string[]>;
export type SystemMessageRegexRuleOverrides = Partial<Record<Provider, string[]>>;

export const DEFAULT_SYSTEM_MESSAGE_REGEX_RULES: SystemMessageRegexRules = createProviderRecord(
  (provider) => [...PROVIDER_METADATA[provider].defaultSystemMessageRegexRules],
);

export function resolveSystemMessageRegexRules(
  overrides?: SystemMessageRegexRuleOverrides,
): SystemMessageRegexRules {
  const resolved: SystemMessageRegexRules = createProviderRecord((provider) => [
    ...DEFAULT_SYSTEM_MESSAGE_REGEX_RULES[provider],
  ]);

  if (!overrides) {
    return resolved;
  }

  for (const provider of PROVIDER_VALUES) {
    if (!Object.prototype.hasOwnProperty.call(overrides, provider)) {
      continue;
    }
    const override = overrides[provider];
    resolved[provider] = Array.isArray(override) ? [...override] : [];
  }

  return resolved;
}
