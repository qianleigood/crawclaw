type BuiltInModelSuppression = {
  suppress: boolean;
  errorMessage: string;
};

function resolveBuiltInModelSuppression(params: {
  provider?: string | null;
  id?: string | null;
}): BuiltInModelSuppression | undefined {
  void params;
  return undefined;
}

export function shouldSuppressBuiltInModel(params: {
  provider?: string | null;
  id?: string | null;
}) {
  return resolveBuiltInModelSuppression(params)?.suppress ?? false;
}

export function buildSuppressedBuiltInModelError(params: {
  provider?: string | null;
  id?: string | null;
}): string | undefined {
  return resolveBuiltInModelSuppression(params)?.errorMessage;
}
