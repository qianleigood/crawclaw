import { z } from "zod";

// Everything registered here will be redacted when the config is exposed,
// e.g. sent to browser-origin clients
export const sensitive = z.registry<undefined, z.ZodType>();
