declare module "../../scripts/ci-changed-scope.mjs" {
  export function detectChangedScope(paths: string[]): {
    runNode: boolean;
    runWindows: boolean;
    runSkillsPython: boolean;
    runChangedSmoke: boolean;
  };
}
