import { createFileRoute } from "@tanstack/react-router";

import { CockpitPage } from "../components/cockpit/CockpitPage";

export const Route = createFileRoute("/_chat/cockpit")({
  component: CockpitPage,
});
