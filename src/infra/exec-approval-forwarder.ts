export type ExecApprovalForwarder = {
  handleRequested: (payload: unknown) => Promise<boolean>;
  handleResolved: (payload: unknown) => Promise<void>;
  handlePluginApprovalRequested?: (payload: unknown) => Promise<boolean>;
  handlePluginApprovalResolved?: (payload: unknown) => Promise<void>;
};
