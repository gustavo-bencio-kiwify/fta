
import type { HomeView } from "@slack/web-api";
import { homeHeaderActionsBlocks } from "./homeHeaderActions";
import { homeTasksBlocks, type HomeTasksData } from "./homeTasksBlocks";

export function homeView(data: HomeTasksData): HomeView {
  return {
    type: "home",
    blocks: [
      ...homeHeaderActionsBlocks(),
      ...homeTasksBlocks(data),
    ],
  };
}
