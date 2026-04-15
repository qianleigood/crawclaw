import type { ResolvedTheme } from "./theme.ts";

export type ThemeTransitionContext = {
  element?: HTMLElement | null;
  pointerClientX?: number;
  pointerClientY?: number;
};

export type ThemeTransitionOptions = {
  nextTheme: ResolvedTheme;
  applyTheme: () => void;
  // Retained so callers from stacked slices can keep passing pointer metadata
  // while theme switching remains an immediate, non-animated update here.
  context?: ThemeTransitionContext;
  currentTheme?: ResolvedTheme | null;
};

const cleanupThemeTransition = (root: HTMLElement) => {
  root.classList.remove("theme-transition");
  root.style.removeProperty("--theme-switch-x");
  root.style.removeProperty("--theme-switch-y");
};

function resolveTransitionOrigin(context?: ThemeTransitionContext) {
  if (context?.pointerClientX != null && context?.pointerClientY != null) {
    return {
      x: `${context.pointerClientX}px`,
      y: `${context.pointerClientY}px`,
    };
  }
  const element = context?.element;
  if (element) {
    const rect = element.getBoundingClientRect();
    return {
      x: `${Math.round(rect.left + rect.width / 2)}px`,
      y: `${Math.round(rect.top + rect.height / 2)}px`,
    };
  }
  return {
    x: "50%",
    y: "50%",
  };
}

export const startThemeTransition = ({
  nextTheme,
  applyTheme,
  context,
  currentTheme,
}: ThemeTransitionOptions) => {
  if (currentTheme === nextTheme) {
    // Even when the resolved palette is unchanged (e.g. system->dark on a dark OS),
    // we still need to persist the user's explicit selection immediately.
    applyTheme();
    return;
  }

  const documentReference = globalThis.document ?? null;
  if (!documentReference) {
    applyTheme();
    return;
  }

  const root = documentReference.documentElement;
  const reducedMotion =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    applyTheme();
    cleanupThemeTransition(root);
    return;
  }

  const origin = resolveTransitionOrigin(context);
  root.style.setProperty("--theme-switch-x", origin.x);
  root.style.setProperty("--theme-switch-y", origin.y);

  const viewTransitionCapable = "startViewTransition" in documentReference;
  if (!viewTransitionCapable) {
    applyTheme();
    cleanupThemeTransition(root);
    return;
  }

  root.classList.add("theme-transition");
  try {
    const transition = (
      documentReference as Document & {
        startViewTransition: (callback: () => void) => {
          finished: Promise<void>;
        };
      }
    ).startViewTransition(() => {
      applyTheme();
    });
    void transition.finished.finally(() => cleanupThemeTransition(root));
  } catch {
    applyTheme();
    cleanupThemeTransition(root);
  }
};
