import { createTeamHubEnvironmentAtoms } from "@t3tools/client-runtime/team-hub";

import { connectionAtomRuntime } from "../connection/runtime";

export const teamHubEnvironment = createTeamHubEnvironmentAtoms(connectionAtomRuntime);
