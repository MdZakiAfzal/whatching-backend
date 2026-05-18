type SubscriberLike = Partial<{
  firstName: string;
  lastName: string;
  phoneNumber: string;
  waId: string;
  metadata: Record<string, unknown> | Map<string, unknown>;
}>;

type DynamicValueSource =
  | {
      source: 'literal';
      text: string;
    }
  | {
      source: 'subscriber_field';
      path: 'firstName' | 'lastName' | 'fullName' | 'phoneNumber' | 'waId';
      fallback?: string;
    }
  | {
      source: 'metadata_field';
      path: string;
      fallback?: string;
    };

type SubscriberFieldPath = 'firstName' | 'lastName' | 'fullName' | 'phoneNumber' | 'waId';

const getMetadataObject = (subscriber: SubscriberLike) => {
  if (!subscriber.metadata) {
    return {};
  }

  if (subscriber.metadata instanceof Map) {
    return Object.fromEntries(subscriber.metadata.entries());
  }

  return subscriber.metadata;
};

const getNestedValue = (source: Record<string, unknown>, path: string) => {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') {
        return undefined;
      }

      return (current as Record<string, unknown>)[segment];
    }, source);
};

const resolveSubscriberField = (
  subscriber: SubscriberLike,
  path: SubscriberFieldPath
) => {
  switch (path) {
    case 'firstName':
      return subscriber.firstName;
    case 'lastName':
      return subscriber.lastName;
    case 'fullName':
      return [subscriber.firstName, subscriber.lastName].filter(Boolean).join(' ').trim();
    case 'phoneNumber':
      return subscriber.phoneNumber;
    case 'waId':
      return subscriber.waId;
    default:
      return undefined;
  }
};

export const resolveBroadcastParameterText = (
  subscriber: SubscriberLike,
  value: DynamicValueSource
) => {
  if (value.source === 'literal') {
    return value.text;
  }

  if (value.source === 'subscriber_field') {
    const resolved = resolveSubscriberField(subscriber, value.path);
    return String(resolved || value.fallback || '').trim();
  }

  const metadata = getMetadataObject(subscriber);
  const resolved = getNestedValue(metadata, value.path);
  return String(resolved || value.fallback || '').trim();
};

export const resolveBroadcastComponentsForSubscriber = (
  components: Record<string, unknown>[],
  subscriber: SubscriberLike
) =>
  components.map((component) => {
    const parameters = Array.isArray(component.parameters)
      ? component.parameters.map((parameter) => {
          const normalizedParameter =
            parameter && typeof parameter === 'object'
              ? (parameter as Record<string, unknown>)
              : null;

          if (
            normalizedParameter &&
            normalizedParameter.type === 'text' &&
            normalizedParameter.value &&
            typeof normalizedParameter.value === 'object'
          ) {
            return {
              ...normalizedParameter,
              text: resolveBroadcastParameterText(
                subscriber,
                normalizedParameter.value as DynamicValueSource
              ),
            };
          }

          return parameter;
        })
      : component.parameters;

    return {
      ...component,
      ...(parameters ? { parameters } : {}),
    };
  });

export const buildBroadcastPreviewText = (
  components: Record<string, unknown>[],
  subscriber: SubscriberLike
) => {
  const bodyComponent = resolveBroadcastComponentsForSubscriber(components, subscriber).find((component) => {
    if (!component || typeof component !== 'object') {
      return false;
    }

    return (component as Record<string, unknown>).type === 'body';
  }) as Record<string, unknown> | undefined;

  const bodyParameters = Array.isArray(bodyComponent?.parameters)
    ? bodyComponent.parameters
    : [];
  const textParts = bodyParameters
    .map((parameter) => {
      const normalizedParameter =
        parameter && typeof parameter === 'object'
          ? (parameter as Record<string, unknown>)
          : null;

      if (
        normalizedParameter &&
        normalizedParameter.type === 'text' &&
        typeof normalizedParameter.text === 'string'
      ) {
        return normalizedParameter.text;
      }

      return null;
    })
    .filter((value): value is string => Boolean(value));

  return textParts.join(' ').trim();
};
