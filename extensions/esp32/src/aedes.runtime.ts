import { Aedes } from "aedes";

export function createAedesBroker() {
  return new Aedes();
}

export type AedesBroker = ReturnType<typeof createAedesBroker>;
